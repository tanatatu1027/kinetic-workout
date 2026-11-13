import { useSyncExternalStore } from 'react'
import type { AppData } from '../types'
import { SUPABASE_KEY, SUPABASE_URL } from './cloud-config'
import { getState, loadFailed, parseDataDetailed, subscribeStore } from './store'

const URL_BASE = SUPABASE_URL.replace(/\/+$/, '')
const ANON = SUPABASE_KEY
export const cloudConfigured = URL_BASE.startsWith('https://') && ANON.length > 20

const CODE_KEY = 'kinetic.cloud.code'
const LAST_KEY = 'kinetic.cloud.last'
const COUNT_KEY = 'kinetic.cloud.count'
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
  /** 記録件数の急減など、自動送信を止めている理由。「それでも保存」を押すまで送らない */
  warn: string | null
}
function readLast(): number | null {
  try {
    const n = Number(localStorage.getItem(LAST_KEY))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}
let status: CloudStatus = { lastAt: readLast(), error: null, busy: false, warn: null }
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

/** 前回クラウドへ送った（または復元した）記録件数。急減の検知に使う */
function readCount(): number {
  try {
    const n = Number(localStorage.getItem(COUNT_KEY))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}
function writeCount(n: number) {
  try {
    localStorage.setItem(COUNT_KEY, String(n))
  } catch {
    // 検知用なので失敗しても無視
  }
}
export const countOf = (s: AppData) => s.workouts.length + s.bodyLogs.length

/** 急減とみなす条件: 前回が MIN_PREV 件以上で、今回がその半分以下 */
export const MIN_PREV = 4
export const isSharpDrop = (prev: number, now: number) => prev >= MIN_PREV && now <= prev / 2

// ---- 通信 ----
const TIMEOUT_MS = 15000

function timeoutSignal(): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(TIMEOUT_MS)
  const c = new AbortController()
  setTimeout(() => c.abort(), TIMEOUT_MS)
  return c.signal
}

/** 通信エラーを利用者向けの文言にする */
export function describeError(e: unknown, offlineText = 'オフラインのため送れませんでした（次回再試行）'): string {
  const name = (e as { name?: string } | null)?.name
  if (name === 'TimeoutError' || name === 'AbortError') return '通信がタイムアウトしました（次回再試行）'
  if (e instanceof TypeError) return offlineText
  return e instanceof Error ? e.message : '通信に失敗しました'
}

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { apikey: ANON, 'Content-Type': 'application/json' }
  if (ANON.startsWith('eyJ')) headers.Authorization = `Bearer ${ANON}`
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body), signal: timeoutSignal() })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (text.includes('empty data')) throw new Error('記録が空のため保存しませんでした')
    if (text.includes('too large')) throw new Error('記録のサイズが大きすぎてクラウドに保存できません（2MBまで）')
    if (text.includes('too many')) throw new Error('サーバー側の保存先の上限に達しています')
    if (res.status === 404) throw new Error('サーバーの準備ができていません（SQL未実行）')
    throw new Error(`通信に失敗しました (${res.status})`)
  }
  return (await res.json().catch(() => null)) as T
}

const payloadOf = (s: AppData) => JSON.stringify({ ...s, active: null, rest: null })

let lastSent = ''
let pendingAgain = false

/**
 * 今の記録をクラウドへ送る。force=true なら変更がなくても送る。
 * allowDrop=true のときだけ、記録件数が急減していても送る（「それでも保存」用）
 */
export async function backupNow(force = false, allowDrop = false): Promise<boolean> {
  if (!cloudConfigured || loadFailed) return false
  if (status.busy) {
    pendingAgain = true // 送信中の変更は、完了後にもう一度送る
    return false
  }
  const s = getState()
  if (s.workouts.length === 0 && s.bodyLogs.length === 0) return false // 空データで正常なバックアップを上書きしない
  const code = ensureCode()
  if (!code || !crypto.subtle) {
    setStatus({ error: 'この環境ではクラウドバックアップを使えません（https が必要です）' })
    return false
  }
  const body = payloadOf(s)
  if (!force && !allowDrop && body === lastSent) return true
  const n = countOf(s)
  const prev = readCount()
  if (!allowDrop && isSharpDrop(prev, n)) {
    setStatus({ warn: `記録が前回の${prev}件から${n}件に大きく減っています。誤って消した可能性があるため、自動保存を止めています。` })
    return false
  }
  pendingAgain = false
  setStatus({ busy: true })
  let ok = false
  try {
    await rpc('kinetic_save', { p_key: await hashOf(code), p_data: JSON.parse(body) })
    lastSent = body
    writeCount(n)
    const now = Date.now()
    try {
      localStorage.setItem(LAST_KEY, String(now))
    } catch {
      // 表示用なので失敗しても無視
    }
    setStatus({ lastAt: now, error: null, warn: null, busy: false })
    ok = true
  } catch (e) {
    setStatus({ error: describeError(e), busy: false })
  }
  if (pendingAgain) {
    pendingAgain = false
    if (ok) window.setTimeout(() => void backupNow(), 0)
  }
  return ok
}

/** 件数の急減を承知のうえで保存する */
export const backupAnyway = () => backupNow(true, true)

export interface CloudSnapshot {
  day: string
  updatedAt: number
  data: AppData
  /** 読み込めなかったため除外したレコード数 */
  dropped: number
}

/** 合言葉でクラウドのバックアップ一覧（新しい順、最大7日分）を取得する */
export async function fetchBackups(code: string): Promise<{ ok: true; items: CloudSnapshot[] } | { ok: false; reason: string }> {
  if (!cloudConfigured) return { ok: false, reason: 'クラウドバックアップが未設定です' }
  if (!validCode(code)) return { ok: false, reason: '合言葉の形式が正しくありません（英数字20文字）' }
  if (!crypto.subtle) return { ok: false, reason: 'この環境では使えません（https が必要です）' }
  try {
    const rows = await rpc<unknown>('kinetic_load', { p_key: await hashOf(code) })
    if (!Array.isArray(rows)) return { ok: false, reason: 'サーバーの応答が想定外の形式でした（SQLの更新が必要かもしれません）' }
    const items: CloudSnapshot[] = []
    for (const r of rows as { day?: unknown; updated_at?: unknown; data?: unknown }[]) {
      if (typeof r !== 'object' || r === null) continue
      const parsed = parseDataDetailed(r.data)
      if (!parsed) continue
      const updatedAt = Date.parse(String(r.updated_at))
      items.push({ day: String(r.day ?? ''), updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0, data: parsed.data, dropped: parsed.dropped })
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt)
    if (items.length === 0) return { ok: false, reason: 'この合言葉のバックアップは見つかりませんでした' }
    return { ok: true, items }
  } catch (e) {
    return { ok: false, reason: describeError(e, 'オフラインです') }
  }
}

/** 復元後、この端末の合言葉を復元元のものに切り替える（以降は同じ場所へバックアップされる）。count は復元した記録件数 */
export function adoptCode(code: string, count?: number) {
  try {
    localStorage.setItem(CODE_KEY, formatCode(code))
    lastSent = ''
    if (count !== undefined) writeCount(count)
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
