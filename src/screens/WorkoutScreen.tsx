import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { MuscleBadge, Sheet, useNow } from '../components/Common'
import { ExerciseThumb, GuideSheet } from '../components/ExerciseGuide'
import { ExercisePicker } from '../components/ExercisePicker'
import { IconBack, IconBolt, IconCheck, IconClose, IconDown, IconMinus, IconPlay, IconPlus, IconUp } from '../components/Icons'
import { Keypad } from '../components/Keypad'
import { RmSheet } from '../components/RmSheet'
import { fmtDuration, fmtLong, fmtShort } from '../lib/date'
import { unlockAudio } from '../lib/sound'
import {
  bestScores,
  doneSets,
  fmtKg,
  fmtVolume,
  isLowerBody,
  progressionFor,
  recentSessions,
  repRangeFor,
  setScore,
  suggestedRest,
  type Bests,
  type Progression,
  type Session,
  type TimeRef,
} from '../lib/stats'
import { adjustRest, blankSet, buildSets, clearRest, discardActive, findExercise, finishActive, getState, setExerciseNote, setExerciseRest, startRest, uid, updateActive, useStore } from '../lib/store'
import '../workout-extra.css'
import { askChoice, askConfirm, toast } from '../lib/ui'
import { isSeconds, stepFor } from '../data/exercises'
import { hasGuide } from '../data/guides'
import type { SetEntry, Workout, WorkoutExercise } from '../types'

type Field = 'weight' | 'reps'
interface Cursor {
  xId: string
  sId: string
  field: Field
}

/** 入力中の行がキーパッドに隠れないよう、行の下端がキーパッドの上に来るまでスクロールする */
function revealAboveKeypad(setId: string) {
  window.setTimeout(() => {
    const row = document.querySelector(`[data-set="${CSS.escape(setId)}"]`)
    const box = document.querySelector('.wk-scroll')
    if (!row || !box) return
    const rowBox = row.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    const keypad = document.querySelector('.keypad')
    const limit = (keypad ? keypad.getBoundingClientRect().top : boxRect.bottom) - 10
    if (rowBox.bottom > limit) box.scrollBy({ top: rowBox.bottom - limit, behavior: 'smooth' })
    else if (rowBox.top < boxRect.top + 8) box.scrollBy({ top: rowBox.top - boxRect.top - 8, behavior: 'smooth' })
  }, 90)
}

const patchSet = (xId: string, sId: string, fn: (s: SetEntry) => SetEntry) =>
  updateActive((a) => ({
    ...a,
    exercises: a.exercises.map((x) => (x.id === xId ? { ...x, sets: x.sets.map((st) => (st.id === sId ? fn(st) : st)) } : x)),
  }))

const patchExercise = (xId: string, fn: (x: WorkoutExercise) => WorkoutExercise) =>
  updateActive((a) => ({ ...a, exercises: a.exercises.map((x) => (x.id === xId ? fn(x) : x)) }))

/** 実施中は画面を消さない（非表示で解除されるので復帰時に取り直す） */
function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let alive = true
    const acquire = async () => {
      try {
        if (document.visibilityState !== 'visible') return
        void lock?.release().catch(() => undefined)
        const l = await navigator.wakeLock.request('screen')
        if (alive) lock = l
        else void l.release()
      } catch {
        /* 未対応端末では何もしない */
      }
    }
    void acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release().catch(() => undefined)
    }
  }, [enabled])
}

const fmtRest = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

/** 画面のセット番号と同じ体系（ウォームアップは W、本番は 1 からの連番）で数える */
const workingNo = (sets: SetEntry[], idx: number) => sets.slice(0, idx + 1).filter((v) => !v.warmup).length
const setName = (sets: SetEntry[], idx: number) => (sets[idx]?.warmup ? 'ウォームアップ' : `${workingNo(sets, idx)}セット目`)

/** 種目ごとの休憩時間。15秒刻み、30秒〜5分 */
function RestSheet({ exerciseId, onClose }: { exerciseId: string; onClose: () => void }) {
  const s = useStore()
  const own = s.settings.restByExercise?.[exerciseId]
  const common = s.settings.restSeconds
  const value = own ?? common
  const hint = suggestedRest(exerciseId)
  const set = (v: number) => setExerciseRest(exerciseId, Math.min(300, Math.max(30, v)))
  return (
    <Sheet title={`${findExercise(s, exerciseId).name}の休憩`} onClose={onClose}>
      <div className="stepper rest-stepper">
        <button className="icon-btn" aria-label="15秒減らす" disabled={value <= 30} onClick={() => set(value - 15)}><IconMinus size={18} /></button>
        <b className="num">{fmtRest(value)}</b>
        <button className="icon-btn" aria-label="15秒増やす" disabled={value >= 300} onClick={() => set(value + 15)}><IconPlus size={18} /></button>
      </div>
      <p className="hint">{own === undefined ? `今は共通設定（${fmtRest(common)}）です。` : 'この種目だけ変えています。'}</p>
      <button className="btn wide" disabled={own === hint} onClick={() => setExerciseRest(exerciseId, hint)}>
        目安にする（{fmtRest(hint)}）
      </button>
      <p className="hint">大きい種目（ベンチプレス・スクワットなど）は2〜3分、単関節の種目は90秒が目安です。</p>
      <button className="btn wide" disabled={own === undefined} onClick={() => setExerciseRest(exerciseId, null)}>
        共通に戻す（{fmtRest(common)}）
      </button>
    </Sheet>
  )
}

