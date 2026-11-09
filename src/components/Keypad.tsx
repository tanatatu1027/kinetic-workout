import { fmtDuration } from '../lib/date'
import { IconBackspace, IconCheck, IconDown, IconMinus, IconNext, IconPlus } from './Icons'
import { useNow } from './Common'

interface Props {
  field: 'weight' | 'reps'
  label: string
  /** 入力中の値（キーパッドが行を隠しても確認できるように表示する） */
  value: string
  step: number
  restEndsAt: number | null
  onKey: (k: string) => void
  onStep: (d: number) => void
  onNext: () => void
  onClose: () => void
}

const DIGITS = ['7', '8', '9', '4', '5', '6', '1', '2', '3']

export function Keypad({ field, label, value, step, restEndsAt, onKey, onStep, onNext, onClose }: Props) {
  const now = useNow(500)
  const isWeight = field === 'weight'
  const d = isWeight ? step : 1
  return (
    <div className="keypad" role="group" aria-label={`${label}の入力`}>
      <div className="keypad-head">
        <span className="hud-label">{label}</span>
        <b className="keypad-value num" aria-live="polite">{value || '–'}</b>
        {restEndsAt && restEndsAt > now && <span className="keypad-rest">REST {fmtDuration(restEndsAt - now)}</span>}
        <button className="icon-btn" onClick={onClose} aria-label="入力を閉じる">
          <IconDown />
        </button>
      </div>
      <div className="keypad-grid">
        {DIGITS.map((k) => (
          <button key={k} className="key" onClick={() => onKey(k)}>
            {k}
          </button>
        ))}
        <button className="key" disabled={!isWeight} onClick={() => onKey('.')} aria-label="小数点">
          {isWeight ? '.' : ''}
        </button>
        <button className="key" onClick={() => onKey('0')}>
          0
        </button>
        <button className="key" onClick={() => onKey('back')} aria-label="1文字消す">
          <IconBackspace />
        </button>
        <button className="key side" style={{ gridColumn: 4, gridRow: 1 }} onClick={() => onStep(d)} aria-label={`${d}増やす`}>
          <IconPlus size={18} />
          {d}
        </button>
        <button className="key side" style={{ gridColumn: 4, gridRow: 2 }} onClick={() => onStep(-d)} aria-label={`${d}減らす`}>
          <IconMinus size={18} />
          {d}
        </button>
        <button className="key go" style={{ gridColumn: 4, gridRow: '3 / span 2' }} onClick={onNext}>
          {isWeight ? <IconNext size={26} /> : <IconCheck size={26} />}
          <span>{isWeight ? '回数へ' : '完了'}</span>
        </button>
      </div>
    </div>
  )
}
