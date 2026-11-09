import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../components/Common'
import { IconBack, IconClose, IconNext } from '../components/Icons'
import { TrendChart, type Point } from '../components/TrendChart'
import { addDays, fmtLong, fromKey, toKey, todayKey } from '../lib/date'
import { round1 } from '../lib/stats'
import { saveBodyLog, updateSettings, useStore } from '../lib/store'
import type { BodyLog } from '../types'

type Key = 'weight' | 'fat' | 'muscle' | 'waist'
type Metric = Key | 'bmi' | 'fatMass' | 'lean'

const FIELDS: { key: Key; label: string; unit: string }[] = [
  { key: 'weight', label: '体重', unit: 'kg' },
  { key: 'fat', label: '体脂肪率', unit: '%' },
  { key: 'muscle', label: '筋肉量', unit: 'kg' },
  { key: 'waist', label: 'ウエスト', unit: 'cm' },
]

const METRICS: { id: Metric; label: string; unit: string }[] = [
  ...FIELDS.map((f) => ({ id: f.key as Metric, label: f.label, unit: f.unit })),
  { id: 'bmi', label: 'BMI', unit: '' },
  { id: 'fatMass', label: '体脂肪量', unit: 'kg' },
  { id: 'lean', label: '除脂肪体重', unit: 'kg' },
]

const RANGES = [
  { id: 30, label: '30日' },
  { id: 90, label: '90日' },
  { id: 365, label: '1年' },
  { id: 0, label: '全期間' },
]

const blank = (date: string): BodyLog => ({ date, weight: null, fat: null, muscle: null, waist: null, note: '' })

