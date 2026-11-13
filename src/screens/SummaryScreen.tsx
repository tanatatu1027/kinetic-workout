import { useMemo, useState } from 'react'
import { MuscleBadge, Stat } from '../components/Common'
import { isSeconds } from '../data/exercises'
import { fmtLong, fmtMinutes, fmtShort } from '../lib/date'
import { averageRir, compareWithPrevious, doneSets, fmtKg, fmtVolume, prIndex, workoutSetCount, workoutVolume } from '../lib/stats'
import { findExercise, saveTemplate, useStore } from '../lib/store'
import { toast } from '../lib/ui'
import type { Workout } from '../types'
import '../workout-extra.css'

/** 増減の表示。0 は「前回と同じ」 */
function Diff({ n, unit = '' }: { n: number; unit?: string }) {
  if (n === 0) return <b className="cmp-same">前回と同じ</b>
  return <b className={n > 0 ? 'cmp-up' : 'cmp-down'}>{n > 0 ? '+' : '−'}{fmtKg(Math.abs(n))}{unit}</b>
}

export function SummaryScreen({ workout, onClose, onShowDay }: { workout: Workout; onClose: () => void; onShowDay: () => void }) {
  const s = useStore()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState(workout.title)

  const prs = useMemo(() => {
    const ids = prIndex(s.workouts)
    return workout.exercises.flatMap((x) =>
      doneSets(x.sets)
        .filter((st) => ids.has(st.id))
        .map((st) => ({ id: st.id, exerciseId: x.exerciseId, weight: st.weight ?? 0, reps: st.reps ?? 0 })),
    )
  }, [s.workouts, workout])

  const cmp = useMemo(() => compareWithPrevious(s.workouts, workout), [s.workouts, workout])

  const rir = useMemo(() => averageRir(workout), [workout])
  const duration = workout.endedAt - workout.startedAt

  const save = () => {
    if (!name.trim()) return
    saveTemplate(name.trim(), workout.exercises.map((x) => ({ exerciseId: x.exerciseId, sets: Math.min(30, Math.max(1, x.sets.length)) })))
    toast('テンプレートに保存しました')
    setNaming(false)
  }

  return (
    <div className="summary" role="dialog" aria-modal="true" aria-label="トレーニング結果">
      <div className="summary-inner">
        <p className="hud-label">SESSION COMPLETE</p>
        <h1>{workout.title}</h1>
        <p className="summary-date">{fmtLong(workout.date)}</p>

        <div className="stats">
          {duration > 0 && <Stat label="時間" value={fmtMinutes(duration)} />}
          <Stat label="セット" value={workoutSetCount(workout)} />
          <Stat label="総量" value={fmtVolume(workoutVolume(workout))} unit="kg" />
          {rir && <Stat label="平均RIR" value={(Math.round(rir.avg * 10) / 10).toFixed(1)} unit="回" />}
        </div>

        {prs.length > 0 && (
          <section className="summary-pr">
            <h2 className="hud-label">NEW RECORD ×{prs.length}</h2>
            <ul>
              {prs.map((p) => {
                const ex = findExercise(s, p.exerciseId)
                return (
                  <li key={p.id}>
                    <MuscleBadge muscle={ex.muscle} size="sm" />
                    <span>{ex.name}</span>
                    <b className="num">{p.weight > 0 ? `${fmtKg(p.weight)}kg×${p.reps}` : `${p.reps}${isSeconds(p.exerciseId) ? '秒' : '回'}`}</b>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {cmp && (
          <section className="summary-cmp">
            <h2 className="hud-label">VS 前回（{fmtShort(cmp.prev.date)}・{cmp.sameTitle ? '同じメニュー' : '近い内容'}）</h2>
            <ul className="cmp-list">
              <li><span>総量</span><Diff n={cmp.volume} unit="kg" /></li>
              <li><span>セット数</span><Diff n={cmp.sets} unit="セット" /></li>
              {cmp.exercises.map((d) => {
                const ex = findExercise(s, d.exerciseId)
                const unit = d.kind === 'weight' ? 'kg' : isSeconds(d.exerciseId) ? '秒' : '回'
                return (
                  <li key={d.exerciseId}>
                    <span>
                      {ex.name}
                      <br />
                      <small className="cmp-sub">{d.kind === 'weight' ? '最高重量' : isSeconds(d.exerciseId) ? '最長' : '最大回数'} {fmtKg(d.prev)}{unit} → {fmtKg(d.cur)}{unit}{d.repsAtTop && d.repsAtTop.prev !== d.repsAtTop.cur ? `（${fmtKg(d.cur)}kgの最大回数 ${d.repsAtTop.prev}→${d.repsAtTop.cur}回）` : ''}</small>
                    </span>
                    <Diff n={d.diff} unit={unit} />
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <div className="stack">
          {naming ? (
            <div className="inline-form">
              <input className="text" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} aria-label="テンプレート名" />
              <button className="btn" onClick={save} disabled={!name.trim()}>保存</button>
            </div>
          ) : (
            <button className="btn wide" onClick={() => setNaming(true)}>このメニューをテンプレートに保存</button>
          )}
          <button className="btn wide" onClick={onShowDay}>カレンダーで見る</button>
          <button className="btn primary wide big" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}
