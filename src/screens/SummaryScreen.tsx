import { useMemo, useState } from 'react'
import { MuscleBadge, Stat } from '../components/Common'
import { fmtLong, fmtMinutes } from '../lib/date'
import { doneSets, fmtKg, fmtVolume, prIndex, workoutSetCount, workoutVolume } from '../lib/stats'
import { findExercise, saveTemplate, useStore } from '../lib/store'
import { toast } from '../lib/ui'
import type { Workout } from '../types'

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
                    <b className="num">{fmtKg(p.weight)}kg×{p.reps}</b>
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