/** 数字入力。入力途中の「72.」などを壊さないよう、表示用の文字列を別に持つ */
function NumField({ value, unit, label, placeholder, onChange }: { value: number | null; unit: string; label: string; placeholder?: string; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value))
  return (
    <div className="body-field">
      <label htmlFor={`bf-${label}`}>{label}</label>
      <div className="body-input">
        <input
          id={`bf-${label}`}
          className="text num"
          inputMode="decimal"
          value={text}
          placeholder={placeholder ?? '---'}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d.]/g, '')
            const n = parseFloat(t)
            // 保存データの検証上限（%は100、その他は500）を超える入力は受け付けない
            if (Number.isFinite(n) && n > (unit === '%' ? 100 : 500)) return
            setText(t)
            onChange(Number.isFinite(n) && n > 0 ? n : null)
          }}
        />
        <span className="unit">{unit}</span>
        {text !== '' && (
          <button
            className="icon-btn"
            aria-label={`${label}を消去`}
            onClick={() => {
              setText('')
              onChange(null)
            }}
          >
            <IconClose size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

const derive = (b: BodyLog, heightCm: number | null) => {
  const bmi = b.weight && heightCm ? b.weight / (heightCm / 100) ** 2 : null
  const fatMass = b.weight && b.fat ? (b.weight * b.fat) / 100 : null
  const lean = b.weight && fatMass !== null ? b.weight - fatMass : null
  return { bmi, fatMass, lean }
}

const valueOf = (b: BodyLog, m: Metric, heightCm: number | null) => {
  if (m === 'bmi' || m === 'fatMass' || m === 'lean') return derive(b, heightCm)[m]
  return b[m]
}

const bmiLabel = (bmi: number) => (bmi < 18.5 ? '低体重' : bmi < 25 ? '標準' : bmi < 30 ? '肥満(1度)' : '肥満(2度以上)')

const fmt = (n: number) => String(round1(n))

export function BodyCompScreen() {
  const s = useStore()
  const today = todayKey()
  const [date, setDate] = useState(today)
  const [metric, setMetric] = useState<Metric>('weight')
  const [range, setRange] = useState(90)
  const [smooth, setSmooth] = useState(false)

  const cur = s.bodyLogs.find((b) => b.date === date) ?? blank(date)
  const prev = useMemo(() => [...s.bodyLogs].reverse().find((b) => b.date < date) ?? null, [s.bodyLogs, date])
  const heightCm = s.settings.heightCm
  const calc = derive(cur, heightCm)

  const patch = (p: Partial<BodyLog>) => saveBodyLog({ ...cur, ...p })
  const move = (d: number) => {
    const next = toKey(addDays(fromKey(date), d))
    if (next <= today) setDate(next)
  }

  useEffect(() => {
    if (heightCm === null && metric === 'bmi') setMetric('weight')
  }, [heightCm, metric])

  const meta = METRICS.find((m) => m.id === metric)!
  const points: Point[] = useMemo(() => {
    const since = range ? toKey(addDays(new Date(), -range)) : ''
    const raw = s.bodyLogs
      .filter((b) => b.date >= since)
      .map((b) => ({ date: b.date, value: valueOf(b, metric, heightCm) }))
      .filter((p): p is Point => p.value !== null)
    const dayNum = (k: string) => Math.round(fromKey(k).getTime() / 86400000)
    // 7日移動平均は「その日を含む直近7日間」の記録で平均する（件数ではなく日付で数える）
    const list = smooth
      ? raw.map((p) => {
          const win = raw.filter((q) => dayNum(q.date) <= dayNum(p.date) && dayNum(q.date) > dayNum(p.date) - 7)
          return { ...p, value: win.reduce((n, q) => n + q.value, 0) / win.length }
        })
      : raw
    return list.map((p) => ({ ...p, value: Math.round(p.value * 100) / 100 }))
  }, [s.bodyLogs, metric, range, smooth, heightCm])

  // 直近の記録からの増減（同じ項目で、この日より前の最新値と比べる）
  const diff = (m: Metric) => {
    const now = valueOf(cur, m, heightCm)
    const before = [...s.bodyLogs].reverse().find((b) => b.date < date && valueOf(b, m, heightCm) !== null)
    const old = before ? valueOf(before, m, heightCm) : null
    return now !== null && old !== null ? now - old : null
  }

  const latestWeight = [...s.bodyLogs].reverse().find((b) => b.weight !== null)?.weight ?? null
  const goal = s.settings.goalWeight
  const first30 = useMemo(() => {
    const t = toKey(addDays(new Date(), -30))
    const old = s.bodyLogs.find((b) => b.date >= t && b.weight !== null)
    return old?.weight ?? null
  }, [s.bodyLogs])

  const DerivedRow = ({ label, m, value, unit, note }: { label: string; m: Metric; value: number | null; unit: string; note?: string }) => {
    const d = diff(m)
    return (
      <div className="derived-row">
        <span>
          {label}
          {note && <small>{note}</small>}
        </span>
        <b className={`num ${value === null ? 'dim' : ''}`}>
          {value === null ? '---' : round1(value)}
          <small>{value === null ? '' : unit}</small>
        </b>
        <em className={`num delta ${d === null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{d === null ? '' : `${d > 0 ? '+' : ''}${round1(d)}`}</em>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>BODY COMP</h1>
      </header>

      <Panel>
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => move(-1)} aria-label="前の日"><IconBack /></button>
          <div className="date-pick">
            <h2 className="num">{fmtLong(date)}</h2>
            {date !== today && <button className="link" onClick={() => setDate(today)}>今日へ</button>}
          </div>
          <button className="icon-btn" onClick={() => move(1)} aria-label="次の日" disabled={date >= today}><IconNext /></button>
        </div>

        <div className="body-fields">
          {FIELDS.map((f) => (
            // 日付が変わったら入力欄を作り直し、その日の値を表示する
            <NumField
              key={`${date}-${f.key}`}
              label={f.label}
              unit={f.unit}
              value={cur[f.key]}
              placeholder={prev?.[f.key] ? `前回 ${prev[f.key]}` : undefined}
              onChange={(v) => patch({ [f.key]: v } as Partial<BodyLog>)}
            />
          ))}
        </div>
        <label className="field">
          <span>メモ</span>
          <textarea key={date} className="text" rows={2} maxLength={500} defaultValue={cur.note} onChange={(e) => patch({ note: e.target.value })} placeholder="食事・睡眠・体調など" />
        </label>
        <p className="hint">入力した内容はその場で保存されます。測らなかった項目は空欄のままで構いません。</p>
      </Panel>

      <Panel label="AUTO CALC" right={<span className="hint-inline">前回比</span>}>
        {heightCm === null && (
          <label className="field">
            <span>身長を入れるとBMIが計算されます</span>
            <div className="inline-form">
              <input className="text num" inputMode="decimal" placeholder="例 170" onChange={(e) => {
                const n = parseFloat(e.target.value)
                if (Number.isFinite(n) && n >= 50 && n <= 260) updateSettings({ heightCm: n })
              }} />
              <span className="unit">cm</span>
            </div>
          </label>
        )}
        <div className="derived">
          <DerivedRow label="BMI" m="bmi" value={calc.bmi} unit="" note={calc.bmi !== null ? bmiLabel(calc.bmi) : undefined} />
          <DerivedRow label="体脂肪量" m="fatMass" value={calc.fatMass} unit="kg" />
          <DerivedRow label="除脂肪体重" m="lean" value={calc.lean} unit="kg" />
        </div>
        {heightCm !== null && (
          <p className="hint">
            身長 {heightCm}cm で計算中。
            <button className="link" onClick={() => updateSettings({ heightCm: null })}>変更</button>
          </p>
        )}
      </Panel>

      <Panel label="GOAL">
        <label className="field">
          <span>目標体重</span>
          <div className="inline-form">
            <input
              className="text num"
              inputMode="decimal"
              defaultValue={goal ?? ''}
              placeholder="例 68"
              onChange={(e) => {
                const n = parseFloat(e.target.value)
                updateSettings({ goalWeight: Number.isFinite(n) && n > 0 && n <= 500 ? n : null })
              }}
            />
            <span className="unit">kg</span>
          </div>
        </label>
        {goal !== null && latestWeight !== null && (
          <div className="goal-box">
            <div className="goal-bar"><i style={{ width: `${Math.max(4, Math.min(100, 100 - (Math.abs(latestWeight - goal) / Math.max(Math.abs((first30 ?? latestWeight) - goal), 1)) * 100))}%` }} /></div>
            <p className="num">
              現在 {round1(latestWeight)}kg ／ 目標まで{' '}
              <b>{Math.abs(latestWeight - goal) < 0.05 ? '達成!' : `${latestWeight > goal ? '-' : '+'}${round1(Math.abs(latestWeight - goal))}kg`}</b>
            </p>
            {first30 !== null && <p className="hint">30日前から {round1(latestWeight - first30) > 0 ? '+' : ''}{round1(latestWeight - first30)}kg</p>}
          </div>
        )}
      </Panel>

      <Panel label="TREND">
        <div className="chips scroll">
          {METRICS.filter((m) => (m.id !== 'bmi' || heightCm !== null)).map((m) => (
            <button key={m.id} className={`chip ${metric === m.id ? 'on' : ''}`} onClick={() => setMetric(m.id)}>{m.label}</button>
          ))}
        </div>
        <div className="seg" role="tablist" aria-label="期間">
          {RANGES.map((r) => (
            <button key={r.id} role="tab" aria-selected={range === r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>{r.label}</button>
          ))}
        </div>
        <TrendChart points={points} unit={meta.unit} />
        <button className="toggle-row" role="switch" aria-checked={smooth} onClick={() => setSmooth(!smooth)}>
          <span>
            7日移動平均
            <small>日々の水分量のブレをならして、本当の増減を見やすくします</small>
          </span>
          <i className={`toggle ${smooth ? 'on' : ''}`} aria-hidden="true" />
        </button>
        {points.length > 0 && <p className="hint num">記録 {points.length}件 ／ 最新 {fmt(points[points.length - 1].value)}{meta.unit}</p>}
      </Panel>
    </div>
  )
}
