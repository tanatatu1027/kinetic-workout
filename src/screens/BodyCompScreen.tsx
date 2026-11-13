import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Panel } from '../components/Common'
import { IconBack, IconCheck, IconClose, IconDown, IconNext, IconUp } from '../components/Icons'
import { TrendChart, type Point } from '../components/TrendChart'
import { addDays, fmtLong, fromKey, toKey, todayKey } from '../lib/date'
import { round1 } from '../lib/stats'
import { flushSave, saveBodyLog, updateSettings, useStore } from '../lib/store'
import { toast } from '../lib/ui'
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

const same = (a: BodyLog, b: BodyLog) => FIELDS.every((f) => a[f.key] === b[f.key]) && a.note.trim() === b.note.trim()

/** 全角数字・全角記号を半角に直す（日本語キーボードの入力対策） */
const toHalf = (t: string) =>
  t
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。，、,]/g, '.')

/**
 * 数字の入力文字列を整える。使えない文字は取り除く。
 * 小数点が2つ以上（72.5.3 など）や、小数が3桁以上になる入力は不正として null を返す（呼び出し側で入力を受け付けない）
 */
const cleanNum = (raw: string): string | null => {
  const t = toHalf(raw).replace(/[^\d.]/g, '')
  if ((t.match(/\./g) ?? []).length > 1) return null
  const frac = t.split('.')[1]
  if (frac !== undefined && frac.length > 2) return null
  return t
}

/** 自動保存の状態表示。入力した値は少し待って自動で保存され、保存できたら控えめに知らせる */
function AutoSaveStatus({ dirty, justSaved, idleText }: { dirty: boolean; justSaved: boolean; idleText: string }) {
  return (
    <p className={`save-state ${dirty ? 'dirty' : justSaved ? 'ok' : 'idle'}`} role="status" aria-live="polite">
      {dirty ? '入力中…（自動で保存します）' : justSaved ? (<><IconCheck size={16} /> 保存しました</>) : idleText}
    </p>
  )
}