/** セット番号。タップでメニュー、長押し(0.5秒)でウォームアップ切替。誤操作を避けるため1タップでは切り替えない */
function SetNoButton({ label, warm, aria, onTap, onLong }: { label: string; warm: boolean; aria: string; onTap: () => void; onLong: () => void }) {
  const timer = useRef<number | undefined>(undefined)
  const fired = useRef(false)
  const [pressing, setPressing] = useState(false)
  const cancel = () => {
    window.clearTimeout(timer.current)
    setPressing(false)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      className={`set-no ${warm ? 'warm' : ''} ${pressing ? 'pressing' : ''}`}
      aria-label={aria}
      onPointerDown={() => {
        fired.current = false
        setPressing(true)
        timer.current = window.setTimeout(() => {
          fired.current = true
          setPressing(false)
          onLong()
        }, 500)
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (fired.current) {
          fired.current = false
          return
        }
        onTap()
      }}
    >
      {label}
    </button>
  )
}

const RIR_CHOICES: { v: 0 | 1 | 2 | 3; label: string }[] = [
  { v: 0, label: '限界' },
  { v: 1, label: 'あと1〜2回' },
  { v: 3, label: 'あと3回以上' },
]

/** 保存値 → 表示名（UIの選択肢は 0 / 1 / 3。2 は取り込んだデータ用） */
export const rirLabel = (v: 0 | 1 | 2 | 3) => (v === 0 ? '限界' : v === 3 ? 'あと3回以上' : 'あと1〜2回')

/** ダブルプログレッションの提案を、未完了の本番セットへ当てはめた結果 */
function planSets(sets: SetEntry[], p: Progression): SetEntry[] {
  let w = 0
  return sets.map((st) => {
    if (st.done || st.warmup) return st
    const j = w++
    if (p.kind === 'raise') return { ...st, weight: p.weight, reps: p.startReps }
    if (p.kind === 'deload') return { ...st, weight: p.weight }
    if (p.kind === 'hold') return { ...st, weight: p.weight, reps: p.targets[j] ?? p.targets[p.targets.length - 1] }
    return { ...st, weight: p.weight > 0 ? p.weight : st.weight, reps: p.targets[j] ?? p.targets[p.targets.length - 1] }
  })
}

function RestDock({ endsAt, duration }: { endsAt: number; duration: number }) {
  const now = useNow(250)
  const left = Math.max(0, endsAt - now)
  const ratio = Math.min(1, left / (duration * 1000))
  return (
    <div className="rest-dock" role="timer" aria-label="休憩タイマー">
      <div className="rest-bar" style={{ transform: `scaleX(${ratio})` }} />
      <button className="rest-adj" onClick={() => adjustRest(-15)} aria-label="15秒減らす">
        −15
      </button>
      <div className="rest-time">
        <small>REST</small>
        <b>{fmtDuration(left + 999)}</b>
      </div>
      <button className="rest-adj" onClick={() => adjustRest(15)} aria-label="15秒増やす">
        +15
      </button>
      <button className="rest-skip" onClick={clearRest}>
        スキップ
      </button>
    </div>
  )
}

function ElapsedClock({ startedAt }: { startedAt: number }) {
  const now = useNow(1000)
  return <span className="num elapsed">{fmtDuration(now - startedAt)}</span>
}

