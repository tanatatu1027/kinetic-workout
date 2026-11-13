import { useSyncExternalStore } from 'react'
import type { AppData } from '../types'
import { SUPABASE_KEY, SUPABASE_URL } from './cloud-config'
import { getState, loadFailed, parseData, subscribeStore } from './store'

const URL_BASE = SUPABASE_URL.replace(/\/+$/, '')
const ANON = SUPABASE_KEY
export const cloudConfigured = URL_BASE.startsWith('https://') && ANON.length > 20

const CODE_KEY = 'kinetic.cloud.code'
const LAST_KEY = 'kinetic.cloud.last'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32文字（紛らわしい 0/O/1/I を除く）
const DEBOUNCE_MS = 5000

// ---- 合言葉 ----
export const normalizeCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')
export const formatCode = (v: string) => normalizeCode(v).match(/.{1,4}/g)?.join('-') ?? ''
export const validCode = (v: string) => normalizeCode(v).length === 20 && [...normalizeCode(v)].every((c) => ALPHABET.includes(c))

function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return formatCode([...bytes].map((b) => ALPHABET[b % 32]).join(''))
}

export function getCode(): string | null {
  try {
    const c = localStorage.getItem(CODE_KEY)
    return c && validCode(c) ? formatCode(c) : null
  } catch {
    return null
  }
}

function ensureCode(): string | null {
  const cur = getCode()
  if (cur) return cur
  try {
    const c = makeCode()
    localStorage.setItem(CODE_KEY, c)
    return c
  } catch {
    return null
  }
}

async function hashOf(code: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('kinetic:' + normalizeCode(code)))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- 状態 ----
interface CloudStatus {
  lastAt: number | null
  error: string | null
  busy: boolean
}
function readLast(): number | null {
  try {
    const n = Number(localStorage.getItem(LAST_KEY))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}
let status: CloudStatus = { lastAt: readLast(), error: null, busy: false }
const listeners = new Set<() => void>()
function setStatus(p: Partial<CloudStatus>) {
  status = { ...status, ...p }
  listeners.forEach((l) => l())
}
export const useCloudStatus = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => status,
  )

// ---- 通信 ----
async function rpc<T>(fn: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { apikey: ANON, 'Content-Type': 'application/json' }
  if (ANON.startsWith('eyJ')) headers.Authorization = `Bearer ${ANON}`
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (text.includes('empty data')) throw new Error('記録が空のため保存しませんでした')
    if (res.status === 404) throw new Error('サーバーの準備ができていません（SQL未実行）')
    throw new Error(`通信に失敗しました (${res.status})`)
  }
  return (await res.json().catch(() => null)) as T
}

const payloadOf = (s: AppData) => JSON.stringify({ ...s, active: null, rest: null })

let lastSent = ''

/** 今の記録をクラウドへ送る。force=true なら変更がなくても送る */
export async function backupNow(force = false): Promise<boolean> {
  if (!cloudConfigured || loadFailed || status.busy) return false
  const s = getState()
  if (s.workouts.length === 0 && s.bodyLogs.length === 0) return false // 空データで正常なバックアップを上書きしない
  const code = ensureCode()
  if (!code || !crypto.subtle) {
    setStatus({ error: 'この環境ではクラウドバックアップを使えません（https が必要です）' })
    return false
  }
  const body = payloadOf(s)
  if (!force && body === lastSent) return true
  setStatus({ busy: true })
  try {
    await rpc('kinetic_save', { p_key: await hashOf(code), p_data: JSON.parse(body) })
    lastSent = body
    const now = Date.now()
    try {
      localStorage.setItem(LAST_KEY, String(now))
    } catch {
      // 表示用なので失敗しても無視
    }
    setStatus({ lastAt: now, error: null, busy: false })
    return true
  } catch (e) {
    setStatus({ error: e instanceof TypeError ? 'オフラインのため送れませんでした（次回再試行）' : (e as Error).message, busy: false })
    return false
  }
}

export interface CloudSnapshot {
  day: string
  updatedAt: number
  data: AppData
}

/** 合言葉でクラウドのバックアップ一覧（新しい順）を取得する */
export async function fetchBackups(code: string): Promise<{ ok: true; items: CloudSnapshot[] } | { ok: false; reason: string }> {
  if (!cloudConfigured) return { ok: false, reason: 'クラウドバックアップが未設定です' }
  if (!validCode(code)) return { ok: false, reason: '合言葉の形式が正しくありません（英数字20文字）' }
  if (!crypto.subtle) return { ok: false, reason: 'この環境では使えません（https が必要です）' }
  try {
    const rows = await rpc<{ day: string; updated_at: string; data: unknown }[]>('kinetic_load', { p_key: await hashOf(code) })
    const items: CloudSnapshot[] = []
    for (const r of rows ?? []) {
      const data = parseData(r.data)
      if (data) items.push({ day: r.day, updatedAt: Date.parse(r.updated_at), data })
    }
    if (items.length === 0) return { ok: false, reason: 'この合言葉のバックアップは見つかりませんでした' }
    return { ok: true, items }
  } catch (e) {
    return { ok: false, reason: e instanceof TypeError ? 'オフラインです' : (e as Error).message }
  }
}

/** 復元後、この端末の合言葉を復元元のものに切り替える（以降は同じ場所へバックアップされる） */
export function adoptCode(code: string) {
  try {
    localStorage.setItem(CODE_KEY, formatCode(code))
    lastSent = ''
  } catch {
    // 失敗しても復元自体は完了している
  }
}

// ---- 自動バックアップ ----
let timer: number | undefined
let started = false

export function startAutoBackup() {
  if (!cloudConfigured || started || typeof window === 'undefined') return
  started = true
  ensureCode()
  const schedule = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void backupNow(), DEBOUNCE_MS)
  }
  subscribeStore(schedule)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      window.clearTimeout(timer)
      void backupNow()
    }
  })
  window.addEventListener('online', schedule)
  window.setTimeout(() => void backupNow(), 3000) // 起動時
}
