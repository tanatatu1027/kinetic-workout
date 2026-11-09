import { useMemo, useState } from 'react'
import { MuscleBadge, Panel, Stat } from '../components/Common'
import { TrendChart, type Point } from '../components/TrendChart'
import { isSeconds, MUSCLES } from '../data/exercises'
import { addDays, fmtShort, startOfWeek, toKey } from '../lib/date'
import { weekStreak } from '../lib/insights'
import { chronological, doneSets, e1rm, fmtKg, musclesOf, prIndex, round1, setVolume } from '../lib/stats'
import { findExercise, useStore } from '../lib/store'
import type { Muscle } from '../types'

type Metric = 'e1rm' | 'max' | 'volume' | 'reps'
const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: 'e1rm', label: '推定1RM', unit: 'kg' },
  { id: 'max', label: '最大重量', unit: 'kg' },
  { id: 'volume', label: '総量', unit: 'kg' },
  { id: 'reps', label: '最大回数', unit: '回' },
]

/** 部位ごとの週間セット数の目安（一般的に10セット前後から） */
const WEEKLY_TARGET = 10

export function AnalyticsScreen() {
  const s = useStore()
  const muscleFor = (id: string): Muscle => findExercise(s, id).muscle

  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of s.workouts) for (const x of w.exercises) if (doneSets(x.sets).length) m.set(x.exerciseId, (m.get(x.exerciseId) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  }, [s.workouts])

  const [picked, setPicked] = useState<string | null>(null)
  const [metric, setMetric] = useState<Metric>('e1rm')
  const exerciseId = picked && used.includes(picked) ? picked : used[0]
  // 自重・秒数の種目は重量の指標が意味を持たないので、回数（秒数）の推移だけを見せる
  const hasWeight = useMemo(
    () => !!exerciseId && s.workouts.some((w) => w.exercises.some((x) => x.exerciseId === exerciseId && doneSets(x.sets).some((st) => (st.weight ?? 0) > 0))),
    [s.workouts, exerciseId],
  )
  const eff: Metric = hasWeight ? metric : 'reps'
  const base = METRICS.find((m) => m.id === eff)!
  const meta = { ...base, unit: eff === 'reps' && exerciseId && isSeconds(exerciseId) ? '秒' : base.unit }

  const points: Point[] = useMemo(() => {
    if (!exerciseId) return []
    const out: Point[] = []
    for (const w of chronological(s.workouts)) {
      const sets = w.exercises.filter((x) => x.exerciseId === exerciseId).flatMap((x) => doneSets(x.sets))
      if (!sets.length) continue
      const value =
        eff === 'volume'
          ? sets.reduce((n, st) => n + setVolume(st), 0)
          : eff === 'max'
            ? sets.reduce((m, st) => Math.max(m, st.weight ?? 0), 0)
            : eff === 'reps'
              ? sets.reduce((m, st) => Math.max(m, st.reps ?? 0), 0)
              : sets.reduce((m, st) => Math.max(m, e1rm(st.weight ?? 0, st.reps!)), 0)
      out.push({ date: w.date, value: round1(value) })
    }
    return out
  }, [s.workouts, exerciseId, eff])

  const weekStart = toKey(startOfWeek(new Date()))
  const weekEnd = toKey(addDays(startOfWeek(new Date()), 6))
  const weekSets = useMemo(() => {
    const m = new Map<Muscle, number>()
    for (const w of s.workouts) {
      if (w.date < weekStart || w.date > weekEnd) continue
      for (const c of musclesOf(w, (id) => findExercise(s, id).muscle)) m.set(c.muscle, (m.get(c.muscle) ?? 0) + c.sets)
    }
    return m
  }, [s, weekStart, weekEnd])

  const maxSets = Math.max(WEEKLY_TARGET * 1.5, ...weekSets.values())

  const recentPrs = useMemo(() => {
    const ids = prIndex(s.workouts)
    const list: { key: string; date: string; name: string; muscle: Muscle; weight: number; reps: number }[] = []
    for (const w of chronological(s.workouts).reverse()) {
      for (const x of w.exercises) {
        for (const st of doneSets(x.sets)) {
          if (ids.has(st.id)) list.push({ key: st.id, date: w.date, name: findExercise(s, x.exerciseId).name, muscle: muscleFor(x.exerciseId), weight: st.weight ?? 0, reps: st.reps ?? 0 })
        }
      }
    }
    return list.slice(0, 6)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.workouts, s.customExercises])

  if (s.workouts.length === 0) {
    return (
      <div className="page">
        <header className="page-head"><h1>ANALYTICS</h1></header>
        <Panel><p className="empty big">トレーニングを記録すると、ここに推移や自己ベストが表示されます</p></Panel>
      </div>
    )
  }

  const latest = points[points.length - 1]
  const first = points[0]
  const best = points.length ? Math.max(...points.map((p) => p.value)) : 0

  return (
    <div className="page">
      <header className="page-head"><h1>ANALYTICS</h1></header>

      <Panel>
        <div className="stats">
          <Stat label="総セッション" value={s.workouts.length} unit="回" />
          <Stat label="連続週" value={weekStreak(s.workouts)} unit="週" />
          <Stat label="自己ベスト" value={prIndex(s.workouts).size} unit="回" />
        </div>
      </Panel>

      <Panel label="EXERCISE TREND">
        <select className="text" value={exerciseId} onChange={(e) => setPicked(e.target.value)} aria-label="種目を選択">
          {used.map((id) => <option key={id} value={id}>{findExercise(s, id).name}</option>)}
        </select>
        <div className="seg wide" role="tablist">
          {METRICS.filter((m) => (hasWeight ? m.id !== 'reps' : m.id === 'reps')).map((m) => (
            <button key={m.id} role="tab" aria-selected={eff === m.id} className={eff === m.id ? 'on' : ''} onClick={() => setMetric(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {latest && (
          <div className="stats">
            <Stat label="最新" value={fmtKg(latest.value)} unit={meta.unit} />
            <Stat label="最高" value={fmtKg(best)} unit={meta.unit} />
            <Stat label="初回から" value={`${latest.value - first.value >= 0 ? '+' : ''}${fmtKg(round1(latest.value - first.value))}`} unit={meta.unit} />
          </div>
        )}
        <TrendChart key={`${exerciseId}-${eff}`} points={points} unit={meta.unit} />
        <table className="mini-table">
          <caption className="hud-label">直近の記録</caption>
          <tbody>
            {points.slice(-5).reverse().map((p, i) => (
              <tr key={`${p.date}-${i}`}>
                <th scope="row">{fmtShort(p.date)}</th>
                <td className="num">{fmtKg(p.value)}{meta.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel label="WEEKLY SETS BY MUSCLE" right={<span className="day-date">目安 {WEEKLY_TARGET}セット</span>}>
        <ul className="bars">
          {MUSCLES.map((m) => {
            const n = weekSets.get(m.id) ?? 0
            return (
              <li key={m.id}>
                <span className="bar-label"><MuscleBadge muscle={m.id} size="sm" />{m.label}</span>
                <span className="bar-track">
                  <i style={{ width: `${(n / maxSets) * 100}%`, background: m.color }} />
                  <b style={{ left: `${(WEEKLY_TARGET / maxSets) * 100}%` }} aria-hidden="true" />
                </span>
                <span className="num bar-value">{n}</span>
              </li>
            )
          })}
        </ul>
      </Panel>

      <Panel label="PERSONAL RECORDS">
        {recentPrs.length === 0 ? (
          <p className="empty">同じ種目で記録を更新すると、ここに表示されます</p>
        ) : (
          <ul className="pr-list">
            {recentPrs.map((p) => (
              <li key={p.key}>
                <MuscleBadge muscle={p.muscle} size="sm" />
                <span className="pr-name">{p.name}</span>
                <span className="num pr-value">{fmtKg(p.weight)}×{p.reps}</span>
                <small>{fmtShort(p.date).split('（')[0]}</small>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
