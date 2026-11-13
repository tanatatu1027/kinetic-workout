import { useMemo, useState } from 'react'
import { MuscleBadge, Panel, Stat } from '../components/Common'
import { TrendChart, type Point } from '../components/TrendChart'
import { isSeconds, MUSCLES } from '../data/exercises'
import { regionInfo, targetsOf } from '../data/regions'
import { BodyCompScreen } from './BodyCompScreen'
import { addDays, fmtShort, startOfWeek, toKey } from '../lib/date'
import { weekStreak } from '../lib/insights'
import { chronological, doneSets, e1rm, fmtKg, prIndex, round1, setVolume } from '../lib/stats'
import { findExercise, useStore } from '../lib/store'
import type { Muscle } from '../types'

type Metric = 'e1rm' | 'max' | 'volume' | 'reps'
const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: 'e1rm', label: '推定1RM', unit: 'kg' },
  { id: 'max', label: '最大重量', unit: 'kg' },
  { id: 'volume', label: '総量', unit: 'kg' },
  { id: 'reps', label: '最大回数', unit: '回' },
]

const RANGES = [
  { id: 30, label: '1か月' },
  { id: 90, label: '3か月' },
  { id: 180, label: '6か月' },
  { id: 0, label: '全期間' },
]

/** 部位ごとの週間セット数の目安（一般的に週10セット前後から） */
const WEEKLY_TARGET = 10
/** これを超えると「多め」 */
const WEEKLY_HIGH = 20
/** 補助的に使う部位は0.5セットとして数える */
const SECONDARY_WEIGHT = 0.5

type Level = 'low' | 'mid' | 'high'
const levelOf = (n: number): Level => (n < WEEKLY_TARGET ? 'low' : n <= WEEKLY_HIGH ? 'mid' : 'high')
const LEVEL: Record<Level, { label: string; color: string }> = {
  low: { label: '少なめ', color: '#ffb02e' },
  mid: { label: '標準', color: '#a3e635' },
  high: { label: '多め', color: '#22d3ee' },
}

/** 画面の入口。トレーニング分析と体組成を切り替える */
export function AnalyticsScreen() {
  const [mode, setMode] = useState<'training' | 'body'>('training')
  return (
    <div className="page">
      <header className="page-head"><h1>ANALYTICS</h1></header>
      <div className="seg wide" role="group" aria-label="表示の切り替え">
        <button aria-pressed={mode === 'training'} className={mode === 'training' ? 'on' : ''} onClick={() => setMode('training')}>トレーニング分析</button>
        <button aria-pressed={mode === 'body'} className={mode === 'body' ? 'on' : ''} onClick={() => setMode('body')}>体組成</button>
      </div>
      {mode === 'training' ? <TrainingAnalytics /> : <BodyCompScreen embedded />}
    </div>
  )
}

