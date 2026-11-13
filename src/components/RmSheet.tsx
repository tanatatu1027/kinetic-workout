import { useMemo, useState } from 'react'
import { Sheet } from './Common'
import { IconMinus, IconPlus } from './Icons'
import { DEFAULT_PLATES, doneSets, e1rm, fmtKg, plateCalc } from '../lib/stats'
import '../workout-extra.css'
import { findExercise, useStore } from '../lib/store'

/** 回数ごとの目的の目安（一般的な区分） */
const purpose = (reps: number) => (reps <= 5 ? '筋力' : reps <= 12 ? '筋肥大' : '筋持久力')

const PLATE_KEY = 'kinetic.plates'
const loadPlates = (): number[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PLATE_KEY) ?? 'null')
    if (Array.isArray(v) && v.every((n) => typeof n === 'number' && n > 0)) return v
  } catch {
    /* 既定値を使う */
  }
  return DEFAULT_PLATES
}

/** 目標重量から、バーの片側に付けるプレートの枚数を出す */
function PlatePanel({ initialWeight }: { initialWeight?: number }) {
  const [targetText, setTargetText] = useState(initialWeight ? fmtKg(initialWeight) : '60')
  const [barText, setBarText] = useState('20')
  const [have, setHave] = useState<number[]>(loadPlates)
  const target = parseFloat(targetText)
  const bar = parseFloat(barText)
  const valid = Number.isFinite(target) && target > 0 && Number.isFinite(bar) && bar >= 0
  const res = valid ? plateCalc(target, bar, have) : null
  const toggle = (p: number) =>
    setHave((cur) => {
      const next = cur.includes(p) ? cur.filter((v) => v !== p) : [...cur, p]
      try {
        localStorage.setItem(PLATE_KEY, JSON.stringify(next))
      } catch {
        /* 保存できなくても計算は続ける */
      }
      return next
    })
  return (
    <>
      <div className="rm-input">
        <label className="field">
          <span>目標重量</span>
          <div className="inline-form">
            <input className="text num" inputMode="decimal" value={targetText} onChange={(e) => setTargetText(e.target.value.replace(/[^\d.]/g, ''))} />
            <span className="unit">kg</span>
          </div>
        </label>
        <label className="field">
          <span>バーの重さ</span>
          <div className="inline-form">
            <input className="text num" inputMode="decimal" value={barText} onChange={(e) => setBarText(e.target.value.replace(/[^\d.]/g, ''))} />
            <span className="unit">kg</span>
          </div>
        </label>
      </div>
      <div className="field">
        <span>手持ちのプレート（タップで切り替え）</span>
        <div className="chips scroll">
          {DEFAULT_PLATES.map((p) => (
            <button key={p} className={`chip ${have.includes(p) ? 'on' : ''}`} aria-pressed={have.includes(p)} onClick={() => toggle(p)}>
              {p}kg
            </button>
          ))}
        </div>
      </div>
      <div className="rm-result">
        <span>片側に付けるプレート</span>
        {res && res.perSide.length > 0 ? (
          <ul className="plate-list">
            {res.perSide.map((v) => (
              <li key={v.plate}>
                <b className="num">{v.plate}<small>kg</small></b>
                <span className="num">× {v.count}枚</span>
              </li>
            ))}
          </ul>
        ) : (
          <b className="num">{res ? 'プレート不要' : '---'}</b>
        )}
      </div>
      {res && (
        <p className={res.remainder !== 0 ? 'plate-warn' : 'hint'}>
          合計 {fmtKg(res.total)}kg（バー{fmtKg(bar)}kg＋両側{fmtKg((res.total - bar) / 2)}kg×2）
          {res.remainder > 0 && ` ／ 目標まであと${fmtKg(res.remainder)}kg。手持ちのプレートでは組めません`}
          {res.remainder < 0 && ' ／ バーより軽い目標です'}
        </p>
      )}
    </>
  )
}

