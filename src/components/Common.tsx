import { useEffect, useRef, useState, type ReactNode } from 'react'
import { muscleOf } from '../data/exercises'
import { answerConfirm, dismissToast, useUi } from '../lib/ui'
import type { Muscle } from '../types'
import { IconClose } from './Icons'

export const MuscleBadge = ({ muscle, size }: { muscle: Muscle; size?: 'sm' }) => {
  const m = muscleOf(muscle)
  return (
    <span className={`mbadge ${size ?? ''}`} style={{ background: m.color }} title={m.label}>
      {m.short}
    </span>
  )
}

export const Panel = ({ label, right, children, className = '' }: { label?: string; right?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`panel ${className}`}>
    {(label || right) && (
      <header className="panel-head">
        <h2 className="hud-label">{label}</h2>
        {right}
      </header>
    )}
    {children}
  </section>
)

export const Stat = ({ label, value, unit }: { label: string; value: string | number; unit?: string }) => (
  <div className="stat">
    <div className="stat-value">
      {value}
      {unit && <small>{unit}</small>}
    </div>
    <div className="stat-label">{label}</div>
  </div>
)

/** ダイアログ表示中: Escで閉じる・Tabを内側に閉じ込める・開く前の要素へフォーカスを戻す */
function useDialogFocus(onEsc: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const escRef = useRef(onEsc)
  escRef.current = onEsc
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const root = ref.current
    const focusables = () =>
      Array.from(root?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, [href], [tabindex]:not([tabindex="-1"])') ?? []).filter(
        (el) => el.offsetParent !== null,
      )
    if (root && !root.contains(document.activeElement)) (focusables()[0] ?? root).focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        escRef.current()
      } else if (e.key === 'Tab') {
        const list = focusables()
        if (list.length === 0) return
        const first = list[0]
        const last = list[list.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [])
  return ref
}

export function Sheet({ title, onClose, children, footer, tall }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  const ref = useDialogFocus(onClose)
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={`sheet${tall ? ' tall' : ''}`}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            <IconClose />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  )
}

function ConfirmDialog({ confirm }: { confirm: NonNullable<ReturnType<typeof useUi>['confirm']> }) {
  const ref = useDialogFocus(() => answerConfirm(false))
  return (
    <div className="confirm-wrap" role="alertdialog" aria-modal="true" aria-label={confirm.title} ref={ref} tabIndex={-1}>
      <div className="confirm">
        <h2>{confirm.title}</h2>
        {confirm.body && <p>{confirm.body}</p>}
        <div className={`confirm-actions ${confirm.alt ? 'three' : ''}`}>
          <button className="btn" onClick={() => answerConfirm(false)}>
            キャンセル
          </button>
          {confirm.alt && (
            <button className="btn" onClick={() => answerConfirm('alt')}>
              {confirm.alt}
            </button>
          )}
          <button className={`btn ${confirm.danger ? 'danger' : 'primary'}`} onClick={() => answerConfirm(true)}>
            {confirm.ok}
          </button>
        </div>
      </div>
    </div>
  )
}

export function UiHost() {
  const { toast, confirm } = useUi()
  return (
    <>
      {toast && (
        <div className="toast" key={toast.id} role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="toast-act"
              onClick={() => {
                toast.action!.run()
                dismissToast()
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
      {confirm && <ConfirmDialog confirm={confirm} />}
    </>
  )
}

/** 指定間隔で再描画する。表示の時刻は常に Date.now() から計算する */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [intervalMs])
  return now
}
