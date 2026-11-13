import { useMemo, useState } from 'react'
import { EQUIPMENT_LABEL, MUSCLES } from '../data/exercises'
import { addCustomExercise, allExercises, useStore } from '../lib/store'
import type { Equipment, Muscle } from '../types'
import { MuscleBadge, Sheet } from './Common'
import { ExerciseThumb, GuideSheet } from './ExerciseGuide'
import { IconCheck, IconInfo, IconNext, IconPlus } from './Icons'

/** 検索用: 大文字小文字・ひらがな/カタカナ・全角半角の揺れをそろえる */
const norm = (t: string) =>
  t
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))

/** onPick を渡さない場合は「種目ガイド」として、動きと解説を見るだけの一覧になる */
export function ExercisePicker({ onClose, onPick }: { onClose: () => void; onPick?: (ids: string[]) => void }) {
  const s = useStore()
  const browse = !onPick
  const [guideId, setGuideId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<Muscle | 'all'>('all')
  const [picked, setPicked] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [newMuscle, setNewMuscle] = useState<Muscle>('chest')
  const [newEq, setNewEq] = useState<Equipment>('machine')
  const [newName, setNewName] = useState('')

  // よく使う種目を上に並べる
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of s.workouts) for (const x of w.exercises) m.set(x.exerciseId, (m.get(x.exerciseId) ?? 0) + 1)
    return m
  }, [s.workouts])

  const list = useMemo(() => {
    const needle = norm(q.trim())
    return allExercises(s)
      .filter((e) => (muscle === 'all' || e.muscle === muscle) && (!needle || norm(e.name).includes(needle)))
      .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0))
  }, [s, q, muscle, usage])

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const create = () => {
    const name = newName.trim()
    if (!name) return
    const ex = addCustomExercise({ name, muscle: newMuscle, equipment: newEq })
    setPicked((p) => [...p, ex.id])
    setCreating(false)
    setNewName('')
    setQ('')
    setMuscle('all')
  }

  const startCreate = () => {
    setNewName(q.trim())
    setCreating(true)
  }

  if (creating) {
    return (
      <Sheet
        title="自作種目を追加"
        onClose={() => setCreating(false)}
        footer={
          <button className="btn primary wide" disabled={!newName.trim()} onClick={create}>
            追加する
          </button>
        }
      >
        <label className="field">
          <span>種目名</span>
          <input className="text" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} placeholder="例: スミスマシンベンチ" />
        </label>
        <div className="field">
          <span>部位</span>
          <div className="chips">
            {MUSCLES.map((m) => (
              <button key={m.id} className={`chip ${newMuscle === m.id ? 'on' : ''}`} onClick={() => setNewMuscle(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>器具</span>
          <div className="chips">
            {(Object.keys(EQUIPMENT_LABEL) as Equipment[]).map((k) => (
              <button key={k} className={`chip ${newEq === k ? 'on' : ''}`} onClick={() => setNewEq(k)}>
                {EQUIPMENT_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <>
    <Sheet
      tall
      title={browse ? '種目ガイド' : '種目を選ぶ'}
      onClose={onClose}
      footer={
        onPick ? (
          <button className="btn primary wide" disabled={picked.length === 0} onClick={() => onPick(picked)}>
            {picked.length > 0 ? `${picked.length}種目を追加` : '種目をタップして選択'}
          </button>
        ) : undefined
      }
    >
      <p className="hint">{browse ? '種目をタップすると、動きとやり方を確認できます。' : '右の「i」で、動きとやり方を確認できます。'}</p>
      <input className="text" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="種目名で検索" aria-label="種目名で検索" />
      <div className="chips scroll">
        <button className={`chip ${muscle === 'all' ? 'on' : ''}`} onClick={() => setMuscle('all')}>
          すべて
        </button>
        {MUSCLES.map((m) => (
          <button key={m.id} className={`chip ${muscle === m.id ? 'on' : ''}`} onClick={() => setMuscle(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {list.length === 0 && (
        <p className="hint">
          「{q}」は見つかりません。
          {!browse && <button className="link" onClick={startCreate}>自作種目として追加</button>}
        </p>
      )}
      <ul className="pick-list">
        {list.map((e) => {
          const on = picked.includes(e.id)
          return (
            <li key={e.id}>
              <button className={`pick-row ${on ? 'on' : ''}`} onClick={() => (browse ? setGuideId(e.id) : toggle(e.id))} aria-pressed={browse ? undefined : on}>
                <ExerciseThumb id={e.id} />
                <span className="pick-name">
                  {e.name}
                  <small><MuscleBadge muscle={e.muscle} size="sm" /> {EQUIPMENT_LABEL[e.equipment]}</small>
                </span>
                {browse ? <IconNext size={18} /> : <span className="pick-check">{on && <IconCheck size={18} />}</span>}
              </button>
              {!browse && (
                <button className="icon-btn pick-info" onClick={() => setGuideId(e.id)} aria-label={`${e.name}の動きを見る`}>
                  <IconInfo size={22} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {!browse && (
        <button className="btn wide" onClick={startCreate}>
          <IconPlus size={18} /> 自作種目を追加
        </button>
      )}
    </Sheet>
    {guideId && <GuideSheet exerciseId={guideId} onClose={() => setGuideId(null)} />}
    </>
  )
}