/** 重量×回数から推定1RMを出し、回数別の目安重量を一覧する。「プレート計算」タブも持つ */
export function RmSheet({ onClose, initial = 'rm', plateWeight }: { onClose: () => void; initial?: 'rm' | 'plate'; plateWeight?: number }) {
  const s = useStore()
  const [tab, setTab] = useState<'rm' | 'plate'>(initial)
  const step = s.settings.weightStep
  const [weightText, setWeightText] = useState('60')
  const [reps, setReps] = useState(5)
  const weight = parseFloat(weightText)
  const valid = Number.isFinite(weight) && weight > 0
  const oneRm = valid ? e1rm(weight, reps) : null

  // 過去の記録から、種目ごとの最高推定1RMのセットを取り出して入力に使えるようにする
  const bests = useMemo(() => {
    const m = new Map<string, { weight: number; reps: number; v: number }>()
    for (const w of s.workouts)
      for (const x of w.exercises)
        for (const st of doneSets(x.sets)) {
          if (!st.weight) continue
          const v = e1rm(st.weight, st.reps!)
          if (v > (m.get(x.exerciseId)?.v ?? 0)) m.set(x.exerciseId, { weight: st.weight, reps: st.reps!, v })
        }
    return [...m.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 12)
  }, [s.workouts])

  // 実際に積めるよう、増減幅の刻みに丸める
  const round = (n: number) => Math.round(n / step) * step

  return (
    <Sheet tall title={tab === 'rm' ? 'RM計算' : 'プレート計算'} onClose={onClose}>
      <div className="chips" role="tablist">
        <button role="tab" aria-selected={tab === 'rm'} className={`chip ${tab === 'rm' ? 'on' : ''}`} onClick={() => setTab('rm')}>RM計算</button>
        <button role="tab" aria-selected={tab === 'plate'} className={`chip ${tab === 'plate' ? 'on' : ''}`} onClick={() => setTab('plate')}>プレート計算</button>
      </div>
      {tab === 'plate' ? <PlatePanel initialWeight={plateWeight} /> : <>
      <div className="rm-input">
        <label className="field">
          <span>重量</span>
          <div className="inline-form">
            <input className="text num" inputMode="decimal" value={weightText} onChange={(e) => setWeightText(e.target.value.replace(/[^\d.]/g, ''))} />
            <span className="unit">kg</span>
          </div>
        </label>
        <div className="field">
          <span>回数</span>
          <div className="stepper">
            <button className="icon-btn" aria-label="回数を減らす" onClick={() => setReps((r) => Math.max(1, r - 1))}><IconMinus size={18} /></button>
            <b className="num">{reps}</b>
            <button className="icon-btn" aria-label="回数を増やす" onClick={() => setReps((r) => Math.min(30, r + 1))}><IconPlus size={18} /></button>
          </div>
        </div>
      </div>

      {bests.length > 0 && (
        <div className="field">
          <span>自己ベストから入力</span>
          <div className="chips scroll">
            {bests.map(([id, b]) => (
              <button key={id} className="chip" onClick={() => { setWeightText(fmtKg(b.weight)); setReps(Math.min(30, b.reps)) }}>
                {findExercise(s, id).name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rm-result">
        <span>推定1RM</span>
        <b className="num">{oneRm === null ? '---' : fmtKg(Math.round(oneRm * 100) / 100)}<small>kg</small></b>
      </div>

      <ul className="rm-table">
        {Array.from({ length: 15 }, (_, i) => i + 1).map((r) => {
          const w = oneRm === null ? null : r === 1 ? oneRm : oneRm / (1 + r / 30)
          return (
            <li key={r} className={r === reps ? 'on' : ''}>
              <span className={`rm-tag p-${purpose(r)}`}>{purpose(r)}</span>
              <b className="num">{r}<small>回</small></b>
              <span className="num rm-pct">{oneRm && w ? Math.round((w / oneRm) * 100) : '--'}%</span>
              <span className="num rm-w">{w === null ? '---' : fmtKg(round(w))}<small>kg</small></span>
            </li>
          )
        })}
      </ul>
      <p className="hint">Epley式（重量×(1+回数÷30)）による推定です。実際の限界は体調や種目で変わるため、目安として使ってください。表の重量は設定の増減幅（{step}kg）に丸めています。</p>
      </>}
    </Sheet>
  )
}