/** 保存済みの表示を一定時間だけ出す */
function useJustSaved() {
  const [on, setOn] = useState(false)
  const t = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(t.current), [])
  return [
    on,
    () => {
      setOn(true)
      window.clearTimeout(t.current)
      t.current = window.setTimeout(() => setOn(false), 2500)
    },
  ] as const
}

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
          autoComplete="off"
          value={text}
          placeholder={placeholder ?? '---'}
          onChange={(e) => {
            const t = cleanNum(e.target.value)
            if (t === null) return // 不正な入力（72.5.3 など）は受け付けない
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

const signed = (n: number) => `${n > 0 ? '+' : ''}${round1(n)}`

/** 身長・目標体重。有効な値になったら少し待って自動で保存する */
function ProfilePanel({ latestWeight, first30 }: { latestWeight: number | null; first30: number | null }) {
  const s = useStore()
  const { heightCm, goalWeight: goal } = s.settings
  const [height, setHeight] = useState(heightCm === null ? '' : String(heightCm))
  const [goalText, setGoalText] = useState(goal === null ? '' : String(goal))

  const parse = (t: string) => (t.trim() === '' ? null : parseFloat(t))
  const h = parse(height)
  const g = parse(goalText)
  const heightOk = h === null || (Number.isFinite(h) && h >= 50 && h <= 260)
  const goalOk = g === null || (Number.isFinite(g) && g > 0 && g <= 500)
  const dirty = h !== heightCm || g !== goal
  const valid = heightOk && goalOk && !Number.isNaN(h) && !Number.isNaN(g)
  const [justSaved, markSaved] = useJustSaved()

  const save = () => {
    updateSettings({ heightCm: h, goalWeight: g })
    if (flushSave()) markSaved()
  }
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    if (!dirty || !valid) return
    const id = window.setTimeout(() => saveRef.current(), 800)
    return () => window.clearTimeout(id)
  }, [dirty, valid, height, goalText])

  // 画面を離れるときに、有効な入力が残っていれば保存する
  const pending = useRef({ dirty, valid })
  pending.current = { dirty, valid }
  useEffect(() => () => {
    if (pending.current.dirty && pending.current.valid) saveRef.current()
  }, [])

  const setH = (t: string) => { const c = cleanNum(t); if (c !== null) setHeight(c) }
  const setG = (t: string) => { const c = cleanNum(t); if (c !== null) setGoalText(c) }

  return (
    <Panel label="PROFILE" right={<span className="hint-inline">身長・目標</span>}>
      <div className="body-fields">
        <div className="body-field">
          <label htmlFor="pf-height">身長</label>
          <div className="body-input">
            <input id="pf-height" className="text num" inputMode="decimal" value={height} placeholder="例 170" onChange={(e) => setH(e.target.value)} />
            <span className="unit">cm</span>
          </div>
        </div>
        <div className="body-field">
          <label htmlFor="pf-goal">目標体重</label>
          <div className="body-input">
            <input id="pf-goal" className="text num" inputMode="decimal" value={goalText} placeholder="例 68" onChange={(e) => setG(e.target.value)} />
            <span className="unit">kg</span>
          </div>
        </div>
      </div>
      {dirty && !valid ? (
        <p className="save-state dirty" role="status">{!heightOk ? '身長は50〜260cmの範囲で入力してください' : '目標体重は1〜500kgの範囲で入力してください'}</p>
      ) : (
        <AutoSaveStatus dirty={dirty} justSaved={justSaved} idleText={`身長 ${heightCm === null ? '未設定' : `${heightCm}cm`} ／ 目標 ${goal === null ? '未設定' : `${goal}kg`}（自動保存）`} />
      )}
      <p className="hint">身長はBMIの計算に、目標体重は体重グラフの目標線に使われます。</p>

      {goal !== null && latestWeight !== null && (
        <div className="goal-box">
          <div className="goal-bar"><i style={{ width: `${Math.max(4, Math.min(100, 100 - (Math.abs(latestWeight - goal) / Math.max(Math.abs((first30 ?? latestWeight) - goal), 1)) * 100))}%` }} /></div>
          <p className="num">
            現在 {round1(latestWeight)}kg ／ 目標まで{' '}
            <b>{Math.abs(latestWeight - goal) < 0.05 ? '達成!' : `${latestWeight > goal ? '-' : '+'}${round1(Math.abs(latestWeight - goal))}kg`}</b>
          </p>
          {first30 !== null && <p className="hint">30日前から {signed(latestWeight - first30)}kg</p>}
        </div>
      )}
    </Panel>
  )
}