function TrainingAnalytics() {
  const s = useStore()
  const muscleFor = (id: string): Muscle => findExercise(s, id).muscle

  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of s.workouts) for (const x of w.exercises) if (doneSets(x.sets).length) m.set(x.exerciseId, (m.get(x.exerciseId) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  }, [s.workouts])

  const [picked, setPicked] = useState<string | null>(null)
  const [metric, setMetric] = useState<Metric>('e1rm')
  const [range, setRange] = useState(0)
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

  const shownPoints = useMemo(() => {
    if (!range) return points
    const since = toKey(addDays(new Date(), -range))
    return points.filter((p) => p.date >= since)
  }, [points, range])

  const weekStart = toKey(startOfWeek(new Date()))
  const weekEnd = toKey(addDays(startOfWeek(new Date()), 6))
  // 今週のセット数。ウォームアップ・未完了のセットは数えない（doneSets）。
  // 主働の部位は1セット、同じ種目で補助的に使われる別の部位（種目ごとの部位データで0.4以上）は0.5セット
  const weekSets = useMemo(() => {
    const m = new Map<Muscle, number>()
    for (const w of s.workouts) {
      if (w.date < weekStart || w.date > weekEnd) continue
      for (const x of w.exercises) {
        const n = doneSets(x.sets).length
        if (!n) continue
        const ex = findExercise(s, x.exerciseId)
        m.set(ex.muscle, (m.get(ex.muscle) ?? 0) + n)
        const helped = new Set<Muscle>()
        for (const [region, weight] of targetsOf(ex)) {
          const g = regionInfo(region).group
          if (g !== ex.muscle && weight >= 0.4) helped.add(g)
        }
        for (const g of helped) m.set(g, (m.get(g) ?? 0) + n * SECONDARY_WEIGHT)
      }
    }
    return m
  }, [s, weekStart, weekEnd])

  const maxSets = Math.max(WEEKLY_HIGH * 1.2, ...weekSets.values())

  const recentPrs = useMemo(() => {
    const ids = prIndex(s.workouts)
    const list: { key: string; date: string; name: string; muscle: Muscle; weight: number; reps: number; sec: boolean }[] = []
    for (const w of chronological(s.workouts).reverse()) {
      for (const x of w.exercises) {
        for (const st of doneSets(x.sets)) {
          if (ids.has(st.id)) list.push({ key: st.id, date: w.date, name: findExercise(s, x.exerciseId).name, muscle: muscleFor(x.exerciseId), weight: st.weight ?? 0, reps: st.reps ?? 0, sec: isSeconds(x.exerciseId) })
        }
      }
    }
    return list.slice(0, 6)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.workouts, s.customExercises])

  if (s.workouts.length === 0) {
    return <Panel><p className="empty big">トレーニングを記録すると、ここに推移や自己ベストが表示されます</p></Panel>
  }

  const latest = shownPoints[shownPoints.length - 1]
  const first = shownPoints[0]
  const best = shownPoints.length ? Math.max(...shownPoints.map((p) => p.value)) : 0

  return (
    <>
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
        <div className="seg wide" role="group" aria-label="指標">
          {METRICS.filter((m) => (hasWeight ? m.id !== 'reps' : m.id === 'reps')).map((m) => (
            <button key={m.id} aria-pressed={eff === m.id} className={eff === m.id ? 'on' : ''} onClick={() => setMetric(m.id)}>
              {m.id === 'reps' && isSeconds(exerciseId) ? '最長秒' : m.label}
            </button>
          ))}
        </div>
        <div className="seg wide" role="group" aria-label="期間">
          {RANGES.map((r) => (
            <button key={r.id} aria-pressed={range === r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        {latest && (
          <div className="stats">
            <Stat label="最新" value={fmtKg(latest.value)} unit={meta.unit} />
            <Stat label="最高" value={fmtKg(best)} unit={meta.unit} />
            <Stat label={range ? '期間の初めから' : '初回から'} value={`${latest.value - first.value >= 0 ? '+' : ''}${fmtKg(round1(latest.value - first.value))}`} unit={meta.unit} />
          </div>
        )}
        {shownPoints.length < 2 && <p className="empty">この期間の記録が少ないため、グラフは表示されません。期間を長くしてみてください</p>}
        {shownPoints.length >= 2 && <TrendChart key={`${exerciseId}-${eff}-${range}`} points={shownPoints} unit={meta.unit} />}
        <table className="mini-table">
          <caption className="hud-label">直近の記録</caption>
          <tbody>
            {shownPoints.slice(-5).reverse().map((p, i) => (
              <tr key={`${p.date}-${i}`}>
                <th scope="row">{fmtShort(p.date)}</th>
                <td className="num">{fmtKg(p.value)}{meta.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel label="WEEKLY SETS BY MUSCLE" right={<span className="day-date">今週（日曜はじまり）</span>}>
        <ul className="bars">
          {MUSCLES.map((m) => {
            const n = weekSets.get(m.id) ?? 0
            const lv = LEVEL[levelOf(n)]
            return (
              <li key={m.id}>
                <span className="bar-label"><MuscleBadge muscle={m.id} size="sm" />{m.label}</span>
                <span className="bar-track">
                  <i style={{ width: `${Math.min(100, (n / maxSets) * 100)}%`, background: lv.color }} />
                  <b style={{ left: `${(WEEKLY_TARGET / maxSets) * 100}%` }} aria-hidden="true" />
                </span>
                <span className="num bar-value">{round1(n)}</span>
                <span className="bar-level" style={{ color: lv.color }}>{lv.label}</span>
              </li>
            )
          })}
        </ul>
        <p className="hint">縦線は週{WEEKLY_TARGET}セットの目安（{WEEKLY_TARGET}未満＝少なめ／{WEEKLY_TARGET}〜{WEEKLY_HIGH}＝標準／{WEEKLY_HIGH}超＝多め）。ウォームアップは数えず、補助的に使う部位は{SECONDARY_WEIGHT}セットとして数えています。</p>
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
                <span className="num pr-value">{p.sec ? `${p.reps}秒` : p.weight ? `${fmtKg(p.weight)}×${p.reps}` : `${p.reps}回`}</span>
                <small>{fmtShort(p.date).split('（')[0]}</small>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
