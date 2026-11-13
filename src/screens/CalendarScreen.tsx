import { useEffect, useMemo, useRef, useState } from 'react'
import type { StartOptions } from '../App'
import { MuscleBadge, Panel, Stat } from '../components/Common'
import { IconBack, IconNext } from '../components/Icons'
import { isSeconds, MUSCLES } from '../data/exercises'
import { fmtLong, fmtMinutes, fromKey, toKey, todayKey, WEEK_JP } from '../lib/date'
import { fmtKg, fmtVolume, musclesOf, prIndex, workoutSetCount, workoutVolume } from '../lib/stats'
import { deleteWorkout, findExercise, useStore } from '../lib/store'
import { askConfirm, toast } from '../lib/ui'
import type { Muscle, Workout } from '../types'

interface Props {
  selected: string
  onSelect: (date: string) => void
  onStart: (o: StartOptions) => void
  onEdit: (id: string) => void
}

function WorkoutDetail({ w, prs, onStart, onEdit }: { w: Workout; prs: Set<string>; onStart: Props['onStart']; onEdit: Props['onEdit'] }) {
  const s = useStore()
  const duration = w.endedAt - w.startedAt
  const start = new Date(w.startedAt)
  return (
    <article className="day-card">
      <header>
        <h3>{w.title}</h3>
        <p className="day-meta">
          {duration > 0 && <span>{`${start.getHours()}:${String(start.getMinutes()).padStart(2, '0')}開始 ・ ${fmtMinutes(duration)} ・ `}</span>}
          <span className="num">{workoutSetCount(w)}セット ・ {fmtVolume(workoutVolume(w))}kg</span>
        </p>
      </header>
      <ul className="day-ex">
        {w.exercises.map((x) => {
          const ex = findExercise(s, x.exerciseId)
          return (
            <li key={x.id}>
              <div className="day-ex-head">
                <MuscleBadge muscle={ex.muscle} size="sm" />
                <b>{ex.name}</b>
              </div>
              <div className="day-sets">
                {x.sets.map((st) => (
                  <span key={st.id} className={`day-set ${st.warmup ? 'warm' : ''} ${prs.has(st.id) ? 'pr' : ''}`}>
                    {st.warmup && <i>W</i>}
                    {isSeconds(x.exerciseId) ? `${st.reps}秒` : <>{st.weight ? `${fmtKg(st.weight)}kg` : '自重'}×{st.reps}</>}
                    {prs.has(st.id) && <em>PR</em>}
                  </span>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
      {w.note && <p className="day-note">{w.note}</p>}
      <div className="day-actions">
        <button className="btn ghost" onClick={() => onStart({ title: w.title, items: w.exercises.map((x) => ({ exerciseId: x.exerciseId, sets: x.sets.length })) })}>
          同じ種目で開始
        </button>
        <button className="btn ghost" onClick={() => onEdit(w.id)}>
          編集
        </button>
        <button
          className="btn ghost danger-text"
          onClick={async () => {
            // 編集中の記録を消すと、保存しても反映されなくなるため先に編集を終えてもらう
            if (s.active?.id === w.id) return toast('編集中の記録です。先に編集を保存または破棄してください')
            if (await askConfirm({ title: 'この記録を削除しますか？', body: `${fmtLong(w.date)} の「${w.title}」を削除します。元に戻せません。`, ok: '削除', danger: true })) deleteWorkout(w.id)
          }}
        >
          削除
        </button>
      </div>
    </article>
  )
}

function YearView({ year, byDate, selected, onPick }: { year: number; byDate: Map<string, Workout[]>; selected: string; onPick: (date: string) => void }) {
  const today = todayKey()
  const level = (n: number) => (n === 0 ? 0 : n < 8 ? 1 : n < 15 ? 2 : n < 22 ? 3 : 4)
  return (
    <div className="year-grid">
      {Array.from({ length: 12 }, (_, m) => {
        const days = new Date(year, m + 1, 0).getDate()
        const blanks = new Date(year, m, 1).getDay()
        return (
          <div key={m} className="mini-month">
            <h4>{m + 1}月</h4>
            <div className="mini-days">
              {Array.from({ length: blanks }, (_, i) => <span key={`b${i}`} />)}
              {Array.from({ length: days }, (_, i) => {
                const date = toKey(new Date(year, m, i + 1))
                const sets = (byDate.get(date) ?? []).reduce((n, w) => n + workoutSetCount(w), 0)
                return (
                  <button
                    key={date}
                    className={`mini-day l${level(sets)} ${date === today ? 'today' : ''} ${date === selected ? 'sel' : ''}`}
                    onClick={() => onPick(date)}
                    aria-label={`${m + 1}月${i + 1}日 ${sets}セット`}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function CalendarScreen({ selected, onSelect, onStart, onEdit }: Props) {
  const s = useStore()
  const sel = fromKey(selected)
  const [cursor, setCursor] = useState({ y: sel.getFullYear(), m: sel.getMonth() })
  const [view, setView] = useState<'month' | 'year'>('month')
  const [filter, setFilter] = useState<Muscle | 'all'>('all')
  const today = todayKey()
  const touchX = useRef<number | null>(null)
  const touchY = useRef(0)

  // 他の画面から日付を指定されて開いたとき、その月へ移動する
  useEffect(() => {
    const d = fromKey(selected)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
  }, [selected])

  const byDate = useMemo(() => {
    const m = new Map<string, Workout[]>()
    for (const w of s.workouts) m.set(w.date, [...(m.get(w.date) ?? []), w])
    return m
  }, [s.workouts])

  // 部位で絞り込んだ集計用。その部位の種目だけを残し、該当のない日は空にする
  const shown = useMemo(() => {
    if (filter === 'all') return byDate
    const m = new Map<string, Workout[]>()
    for (const [date, list] of byDate) {
      const keep = list
        .map((w) => ({ ...w, exercises: w.exercises.filter((x) => findExercise(s, x.exerciseId).muscle === filter) }))
        .filter((w) => w.exercises.length > 0)
      if (keep.length) m.set(date, keep)
    }
    return m
  }, [byDate, filter, s])

  const prs = useMemo(() => prIndex(s.workouts), [s.workouts])
  const muscleFor = (id: string): Muscle => findExercise(s, id).muscle

  const moveMonth = (d: number) =>
    setCursor(({ y, m }) => {
      const dt = new Date(y, m + d, 1)
      return { y: dt.getFullYear(), m: dt.getMonth() }
    })

  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const blanks = new Date(cursor.y, cursor.m, 1).getDay()
  const prefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-`
  const monthWorkouts = [...shown.values()].flat().filter((w) => w.date.startsWith(prefix))
  const trainedDays = new Set(monthWorkouts.map((w) => w.date)).size
  const dayWorkouts = byDate.get(selected) ?? []
  const isFuture = selected > today

  return (
    <div className="page">
      <header className="page-head">
        <h1>CALENDAR</h1>
        <div className="head-actions">
          {selected !== today && <button className="link" onClick={() => onSelect(today)}>今日へ</button>}
          <div className="seg" role="group" aria-label="表示の切り替え">
            <button aria-pressed={view === 'month'} className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}>月</button>
            <button aria-pressed={view === 'year'} className={view === 'year' ? 'on' : ''} onClick={() => setView('year')}>年</button>
          </div>
        </div>
      </header>

      <div className="chips scroll" role="group" aria-label="部位で絞り込み">
        <button className={`chip ${filter === 'all' ? 'on' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>ALL</button>
        {MUSCLES.map((m) => (
          <button key={m.id} className={`chip ${filter === m.id ? 'on' : ''}`} aria-pressed={filter === m.id} onClick={() => setFilter(m.id)}>{m.label}</button>
        ))}
      </div>

      <Panel>
        {view === 'month' ? (
          <div
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; touchY.current = e.touches[0].clientY }}
            onTouchCancel={() => { touchX.current = null }}
            onTouchEnd={(e) => {
              if (touchX.current === null) return
              const dx = e.changedTouches[0].clientX - touchX.current
              const dy = e.changedTouches[0].clientY - touchY.current
              touchX.current = null
              if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) moveMonth(dx < 0 ? 1 : -1)
            }}
          >
            <div className="cal-nav">
              <button className="icon-btn" onClick={() => moveMonth(-1)} aria-label="前の月"><IconBack /></button>
              <h2 className="num">{cursor.y}.{String(cursor.m + 1).padStart(2, '0')}</h2>
              <button className="icon-btn" onClick={() => moveMonth(1)} aria-label="次の月"><IconNext /></button>
            </div>
            <div className="cal-week">
              {WEEK_JP.map((w, i) => <span key={w} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{w}</span>)}
            </div>
            <div className="cal-grid">
              {Array.from({ length: blanks }, (_, i) => <span key={`b${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const date = `${prefix}${String(i + 1).padStart(2, '0')}`
                const list = shown.get(date) ?? []
                const counts = new Map<Muscle, number>()
                for (const w of list) for (const m of musclesOf(w, muscleFor)) counts.set(m.muscle, (counts.get(m.muscle) ?? 0) + m.sets)
                const muscles = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m)
                const label = muscles.map((m) => MUSCLES.find((v) => v.id === m)!.label).join('、')
                return (
                  <button
                    key={date}
                    className={`cal-day ${list.length ? 'has' : ''} ${date === today ? 'today' : ''} ${date === selected ? 'sel' : ''}`}
                    onClick={() => onSelect(date)}
                    aria-label={`${cursor.m + 1}月${i + 1}日 ${list.length ? label : '記録なし'}`}
                    aria-pressed={date === selected}
                  >
                    <span className="cal-num">{i + 1}</span>
                    <span className="cal-marks">
                      {muscles.slice(0, 3).map((m) => <MuscleBadge key={m} muscle={m} size="sm" />)}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="legend">
              {MUSCLES.map((m) => (
                <span key={m.id}><MuscleBadge muscle={m.id} size="sm" />{m.label}</span>
              ))}
            </div>
            <div className="stats">
              <Stat label={`${cursor.m + 1}月の日数`} value={trainedDays} unit="日" />
              <Stat label="総セット" value={monthWorkouts.reduce((n, w) => n + workoutSetCount(w), 0)} />
              <Stat label="総量" value={fmtVolume(monthWorkouts.reduce((n, w) => n + workoutVolume(w), 0))} unit="kg" />
            </div>
          </div>
        ) : (
          <>
            <div className="cal-nav">
              <button className="icon-btn" onClick={() => setCursor((c) => ({ ...c, y: c.y - 1 }))} aria-label="前の年"><IconBack /></button>
              <h2 className="num">{cursor.y}</h2>
              <button className="icon-btn" onClick={() => setCursor((c) => ({ ...c, y: c.y + 1 }))} aria-label="次の年"><IconNext /></button>
            </div>
            <YearView
              year={cursor.y}
              byDate={shown}
              selected={selected}
              onPick={(date) => {
                onSelect(date)
                const d = fromKey(date)
                setCursor({ y: d.getFullYear(), m: d.getMonth() })
                setView('month')
              }}
            />
            <div className="year-legend">
              <span>セット数 少</span>
              {[1, 2, 3, 4].map((l) => <i key={l} className={`mini-day l${l}`} />)}
              <span>多</span>
            </div>
          </>
        )}
      </Panel>

      <Panel label="DAY LOG" right={<span className="day-date">{fmtLong(selected)}</span>}>
        {dayWorkouts.length === 0 && <p className="empty">{isFuture ? '未来の日付です' : 'この日の記録はありません'}</p>}
        {dayWorkouts.map((w) => <WorkoutDetail key={w.id} w={w} prs={prs} onStart={onStart} onEdit={onEdit} />)}
        {!isFuture && (
          <button className="btn wide" onClick={() => onStart({ title: selected === today ? 'フリートレーニング' : 'トレーニング', items: [], date: selected })}>
            {selected === today ? 'この日のトレーニングを開始' : 'この日の記録を追加'}
          </button>
        )}
      </Panel>
    </div>
  )
}