/** 体組成。embedded のときは分析画面の中に組み込まれる（ページ枠と見出しは親が持つ） */
export function BodyCompScreen({ embedded = false }: { embedded?: boolean }) {
  const s = useStore()
  const today = todayKey()
  const [date, setDate] = useState(today)
  const [range, setRange] = useState(90)
  const [smooth, setSmooth] = useState(false)
  const [big, setBig] = useState<Metric[]>([])

  const saved = s.bodyLogs.find((b) => b.date === date) ?? blank(date)
  const [draft, setDraft] = useState<BodyLog>(saved)
  /** 入力欄を作り直す合図（日付の移動・取り消しで増やす） */
  const [rev, setRev] = useState(0)
  const dirty = !same(draft, saved)
  const prev = useMemo(() => [...s.bodyLogs].reverse().find((b) => b.date < date) ?? null, [s.bodyLogs, date])
  const heightCm = s.settings.heightCm
  const calc = derive(draft, heightCm)

  const patch = (p: Partial<BodyLog>) => setDraft((d) => ({ ...d, ...p }))
  const [justSaved, markSaved] = useJustSaved()

  // 入力は少し待って自動で保存する。日付の移動・画面を離れるときは待たずに保存する
  const save = () => {
    saveBodyLog({ ...draft, note: draft.note.trim() })
    if (flushSave()) markSaved()
    else toast('保存に失敗しました。バックアップを書き出してください')
  }
  const saveRef = useRef(save)
  saveRef.current = save
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    if (!dirty) return
    const id = window.setTimeout(() => saveRef.current(), 800)
    return () => window.clearTimeout(id)
  }, [dirty, draft])

  const open = (next: string) => {
    setDate(next)
    setDraft(s.bodyLogs.find((b) => b.date === next) ?? blank(next))
    setRev((n) => n + 1)
  }

  const go = (next: string) => {
    if (next > today || next === date) return
    if (dirty) save()
    open(next)
  }
  const move = (d: number) => go(toKey(addDays(fromKey(date), d)))

  // 画面を離れるとき（別のタブへ移るなど）に、未保存の入力が残っていれば保存する
  const unmountSave = useRef(() => {})
  unmountSave.current = () => {
    if (!dirtyRef.current) return
    saveBodyLog({ ...draft, note: draft.note.trim() })
    flushSave()
  }
  useEffect(() => () => unmountSave.current(), [])

  // 日付をまたいだとき、「今日」を見ていたなら新しい今日へ移る（入力中でも内容は先に保存する）
  const lastToday = useRef(today)
  useEffect(() => {
    if (lastToday.current === today) return
    const wasToday = date === lastToday.current
    lastToday.current = today
    if (wasToday) {
      if (dirtyRef.current) save()
      open(today)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  const charts = useMemo(() => {
    const since = range ? toKey(addDays(new Date(), -range)) : ''
    const dayNum = (k: string) => Math.round(fromKey(k).getTime() / 86400000)
    return METRICS.filter((m) => m.id !== 'bmi' || heightCm !== null).map((m) => {
      const raw = s.bodyLogs
        .filter((b) => b.date >= since)
        .map((b) => ({ date: b.date, value: valueOf(b, m.id, heightCm) }))
        .filter((p): p is Point => p.value !== null)
      // 7日移動平均は「その日を含む直近7日間」の記録で平均する（件数ではなく日付で数える）
      const list = smooth
        ? raw.map((p) => {
            const win = raw.filter((q) => dayNum(q.date) <= dayNum(p.date) && dayNum(q.date) > dayNum(p.date) - 7)
            return { ...p, value: win.reduce((n, q) => n + q.value, 0) / win.length }
          })
        : raw
      return { ...m, points: list.map((p) => ({ ...p, value: Math.round(p.value * 100) / 100 })) }
    })
  }, [s.bodyLogs, range, smooth, heightCm])

  // 直近の記録からの増減（同じ項目で、この日より前の最新値と比べる）
  const diff = (m: Metric) => {
    const now = valueOf(draft, m, heightCm)
    const before = [...s.bodyLogs].reverse().find((b) => b.date < date && valueOf(b, m, heightCm) !== null)
    const old = before ? valueOf(before, m, heightCm) : null
    return now !== null && old !== null ? now - old : null
  }

  const latestWeight = [...s.bodyLogs].reverse().find((b) => b.weight !== null)?.weight ?? null
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
        <em className={`num delta ${d === null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{d === null ? '' : signed(d)}</em>
      </div>
    )
  }

  const shown = charts.filter((c) => c.points.length > 0)
  const hidden = charts.filter((c) => c.points.length === 0)
  const isSaved = s.bodyLogs.some((b) => b.date === date)

  const Wrap = embedded ? Fragment : PageWrap

  return (
    <Wrap>
      <Panel label="RECORD" right={<span className="hint-inline">今日の体を記録</span>}>
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => move(-1)} aria-label="前の日"><IconBack /></button>
          <div className="date-pick">
            <h2 className="num">{fmtLong(date)}</h2>
            {date !== today && <button className="link" onClick={() => go(today)}>今日へ</button>}
          </div>
          <button className="icon-btn" onClick={() => move(1)} aria-label="次の日" disabled={date >= today}><IconNext /></button>
        </div>

        <div className="body-fields">
          {FIELDS.map((f) => (
            // 日付が変わったら入力欄を作り直し、その日の値を表示する
            <NumField
              key={`${rev}-${f.key}`}
              label={f.label}
              unit={f.unit}
              value={draft[f.key]}
              placeholder={prev?.[f.key] ? `前回 ${prev[f.key]}` : undefined}
              onChange={(v) => patch({ [f.key]: v } as Partial<BodyLog>)}
            />
          ))}
        </div>
        <label className="field">
          <span>メモ</span>
          <textarea key={rev} className="text" rows={2} maxLength={500} defaultValue={draft.note} onChange={(e) => patch({ note: e.target.value })} placeholder="食事・睡眠・体調など" />
        </label>
        <AutoSaveStatus dirty={dirty} justSaved={justSaved} idleText={isSaved ? 'この日の記録があります（入力は自動で保存されます）' : '入力すると自動で保存されます'} />
        <p className="hint">測らなかった項目は空欄のままで構いません。</p>
      </Panel>

      <Panel label="TREND" right={<span className="hint-inline">推移グラフ</span>}>
        <div className="seg wide" role="tablist" aria-label="期間">
          {RANGES.map((r) => (
            <button key={r.id} role="tab" aria-selected={range === r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>{r.label}</button>
          ))}
        </div>

        {shown.length === 0 && <p className="empty">体重などを記録すると、項目ごとの折れ線グラフがここに並びます</p>}

        {shown.map((c) => {
          const last = c.points[c.points.length - 1]
          const d = c.points.length > 1 ? last.value - c.points[0].value : null
          const open = big.includes(c.id)
          return (
            <section className="trend-card" key={c.id}>
              <button className="trend-head" onClick={() => setBig((b) => (open ? b.filter((v) => v !== c.id) : [...b, c.id]))} aria-expanded={open} aria-label={`${c.label}のグラフを${open ? '小さく' : '大きく'}表示`}>
                <span className="trend-name">{c.label}</span>
                <b className="num">
                  {round1(last.value)}
                  <small>{c.unit}</small>
                </b>
                <em className={`num delta ${d === null ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{d === null ? '' : `期間内 ${signed(d)}`}</em>
                {open ? <IconUp size={16} /> : <IconDown size={16} />}
              </button>
              {c.points.length < 2 ? (
                <p className="empty">あと1回記録するとグラフになります</p>
              ) : (
                <TrendChart key={`${c.id}-${range}-${smooth}`} points={c.points} unit={c.unit} compact={!open} goal={c.id === 'weight' ? s.settings.goalWeight : null} />
              )}
            </section>
          )
        })}

        {hidden.length > 0 && shown.length > 0 && <p className="hint">この期間に記録がない項目: {hidden.map((c) => c.label).join('・')}</p>}

        <button className="toggle-row" role="switch" aria-checked={smooth} onClick={() => setSmooth(!smooth)}>
          <span>
            7日移動平均
            <small>日々の水分量のブレをならして、本当の増減を見やすくします</small>
          </span>
          <i className={`toggle ${smooth ? 'on' : ''}`} aria-hidden="true" />
        </button>
        <p className="hint">グラフをなぞると日ごとの値が見られます。項目名をタップすると大きく表示します。</p>
      </Panel>

      <Panel label="AUTO CALC" right={<span className="hint-inline">前回比</span>}>
        <div className="derived">
          <DerivedRow label="BMI" m="bmi" value={calc.bmi} unit="" note={calc.bmi !== null ? bmiLabel(calc.bmi) : heightCm === null ? '下の PROFILE で身長を保存すると計算されます' : undefined} />
          <DerivedRow label="体脂肪量" m="fatMass" value={calc.fatMass} unit="kg" />
          <DerivedRow label="除脂肪体重" m="lean" value={calc.lean} unit="kg" />
        </div>
        {heightCm !== null && <p className="hint">身長 {heightCm}cm で計算しています（上の入力欄の値から自動計算）。</p>}
      </Panel>

      <ProfilePanel latestWeight={latestWeight} first30={first30} />
    </Wrap>
  )
}

/** 単独表示のときのページ枠 */
function PageWrap({ children }: { children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <h1>BODY COMP</h1>
      </header>
      {children}
    </div>
  )
}
