import type { AppData } from '../types'
import { todayKey } from './date'
import { doneSets } from './stats'
import { findExercise, getState, parseDataDetailed, quarantine, setState } from './store'
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

const toCsvText = (r: (string | number)[][]) => '﻿' + r.map((row) => row.map(csvCell).join(',')).join('\n')

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
  const ok = await deliver(`kinetic-${todayKey()}.csv`, toCsvText(rows), 'text/csv')
  if (!ok) return
  // 体組成は別CSV（既存の記録CSVの形式は変えない）
  if (s.bodyLogs.length > 0) {
    const body: (string | number)[][] = [['日付', '体重kg', '体脂肪率%', '筋肉量kg', 'ウエストcm', 'メモ']]
    for (const b of s.bodyLogs) body.push([b.date, b.weight ?? '', b.fat ?? '', b.muscle ?? '', b.waist ?? '', b.note])
    await deliver(`kinetic-body-${todayKey()}.csv`, toCsvText(body), 'text/csv')
  }
  toast(s.bodyLogs.length > 0 ? 'CSVを2ファイル（記録・体組成）書き出しました' : 'CSVを書き出しました')
}

export type BackupResult = { ok: true; data: AppData; dropped: number } | { ok: false; reason: string }

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
  const parsed = parseDataDetailed(raw)
  if (!parsed) return { ok: false, reason: 'データの形式が正しくありません（形式のバージョンや構造が不正です）' }
  const { data, dropped } = parsed
  // 不正なレコードを除外した場合、元の内容は端末内に退避しておく（何も失わない）
  if (dropped > 0) quarantine(JSON.stringify(raw))
  // 文字数ベースの実容量でも判定する（日本語はUTF-16換算で膨らむため）
  if (JSON.stringify(data).length > 4.5 * 1024 * 1024) return { ok: false, reason: 'データ量が保存上限を超えています' }
  return { ok: true, data, dropped }
}