export function WorkoutScreen({ onMinimize, onClosed }: { onMinimize: () => void; onClosed: (saved: Workout | null) => void }) {
  const s = useStore()
  const a = s.active!
  // 空のセッションで始めた場合は、最初の操作である種目選択を開いておく
  const [picking, setPicking] = useState(() => a.exercises.length === 0)
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [buffer, setBuffer] = useState('')
  const [fresh, setFresh] = useState(true)
  const [guideId, setGuideId] = useState<string | null>(null)
  const [restId, setRestId] = useState<string | null>(null)
  const [setMenu, setSetMenu] = useState<{ xId: string; sId: string } | null>(null)
  const [calc, setCalc] = useState<{ tab: 'rm' | 'plate'; weight?: number } | null>(null)
  /** 完了直後に「あと何回できたか」を尋ねるセットのID（数秒で消える） */
  const [rirFor, setRirFor] = useState<string | null>(null)
  useEffect(() => {
    if (!rirFor) return
    const t = window.setTimeout(() => setRirFor(null), 8000)
    return () => window.clearTimeout(t)
  }, [rirFor])
  const [noteOpen, setNoteOpen] = useState<string[]>([])
  const live = a.mode === 'live'
  useWakeLock(live)

  const ref: TimeRef = useMemo(() => ({ date: a.date, startedAt: a.startedAt, id: a.id }), [a.date, a.startedAt, a.id])
  const exerciseKey = a.exercises.map((x) => x.exerciseId).join(',')

  // 種目ごとの直近2回の記録と、これまでの自己ベスト（重量あり=推定1RM / 自重・秒数=回数）
  const history = useMemo(() => {
    const map = new Map<string, { sessions: Session[]; bests: Bests }>()
    for (const id of exerciseKey ? exerciseKey.split(',') : []) {
      map.set(id, { sessions: recentSessions(s.workouts, id, ref, 2), bests: bestScores(s.workouts, id, ref) })
    }
    return map
  }, [exerciseKey, s.workouts, ref])

  const total = a.exercises.reduce((n, x) => n + x.sets.length, 0)
  const done = a.exercises.reduce((n, x) => n + x.sets.filter((st) => st.done).length, 0)
  const volume = a.exercises.reduce((n, x) => n + doneSets(x.sets).reduce((v, st) => v + (st.weight ?? 0) * (st.reps ?? 0), 0), 0)

  const findSet = (cur: Cursor) => a.exercises.find((x) => x.id === cur.xId)?.sets.find((st) => st.id === cur.sId)

  const openCell = (next: Cursor) => {
    leaveCell()
    // 値の流し込み直後なので、描画時点のaではなく最新のstateから読む
    const st = getState().active?.exercises.find((x) => x.id === next.xId)?.sets.find((v) => v.id === next.sId)
    const v = st?.[next.field]
    setBuffer(v === null || v === undefined ? '' : String(v))
    setFresh(true)
    setCursor(next)
    revealAboveKeypad(next.sId)
  }

  /** セルを離れる時、後続の未入力セットへ同じ値を流し込む */
  const leaveCell = () => {
    if (!cursor) return
    const st = findSet(cursor)
    if (!st || st[cursor.field] === null || st.warmup) return
    const { xId, sId, field } = cursor
    const value = st[field]
    patchExercise(xId, (x) => {
      const at = x.sets.findIndex((v) => v.id === sId)
      return { ...x, sets: x.sets.map((v, i) => (i > at && !v.done && v[field] === null ? { ...v, [field]: value } : v)) }
    })
  }

  const closeKeypad = () => {
    leaveCell()
    setCursor(null)
  }

  const commit = (text: string) => {
    if (!cursor) return
    const n = text === '' || text === '.' ? null : Number(text)
    const value = n === null || Number.isNaN(n) ? null : n
    // 値を消した/0にした完了済みセットは、空のまま保存されないよう未完了に戻す
    patchSet(cursor.xId, cursor.sId, (st) => ({
      ...st,
      [cursor.field]: value,
      done: st.done && value !== null && !(cursor.field === 'reps' && value === 0),
    }))
  }

  const onKey = (k: string) => {
    if (!cursor) return
    let next: string
    if (k === 'back') next = fresh ? '' : buffer.slice(0, -1)
    else if (k === '.') {
      if (cursor.field !== 'weight' || (!fresh && buffer.includes('.'))) return
      next = fresh ? '0.' : buffer + '.'
    } else {
      const base = fresh ? '' : buffer
      if (base.length >= 6) return
      next = base === '0' ? k : base + k
    }
    setFresh(false)
    setBuffer(next)
    commit(next)
  }

  const onStep = (d: number) => {
    const next = Math.max(0, Math.round(((Number(buffer) || 0) + d) * 100) / 100)
    const text = String(next)
    setBuffer(text)
    setFresh(true)
    commit(text)
  }

  const isBodyweight = (exerciseId: string) => findExercise(s, exerciseId).equipment === 'bodyweight'

  const nextSetId = (afterId: string) => {
    const flat = getState().active!.exercises.flatMap((x) => x.sets)
    const at = flat.findIndex((st) => st.id === afterId)
    // 後ろに無ければ、飛ばしたセットを先頭から探す
    return [...flat.slice(at + 1), ...flat.slice(0, at)].find((st) => !st.done)?.id ?? null
  }

  const toggleDone = (x: WorkoutExercise, st: SetEntry) => {
    unlockAudio()
    leaveCell()
    if (st.done) {
      patchSet(x.id, st.id, (v) => {
        const { rir: _rir, ...rest } = v
        return { ...rest, done: false }
      })
      setRirFor((c) => (c === st.id ? null : c))
      return
    }
    if (st.weight === null && !isBodyweight(x.exerciseId)) return openCell({ xId: x.id, sId: st.id, field: 'weight' })
    if (!st.reps) {
      if (cursor?.sId === st.id && cursor.field === 'reps') toast(isSeconds(x.exerciseId) ? '秒数を入力してください' : '回数を入力してください')
      return openCell({ xId: x.id, sId: st.id, field: 'reps' })
    }
    patchSet(x.id, st.id, (v) => ({ ...v, done: true }))
    setRirFor(st.warmup ? null : st.id)
    setCursor(null)
    // 自己ベスト更新を、その場でトースト+振動で知らせる（重量あり=推定1RM、自重・秒数=回数）
    const sc = !st.warmup ? setScore(st) : null
    if (sc) {
      const cur = getState()
      const prior = bestScores(cur.workouts, x.exerciseId, ref)[sc.kind]
      const before = x.sets
        .slice(0, x.sets.findIndex((v) => v.id === st.id))
        .filter((v) => v.done && !v.warmup)
        .map(setScore)
        .filter((c) => c?.kind === sc.kind)
      const base = Math.max(prior ?? 0, ...before.map((c) => c!.v))
      if (prior !== null && sc.v > base + 1e-6) {
        const label = st.weight ? `${fmtKg(st.weight)}kg×${st.reps}` : `${st.reps}${isSeconds(x.exerciseId) ? '秒' : '回'}`
        toast(`自己ベスト更新！ ${findExercise(cur, x.exerciseId).name} ${label}`)
        navigator.vibrate?.([60, 40, 60])
      }
    }
    const nextId = nextSetId(st.id)
    if (nextId) {
      if (live && !st.warmup && getState().settings.autoRest) {
        const cfg = getState().settings
        startRest(cfg.restByExercise?.[x.exerciseId] ?? cfg.restSeconds)
      }
      window.setTimeout(() => {
        document.querySelector(`[data-set="${CSS.escape(nextId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 120)
    } else {
      clearRest()
      toast(live ? '全セット完了 おつかれさまでした' : '全セット入力済みです')
    }
  }

  const onNext = () => {
    if (!cursor) return
    if (cursor.field === 'weight') {
      openCell({ ...cursor, field: 'reps' })
      return
    }
    const x = getState().active?.exercises.find((v) => v.id === cursor.xId)
    const st = x?.sets.find((v) => v.id === cursor.sId)
    if (!x || !st) return setCursor(null)
    if (st.done) {
      leaveCell()
      return setCursor(null)
    }
    toggleDone(x, st)
  }

  const addSet = (x: WorkoutExercise) =>
    patchExercise(x.id, (v) => ({ ...v, sets: [...v.sets, blankSet(v.sets[v.sets.length - 1])] }))

  const removeSet = (x: WorkoutExercise) => {
    setCursor(null)
    const removed = x.sets[x.sets.length - 1]
    if (!removed) return
    patchExercise(x.id, (v) => ({ ...v, sets: v.sets.slice(0, -1) }))
    // 確認ダイアログの代わりに「元に戻す」で救済する（ジム中の操作を妨げない）
    toast('セットを削除しました', {
      label: '元に戻す',
      run: () => patchExercise(x.id, (v) => (v.sets.some((q) => q.id === removed.id) ? v : { ...v, sets: [...v.sets, removed] })),
    })
  }

  const toggleWarmup = (x: WorkoutExercise, st: SetEntry) => {
    const was = !!st.warmup
    patchSet(x.id, st.id, (v) => ({ ...v, warmup: !was }))
    toast(was ? '本番セットに戻しました' : 'ウォームアップにしました（記録・PRの集計対象外）', {
      label: '元に戻す',
      run: () => patchSet(x.id, st.id, (v) => ({ ...v, warmup: was })),
    })
  }

  const deleteSet = (x: WorkoutExercise, st: SetEntry) => {
    const idx = x.sets.findIndex((v) => v.id === st.id)
    if (idx < 0) return
    if (cursor?.sId === st.id) setCursor(null)
    patchExercise(x.id, (v) => ({ ...v, sets: v.sets.filter((q) => q.id !== st.id) }))
    toast(`${setName(x.sets, idx)}を削除しました`, {
      label: '元に戻す',
      run: () =>
        patchExercise(x.id, (v) => {
          if (v.sets.some((q) => q.id === st.id)) return v
          const list = [...v.sets]
          list.splice(Math.min(idx, list.length), 0, st)
          return { ...v, sets: list }
        }),
    })
  }

  const moveExercise = (i: number, d: number) =>
    updateActive((w) => {
      const list = [...w.exercises]
      const j = i + d
      if (j < 0 || j >= list.length) return w
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...w, exercises: list }
    })

  const removeExercise = (x: WorkoutExercise) => {
    const name = findExercise(s, x.exerciseId).name
    setCursor(null)
    const idx = getState().active?.exercises.findIndex((v) => v.id === x.id) ?? -1
    updateActive((w) => ({ ...w, exercises: w.exercises.filter((v) => v.id !== x.id) }))
    toast(`${name}を外しました`, {
      label: '元に戻す',
      run: () =>
        updateActive((w) => {
          if (w.exercises.some((v) => v.id === x.id)) return w
          const list = [...w.exercises]
          list.splice(Math.min(Math.max(idx, 0), list.length), 0, x)
          return { ...w, exercises: list }
        }),
    })
  }

  const addExercises = (ids: string[]) => {
    const state = getState()
    updateActive((w) => ({
      ...w,
      exercises: [...w.exercises, ...ids.map((id) => ({ id: uid(), exerciseId: id, sets: buildSets(state, id, null, ref) }))],
    }))
    setPicking(false)
  }

  const finish = async () => {
    closeKeypad()
    const cur = getState().active!
    // 過去日の記録は✓を押さず入力だけで済ませがちなので、入力済みのセットを完了として保存できるようにする
    if (cur.mode !== 'live') {
      const filled = new Set(
        cur.exercises.flatMap((x) =>
          x.sets.filter((v) => !v.done && !v.warmup && v.reps && (v.weight || isBodyweight(x.exerciseId))).map((v) => v.id),
        ),
      )
      if (filled.size > 0) {
        // 前回の値が事前入力されているだけのセットを実績にしないよう、選べるようにする
        const choice = await askChoice({
          title: cur.mode === 'edit' ? '変更を保存しますか？' : 'この日の記録を保存しますか？',
          body: `チェックしていない入力済みのセットが${filled.size}件あります。実際に行ったセットなら完了にして保存してください。`,
          ok: '完了にして保存',
          alt: 'チェック済みだけ保存',
        })
        if (choice === 'cancel') return
        if (choice === 'ok') {
          updateActive((w) => ({ ...w, exercises: w.exercises.map((x) => ({ ...x, sets: x.sets.map((v) => (filled.has(v.id) ? { ...v, done: true } : v)) })) }))
          onClosed(finishActive())
          return
        }
      }
    }
    if (done === 0) {
      if (a.mode === 'edit') return toast('完了済みのセットがありません')
      const ok = await askConfirm({ title: '記録がありません', body: '完了にしたセットがないため保存されません。このまま終了しますか？', ok: '破棄して終了', danger: true })
      if (ok) {
        discardActive()
        onClosed(null)
      }
      return
    }
    const rest = total - done
    const ok = await askConfirm({
      title: a.mode === 'edit' ? '変更を保存しますか？' : a.mode === 'backfill' ? 'この日の記録を保存しますか？' : 'トレーニングを終了しますか？',
      body: rest > 0 ? `未完了の${rest}セットは保存されません。` : undefined,
      ok: '保存する',
    })
    if (!ok) return
    onClosed(finishActive())
  }

  const cancel = async () => {
    const ok = await askConfirm({
      title: a.mode === 'edit' ? '編集を破棄しますか？' : 'この記録を破棄しますか？',
      body: a.mode === 'edit' ? '保存済みの記録は変更前のまま残ります。' : '入力した内容はすべて消えます。',
      ok: '破棄する',
      danger: true,
    })
    if (ok) {
      discardActive()
      onClosed(null)
    }
  }

  const cursorExercise = cursor ? a.exercises.find((x) => x.id === cursor.xId) : undefined
  const cursorSetIdx = cursor && cursorExercise ? cursorExercise.sets.findIndex((st) => st.id === cursor.sId) : -1

  return (
    <div className="workout">
      <header className="wk-head">
        <button className="icon-btn" onClick={onMinimize} aria-label="記録を開いたまま戻る">
          <IconBack />
        </button>
        <div className="wk-title">
          <input
            aria-label="セッション名"
            value={a.title}
            maxLength={30}
            onChange={(e) => updateActive((w) => ({ ...w, title: e.target.value }))}
            onFocus={closeKeypad}
          />
          <div className="wk-sub">
            {live ? <ElapsedClock startedAt={a.startedAt} /> : <span>{fmtLong(a.date)}</span>}
            <span className="num">{done}/{total} SET</span>
            <span className="num">{fmtVolume(volume)} kg</span>
          </div>
        </div>
        <button className="btn primary small" onClick={finish}>
          {live ? '終了' : '保存'}
        </button>
      </header>
      <div className="wk-progress">
        <i style={{ transform: `scaleX(${total ? done / total : 0})` }} />
      </div>

      <div className={`wk-scroll ${cursor ? 'with-keypad' : ''} ${s.rest ? 'with-rest' : ''}`}>
        {a.exercises.length === 0 && <p className="empty big">下のボタンから種目を追加してください</p>}

        {a.exercises.map((x, i) => {
          const ex = findExercise(s, x.exerciseId)
          const h = history.get(x.exerciseId)
          const sessions = h?.sessions ?? []
          const lastSession = sessions[0]
          const last = lastSession?.sets
          const secs = isSeconds(ex.id)
          const prog =
            live || a.mode === 'backfill'
              ? progressionFor(sessions.map((v) => v.sets), {
                  range: repRangeFor(ex.id, ex.equipment),
                  step: stepFor(ex.equipment, s.settings.weightStep),
                  lower: isLowerBody(ex.id, ex.muscle),
                  repStep: secs ? 5 : 1,
                })
              : null
          const range = repRangeFor(ex.id, ex.equipment)
          const planned = prog ? planSets(x.sets, prog) : null
          const canApply = !!planned && planned.some((st, n) => st.weight !== x.sets[n].weight || st.reps !== x.sets[n].reps)
          const unit = secs ? '秒' : '回'
          const bests: Bests = { ...(h?.bests ?? { w: null, r: null }) }
          const restSec = s.settings.restByExercise?.[ex.id] ?? s.settings.restSeconds
          const noteShown = !!x.note || noteOpen.includes(x.id)
          return (
            <section className="ex-card" key={x.id}>
              <header className="ex-head">
                {hasGuide(ex.id) ? (
                  <button
                    className="ex-demo-btn"
                    title="タップで動きを確認"
                    onClick={() => {
                      closeKeypad()
                      setGuideId(ex.id)
                    }}
                    aria-label={`${ex.name}の動きを見る`}
                  >
                    <ExerciseThumb id={ex.id} />
                    <span><IconPlay size={12} /> やり方</span>
                  </button>
                ) : (
                  <MuscleBadge muscle={ex.muscle} />
                )}
                <h3>
                  {ex.name}
                  {hasGuide(ex.id) && <small><MuscleBadge muscle={ex.muscle} size="sm" /></small>}
                </h3>
                <div className="ex-tools">
                  <button onClick={() => moveExercise(i, -1)} disabled={i === 0} aria-label="上へ移動"><IconUp size={20} /></button>
                  <button onClick={() => moveExercise(i, 1)} disabled={i === a.exercises.length - 1} aria-label="下へ移動"><IconDown size={20} /></button>
                  <button className="ex-remove" onClick={() => removeExercise(x)} aria-label={`${ex.name}を外す`}><IconClose size={20} /></button>
                </div>
              </header>

              <div className="ex-meta">
                {lastSession && <span className="ex-last">前回 {fmtShort(lastSession.date)}</span>}
                <button className="meta-chip" onClick={() => { closeKeypad(); setRestId(ex.id) }} aria-label={`${ex.name}の休憩時間を変える`}>
                  休憩 {fmtRest(restSec)}{s.settings.restByExercise?.[ex.id] !== undefined && ' ●'}
                </button>
                <button
                  className={`meta-chip ${x.note ? 'on' : ''}`}
                  aria-expanded={noteShown}
                  onClick={() => setNoteOpen((l) => (l.includes(x.id) ? l.filter((v) => v !== x.id) : [...l, x.id]))}
                >
                  メモ
                </button>
                {ex.equipment === 'barbell' && (
                  <button
                    className="meta-chip"
                    onClick={() => {
                      closeKeypad()
                      const target = x.sets.find((st) => !st.done && !st.warmup && st.weight)?.weight ?? last?.[0]?.weight ?? undefined
                      setCalc({ tab: 'plate', weight: target })
                    }}
                  >
                    プレート
                  </button>
                )}
              </div>
              {lastSession?.note && <p className="ex-prevnote">前回のメモ: {lastSession.note}</p>}
              {noteShown && (
                <textarea
                  className="text ex-note"
                  rows={2}
                  maxLength={500}
                  value={x.note ?? ''}
                  aria-label={`${ex.name}のメモ`}
                  placeholder="フォームの注意、シート位置など"
                  onFocus={closeKeypad}
                  onChange={(e) => setExerciseNote(x.id, e.target.value)}
                />
              )}

              {prog && (
                <button
                  className={`suggest ${prog.kind === 'deload' ? 'warn' : ''}`}
                  disabled={!canApply}
                  onClick={() => {
                    closeKeypad()
                    patchExercise(x.id, (v) => ({ ...v, sets: planSets(v.sets, prog) }))
                  }}
                >
                  <IconBolt size={16} />
                  <span>
                    {prog.kind === 'raise' && (
                      <>前回は全セット{range.max}回に到達{prog.big && '（余力あり）'}。<b>{fmtKg(prog.weight)}kg</b> に上げて{prog.startReps}回から（目安 {range.min}〜{range.max}回）</>
                    )}
                    {prog.kind === 'hold' && (
                      <>限界（あと0回）が続いています。<b>{fmtKg(prog.weight)}kg</b> のまま据え置き（{prog.targets.join('/')}{unit}を目標に）</>
                    )}
                    {prog.kind === 'deload' && (
                      <>下限（{range.min}回）を2回続けて下回りました。<b>{fmtKg(prog.weight)}kg</b> に下げて立て直し</>
                    )}
                    {prog.kind === 'reps' && prog.weight > 0 && (
                      <>同じ <b>{fmtKg(prog.weight)}kg</b> で回数を増やす（目標: 各セット+1回 → {prog.targets.join('/')}{unit}）</>
                    )}
                    {prog.kind === 'reps' && prog.weight === 0 && (
                      <>{unit}を伸ばす（目標: 各セット+{secs ? 5 : 1}{unit} → {prog.targets.join('/')}{unit}）</>
                    )}
                  </span>
                </button>
              )}

              <div className="set-grid set-head" aria-hidden="true">
                <span>SET</span>
                <span>前回</span>
                <span>KG</span>
                <span>{unit}</span>
                <span />
              </div>

              {x.sets.map((st, n) => {
                const no = workingNo(x.sets, n)
                const name = setName(x.sets, n)
                // 前回は本番セットのみ。ウォームアップ行を数えるとずれる
                const prev = st.warmup ? undefined : last?.[no - 1]
                const editing = (f: Field) => cursor?.sId === st.id && cursor.field === f
                let pr = false
                const sc = st.done && !st.warmup ? setScore(st) : null
                if (sc) {
                  // 初めての種目は最初のセットを基準にし、以降の更新をPRとする（サマリーと同じ判定）
                  const cur = bests[sc.kind]
                  if (cur === null) bests[sc.kind] = sc.v
                  else if (sc.v > cur + 1e-6) {
                    pr = true
                    bests[sc.kind] = sc.v
                  }
                }
                const shown = (f: Field) => {
                  if (editing(f)) return buffer || '–'
                  const v = st[f]
                  if (v === null) return f === 'weight' && ex.equipment === 'bodyweight' ? '自重' : '–'
                  return String(v)
                }
                return (
                  <Fragment key={st.id}>
                  <div className={`set-grid set-row ${st.done ? 'done' : ''} ${pr ? 'pr' : ''}`} data-set={st.id}>
                    <SetNoButton
                      label={st.warmup ? 'W' : String(no)}
                      warm={!!st.warmup}
                      aria={`${name}のメニュー（長押しでウォームアップ切替）`}
                      onTap={() => {
                        closeKeypad()
                        setSetMenu({ xId: x.id, sId: st.id })
                      }}
                      onLong={() => toggleWarmup(x, st)}
                    />
                    <button
                      className="set-prev"
                      disabled={!prev || st.done}
                      onClick={() => {
                        if (!prev) return
                        closeKeypad()
                        patchSet(x.id, st.id, (v) => ({ ...v, weight: prev.weight, reps: prev.reps }))
                      }}
                      aria-label={prev ? `前回 ${prev.weight ?? 0}キロ ${prev.reps}回を入力` : '前回記録なし'}
                    >
                      {prev ? (isSeconds(ex.id) ? `${prev.reps}秒` : `${prev.weight ? fmtKg(prev.weight) : '自重'}×${prev.reps}`) : '—'}
                    </button>
                    <button className={`cell ${editing('weight') ? 'editing' : ''} ${editing('weight') && fresh ? 'fresh' : ''}`} onClick={() => openCell({ xId: x.id, sId: st.id, field: 'weight' })} aria-label={`${name}の重量 ${shown('weight')}`}>
                      {shown('weight')}
                    </button>
                    <button className={`cell ${editing('reps') ? 'editing' : ''} ${editing('reps') && fresh ? 'fresh' : ''}`} onClick={() => openCell({ xId: x.id, sId: st.id, field: 'reps' })} aria-label={`${name}の回数 ${shown('reps')}`}>
                      {shown('reps')}
                    </button>
                    <button className="check" onClick={() => toggleDone(x, st)} aria-pressed={st.done} aria-label={st.done ? '完了を取り消す' : 'セット完了'}>
                      {pr ? <b>PR</b> : <IconCheck size={24} />}
                    </button>
                  </div>
                  {st.done && rirFor === st.id && (
                    <div className="rir-row" role="group" aria-label={`${name}の余力（あと何回できたか）`}>
                      <span>余力</span>
                      {RIR_CHOICES.map((c) => (
                        <button
                          key={c.v}
                          className={`rir-chip ${st.rir === c.v ? 'on' : ''}`}
                          aria-pressed={st.rir === c.v}
                          onClick={() => {
                            patchSet(x.id, st.id, (v) => ({ ...v, rir: c.v }))
                            setRirFor(null)
                          }}
                        >
                          {c.label}
                        </button>
                      ))}
                      <button className="rir-chip skip" onClick={() => setRirFor(null)}>スキップ</button>
                    </div>
                  )}
                  {st.done && st.rir !== undefined && rirFor !== st.id && (
                    <p className="rir-tag">余力: {rirLabel(st.rir)}</p>
                  )}
                  </Fragment>
                )
              })}

              <div className="ex-foot">
                <button className="btn ghost" onClick={() => addSet(x)}>
                  <IconPlus size={16} /> セット追加
                </button>
                <button className="btn ghost" onClick={() => removeSet(x)} disabled={x.sets.length === 0}>
                  <IconMinus size={16} /> 最後を削除
                </button>
              </div>
            </section>
          )
        })}

        <button className="btn wide add-ex" onClick={() => { closeKeypad(); setPicking(true) }}>
          <IconPlus size={18} /> 種目を追加
        </button>
        <button className="btn wide" onClick={() => { closeKeypad(); setCalc({ tab: 'rm' }) }}>
          <IconBolt size={18} /> RM・プレート計算
        </button>

        <label className="field">
          <span>メモ</span>
          <textarea
            className="text"
            rows={2}
            maxLength={500}
            value={a.note}
            placeholder="調子やフォームの気づきなど"
            onFocus={closeKeypad}
            onChange={(e) => updateActive((w) => ({ ...w, note: e.target.value }))}
          />
        </label>

        <button className="btn danger-text wide" onClick={cancel}>
          {a.mode === 'edit' ? '編集を破棄' : 'この記録を破棄'}
        </button>
      </div>

      {s.rest && !cursor && live && <p className="rest-note">画面を消さないでください（マナーモードだと音が鳴らない場合があります）</p>}
      {s.rest && !cursor && <RestDock endsAt={s.rest.endsAt} duration={s.rest.duration} />}

      {cursor && cursorExercise && (
        <Keypad
          field={cursor.field}
          label={`${findExercise(s, cursorExercise.exerciseId).name} ${setName(cursorExercise.sets, cursorSetIdx)} / ${cursor.field === 'weight' ? '重量 kg' : isSeconds(cursorExercise.exerciseId) ? '秒数' : '回数'}`}
          value={buffer}
          step={stepFor(findExercise(s, cursorExercise.exerciseId).equipment, s.settings.weightStep)}
          restEndsAt={s.rest?.endsAt ?? null}
          onKey={onKey}
          onStep={onStep}
          onNext={onNext}
          onClose={closeKeypad}
        />
      )}

      {restId && <RestSheet exerciseId={restId} onClose={() => setRestId(null)} />}
      {calc && <RmSheet initial={calc.tab} plateWeight={calc.weight} onClose={() => setCalc(null)} />}
      {setMenu && (() => {
        const mx = a.exercises.find((v) => v.id === setMenu.xId)
        const mi = mx ? mx.sets.findIndex((v) => v.id === setMenu.sId) : -1
        if (!mx || mi < 0) return null
        const st = mx.sets[mi]
        return (
          <Sheet title={`${findExercise(s, mx.exerciseId).name} ${setName(mx.sets, mi)}`} onClose={() => setSetMenu(null)}>
            <button className="btn wide" onClick={() => { toggleWarmup(mx, st); setSetMenu(null) }}>
              {st.warmup ? '本番セットに戻す' : 'ウォームアップにする（記録・PRの集計対象外）'}
            </button>
            <button className="btn wide danger-text" onClick={() => { deleteSet(mx, st); setSetMenu(null) }}>
              <IconClose size={16} /> このセットを削除
            </button>
            <p className="hint">番号の長押し（0.5秒）でも、ウォームアップを切り替えられます。</p>
          </Sheet>
        )
      })()}
      {picking && <ExercisePicker onClose={() => setPicking(false)} onPick={addExercises} />}
      {guideId && <GuideSheet exerciseId={guideId} onClose={() => setGuideId(null)} />}
    </div>
  )
}
