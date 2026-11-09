import { useSyncExternalStore } from 'react'

export interface ConfirmReq {
  title: string
  body?: string
  ok: string
  /** 3つ目の選択肢（キャンセルとは別の代替操作） */
  alt?: string
  danger?: boolean
  resolve: (v: boolean | 'alt') => void
}

interface UiState {
  toast: { id: number; text: string; action?: { label: string; run: () => void } } | null
  confirm: ConfirmReq | null
}

let ui: UiState = { toast: null, confirm: null }
const listeners = new Set<() => void>()
const emit = (next: Partial<UiState>) => {
  ui = { ...ui, ...next }
  listeners.forEach((l) => l())
}

let toastId = 0
let timer: number | undefined

/** 文字数に応じて表示時間を延ばす（最低3秒）。操作付きは長めに出す */
export function toast(text: string, action?: { label: string; run: () => void }) {
  const id = ++toastId
  emit({ toast: { id, text, action } })
  window.clearTimeout(timer)
  const ms = Math.max(3000, text.length * 150, action ? 5000 : 0)
  timer = window.setTimeout(() => emit({ toast: null }), ms)
}

export const dismissToast = () => emit({ toast: null })

export const askConfirm = (o: Omit<ConfirmReq, 'resolve'>) =>
  new Promise<boolean>((resolve) => {
    ui.confirm?.resolve(false)
    emit({ confirm: { ...o, resolve: (v) => resolve(v === true) } })
  })

/** 「実行」「代替操作」「キャンセル」の3択 */
export const askChoice = (o: Omit<ConfirmReq, 'resolve'>) =>
  new Promise<'ok' | 'alt' | 'cancel'>((resolve) => {
    ui.confirm?.resolve(false)
    emit({ confirm: { ...o, resolve: (v) => resolve(v === 'alt' ? 'alt' : v ? 'ok' : 'cancel') } })
  })

export function answerConfirm(v: boolean | 'alt') {
  ui.confirm?.resolve(v)
  emit({ confirm: null })
}

export const useUi = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => ui,
  )
