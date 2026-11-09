import type { AppData } from '../types'
import { todayKey } from './date'
import { doneSets } from './stats'
import { findExercise, getState, parseData, setState } from './store'
import { toast } from './ui'

async function deliver(name: string, text: string, type: string) {
  const file = new File([text], name, { type })
  // iPhoneのPWAでは共有シートが最も確実に「ファイルに保存」できる
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return true
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return true
}

export async function exportJson() {
  const ok = await deliver(`kinetic-backup-${todayKey()}.json`, JSON.stringify({ ...getState(), active: null, rest: null }), 'application/json')
  if (ok) {
    setState((s) => ({ ...s, lastExportAt: Date.now() }))
    toast('バックアップを書き出しました')
  }
}

const csvCell = (v: string | number) => {
  const text = String(v)
  // 表計算ソフトでの数式実行を防ぐ
  const safe = typeof v === 'string' && /^[\s=+\-@＝＋－＠]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export async function exportCsv() {
  const s = getState()
  const rows: (string | number)[][] = [['日付', 'セッション', '種目', 'セット', '重量kg', '回数']]
  for (const w of [...s.workouts].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const x of w.exercises) {
      doneSets(x.sets).forEach((st, i) =>
        rows.push([w.date, w.title, findExercise(s, x.exerciseId).name, i + 1, st.weight ?? 0, st.reps ?? 0]),
      )
    }
  }
  const text = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n')
  if (await deliver(`kinetic-${todayKey()}.csv`, text, 'text/csv')) toast('CSVを書き出しました')
}

export type BackupResult = { ok: true; data: AppData } | { ok: false; reason: string }

export async function readBackup(file: File): Promise<BackupResult> {
  // localStorageの上限(約5MB)を超えると保存できないため、それ以上は受け付けない
  if (file.size > 4.5 * 1024 * 1024) return { ok: false, reason: 'ファイルが大きすぎます（4.5MBまで）' }
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    return { ok: false, reason: 'JSONとして読み込めません。KINETICのバックアップではない可能性があります' }
  }
  if (typeof raw === 'object' && raw !== null && typeof (raw as { version?: unknown }).version === 'number' && (raw as { version: number }).version > 1) {
    return { ok: false, reason: 'このアプリより新しい形式です。アプリを更新してください' }
  }
  const data = parseData(raw)
  if (!data) return { ok: false, reason: 'データの形式が正しくありません（日付や数値の不正、IDの重複など）' }
  // 文字数ベースの実容量でも判定する（日本語はUTF-16換算で膨らむため）
  if (JSON.stringify(data).length > 4.5 * 1024 * 1024) return { ok: false, reason: 'データ量が保存上限を超えています' }
  return { ok: true, data }
}
