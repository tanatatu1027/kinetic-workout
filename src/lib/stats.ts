import type { Muscle, SetEntry, Workout } from '../types'

/** Epley式の推定1RM。1回なら実重量そのまま */
export const e1rm = (weight: number, reps: number) => (reps <= 1 ? weight : weight * (1 + reps / 30))

export const round1 = (n: number) => Math.round(n * 10) / 10

/** 1.25kg刻みにも対応するため小数2桁まで表示する */
export const fmtKg = (n: number) => String(Math.round(n * 100) / 100)

export const fmtVolume = (n: number) => Math.round(n).toLocaleString('ja-JP')

/** 集計対象のセット（完了済みかつウォームアップ以外） */
export const doneSets = (sets: SetEntry[]) => sets.filter((s) => s.done && s.reps && !s.warmup)

export const setVolume = (s: SetEntry) => (s.weight ?? 0) * (s.reps ?? 0)

export const workoutVolume = (w: Workout) =>
  w.exercises.reduce((sum, x) => sum + doneSets(x.sets).reduce((a, s) => a + setVolume(s), 0), 0)

export const workoutSetCount = (w: Workout) => w.exercises.reduce((sum, x) => sum + doneSets(x.sets).length, 0)

export const chronological = (ws: Workout[]) =>
  [...ws].sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt)

export interface TimeRef {
  date: string
  startedAt: number
  id: string
}

const isBefore = (w: Workout, ref: TimeRef) =>
  w.date < ref.date || (w.date === ref.date && w.startedAt < ref.startedAt)

/** 基準より前で、その種目を行った直近のセッション */
export function lastSets(workouts: Workout[], exerciseId: string, ref: TimeRef) {
  const sorted = chronological(workouts).reverse()
  for (const w of sorted) {
    if (w.id === ref.id || !isBefore(w, ref)) continue
    const x = w.exercises.find((e) => e.exerciseId === exerciseId)
    const sets = x ? doneSets(x.sets) : []
    if (sets.length) return { date: w.date, sets }
  }
  return null
}

/** 1セットの成績。重量があれば推定1RM(w)、無ければ回数・秒数(r)。両者は混ぜて比べない */
export type ScoreKind = 'w' | 'r'
export interface SetScore {
  kind: ScoreKind
  v: number
}
export function setScore(s: SetEntry): SetScore | null {
  if (!s.reps) return null
  return s.weight ? { kind: 'w', v: e1rm(s.weight, s.reps) } : { kind: 'r', v: s.reps }
}

export type Bests = Record<ScoreKind, number | null>

/** 基準より前の、その種目の自己ベスト（重量種目は推定1RM、自重・秒数は最大回数）。実績がなければ null */
export function bestScores(workouts: Workout[], exerciseId: string, ref: TimeRef): Bests {
  const best: Bests = { w: null, r: null }
  for (const w of workouts) {
    if (w.id === ref.id || !isBefore(w, ref)) continue
    for (const x of w.exercises) {
      if (x.exerciseId !== exerciseId) continue
      for (const s of doneSets(x.sets)) {
        const sc = setScore(s)
        if (sc && (best[sc.kind] === null || sc.v > best[sc.kind]!)) best[sc.kind] = sc.v
      }
    }
  }
  return best
}

/** 基準より前の、その種目の推定1RM最高値（重量のある記録のみ。なければ null） */
export const bestBefore = (workouts: Workout[], exerciseId: string, ref: TimeRef) => bestScores(workouts, exerciseId, ref).w

/** 全履歴を時系列に走査し、自己ベストを更新したセットIDを集める。初回記録はPR扱いしない */
export function prIndex(workouts: Workout[]) {
  const best = new Map<string, number>()
  const prSets = new Set<string>()
  for (const w of chronological(workouts)) {
    for (const x of w.exercises) {
      for (const s of doneSets(x.sets)) {
        const sc = setScore(s)
        if (!sc) continue
        const key = `${x.exerciseId}:${sc.kind}`
        const cur = best.get(key)
        if (cur === undefined) best.set(key, sc.v)
        else if (sc.v > cur + 1e-6) {
          best.set(key, sc.v)
          prSets.add(s.id)
        }
      }
    }
  }
  return prSets
}

export interface Session {
  date: string
  sets: SetEntry[]
  note: string
}

/** 基準より前でその種目を行った直近 n 回のセッション（新しい順。本番セットのみ） */
export function recentSessions(workouts: Workout[], exerciseId: string, ref: TimeRef, n = 2): Session[] {
  const out: Session[] = []
  for (const w of chronological(workouts).reverse()) {
    if (w.id === ref.id || !isBefore(w, ref)) continue
    const x = w.exercises.find((e) => e.exerciseId === exerciseId)
    const sets = x ? doneSets(x.sets) : []
    if (x && sets.length) out.push({ date: w.date, sets, note: x.note ?? '' })
    if (out.length >= n) break
  }
  return out
}

/** 前回が全セット同重量で全て目標回数以上なら増量を提案（旧方式。progressionFor を使う） */
export function suggestWeight(last: SetEntry[] | undefined, step: number, targetReps = 10) {
  if (!last || last.length === 0) return null
  const w = last[0].weight
  if (!w) return null
  if (!last.every((s) => s.weight === w && (s.reps ?? 0) >= targetReps)) return null
  return w + step
}

// ---- ダブルプログレッション ----
export interface RepRange {
  min: number
  /** 自重・秒数は上限なし */
  max: number | null
}

const COMPOUND = new Set(['bench', 'incline-bench', 'deadlift', 'barbell-row', 'squat', 'front-squat', 'rdl', 'ohp'])
const LOWER = new Set(['deadlift', 'rdl'])

export const isCompound = (exerciseId: string) => COMPOUND.has(exerciseId)
/** 下半身（増量幅が大きい）。デッドリフト系も含める */
export const isLowerBody = (exerciseId: string, muscle: Muscle) => muscle === 'legs' || LOWER.has(exerciseId)

export function repRangeFor(exerciseId: string, equipment: string): RepRange {
  if (equipment === 'bodyweight') return { min: 8, max: null }
  if (COMPOUND.has(exerciseId)) return { min: 6, max: 10 }
  return { min: 10, max: 15 }
}

/** 休憩時間の目安（秒）。大きい種目は2分30秒、単関節は90秒 */
export const suggestedRest = (exerciseId: string) => (COMPOUND.has(exerciseId) ? 150 : 90)

export type Progression =
  | { kind: 'raise'; weight: number; from: number; startReps: number; big?: boolean }
  | { kind: 'reps'; weight: number; targets: number[] }
  | { kind: 'deload'; weight: number; from: number }
  /** 同重量で限界（RIR 0）が続いているので、重量も回数も据え置き */
  | { kind: 'hold'; weight: number; targets: number[] }

export interface ProgressionOpts {
  range: RepRange
  /** 重量の刻み */
  step: number
  lower: boolean
  /** 自重・秒数で回数を伸ばすときの1回あたりの増分（秒数種目は5） */
  repStep?: number
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step
const clean = (n: number) => Math.round(n * 100) / 100

/** その重量のセットのうち RIR を記録したものの半数以上が 0（限界）か */
const limitHit = (sets: SetEntry[], top: number) => {
  const rec = sets.filter((s) => (s.weight ?? 0) === top && s.rir !== undefined)
  return rec.length > 0 && rec.filter((s) => s.rir === 0).length * 2 >= rec.length
}

/** 平均RIR（記録のある本番セットのみ。なければ null） */
export function averageRir(workout: Workout): { avg: number; count: number } | null {
  const v: number[] = workout.exercises.flatMap((x) => doneSets(x.sets)).flatMap((s) => (s.rir === undefined ? [] : [s.rir]))
  if (!v.length) return null
  return { avg: v.reduce((a, b) => a + b, 0) / v.length, count: v.length }
}

/** sessions は新しい順の本番セット。次回の目安を返す。前回が無ければ null */
export function progressionFor(sessions: SetEntry[][], o: ProgressionOpts): Progression | null {
  const last = sessions[0]
  if (!last || last.length === 0) return null
  const repStep = o.repStep ?? 1
  const top = Math.max(...last.map((s) => s.weight ?? 0))
  const reps = (s: SetEntry) => s.reps ?? 0

  if (top <= 0) {
    return { kind: 'reps', weight: 0, targets: last.map((s) => reps(s) + repStep) }
  }
  const atTop = last.filter((s) => (s.weight ?? 0) === top)
  const min = o.range.min

  // 下限を2回連続で下回ったら立て直し（半数以上のセットが下限未満のセッションを「下回った」とみなす）
  const short = (sets: SetEntry[]) => {
    const t = Math.max(...sets.map((s) => s.weight ?? 0))
    const at = sets.filter((s) => (s.weight ?? 0) === t)
    return { t, bad: at.filter((s) => reps(s) < min).length * 2 >= at.length }
  }
  const prev = sessions[1]
  if (prev && prev.length) {
    const a = short(last)
    const b = short(prev)
    if (a.bad && b.bad && a.t === b.t) {
      const lowered = Math.min(clean(roundTo(top * 0.925, o.step)), clean(top - o.step))
      if (lowered > 0) return { kind: 'deload', weight: lowered, from: top }
    }
  }

  const max = o.range.max
  if (max !== null && atTop.length === last.length && last.every((s) => reps(s) >= max)) {
    // 全セットで「あと2回以上」余力があったと記録されていれば、増量幅を大きめにする
    const roomy = last.every((s) => s.rir !== undefined && s.rir >= 2)
    const rate = o.lower ? (roomy ? 1.075 : 1.05) : roomy ? 1.05 : 1.025
    const raised = Math.max(clean(roundTo(top * rate, o.step)), clean(top + o.step))
    return { kind: 'raise', weight: raised, from: top, startReps: min, ...(roomy ? { big: true } : {}) }
  }
  // 直近2回とも同じ重量で、RIR 0（限界）が半数以上なら据え置き
  if (prev && prev.length) {
    const t2 = Math.max(...prev.map((s) => s.weight ?? 0))
    if (t2 === top && limitHit(last, top) && limitHit(prev, top)) {
      return { kind: 'hold', weight: top, targets: last.map(reps) }
    }
  }
  return { kind: 'reps', weight: top, targets: last.map((s) => (max === null ? reps(s) + repStep : Math.min(reps(s) + repStep, max))) }
}

// ---- プレート計算 ----
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25]

export interface PlateResult {
  perSide: { plate: number; count: number }[]
  /** 実際に組める総重量 */
  total: number
  /** 目標との差（目標 - 実際）。0なら過不足なし */
  remainder: number
}

/** 目標重量から、バーの両側に付けるプレート（片側分）を求める。大きいプレートから貪欲に取る */
export function plateCalc(target: number, bar = 20, plates = DEFAULT_PLATES): PlateResult {
  const c = (n: number) => Math.round(n * 100)
  let left = Math.max(0, c((target - bar) / 2))
  const perSide: { plate: number; count: number }[] = []
  for (const p of [...plates].filter((v) => v > 0).sort((a, b) => b - a)) {
    const n = Math.floor(left / c(p))
    if (n > 0) {
      perSide.push({ plate: p, count: n })
      left -= n * c(p)
    }
  }
  const used = perSide.reduce((sum, v) => sum + v.plate * v.count, 0)
  const total = clean(bar + used * 2)
  return { perSide, total, remainder: clean(target - total) }
}

// ---- 前回との比較（サマリー用） ----
export interface ExerciseDiff {
  exerciseId: string
  kind: 'weight' | 'reps'
  cur: number
  prev: number
  diff: number
  /** 最高重量が同じとき、その重量での最大回数の前回/今回 */
  repsAtTop?: { prev: number; cur: number }
}
export interface Comparison {
  prev: Workout
  sameTitle: boolean
  volume: number
  sets: number
  exercises: ExerciseDiff[]
}

const topOf = (sets: SetEntry[]): { kind: 'weight' | 'reps'; v: number } => {
  const w = Math.max(0, ...sets.map((s) => s.weight ?? 0))
  return w > 0 ? { kind: 'weight', v: w } : { kind: 'reps', v: Math.max(0, ...sets.map((s) => s.reps ?? 0)) }
}

/** 同じ内容（同名、または種目が半分以上重なる）の直近の記録と比べる。比べる相手が無ければ null */
export function compareWithPrevious(workouts: Workout[], cur: Workout): Comparison | null {
  const ids = new Set(cur.exercises.map((x) => x.exerciseId))
  if (ids.size === 0) return null
  const ref: TimeRef = { date: cur.date, startedAt: cur.startedAt, id: cur.id }
  let pick: { w: Workout; sameTitle: boolean } | null = null
  for (const w of chronological(workouts).reverse()) {
    if (w.id === cur.id || !isBefore(w, ref)) continue
    const overlap = w.exercises.filter((x) => ids.has(x.exerciseId) && doneSets(x.sets).length > 0).length
    if (overlap === 0) continue
    const sameTitle = w.title === cur.title
    if (sameTitle || overlap * 2 >= ids.size) {
      pick = { w, sameTitle }
      break
    }
  }
  if (!pick) return null
  const exercises: ExerciseDiff[] = []
  for (const x of cur.exercises) {
    const px = pick.w.exercises.find((e) => e.exerciseId === x.exerciseId)
    const a = doneSets(x.sets)
    const b = px ? doneSets(px.sets) : []
    if (!a.length || !b.length) continue
    const ta = topOf(a)
    const tb = topOf(b)
    if (ta.kind !== tb.kind) continue
    const topReps = (sets: SetEntry[], w: number) => Math.max(0, ...sets.filter((s) => (s.weight ?? 0) === w).map((s) => s.reps ?? 0))
    const repsAtTop = ta.kind === 'weight' && ta.v === tb.v ? { prev: topReps(b, tb.v), cur: topReps(a, ta.v) } : undefined
    exercises.push({ exerciseId: x.exerciseId, kind: ta.kind, cur: ta.v, prev: tb.v, diff: clean(ta.v - tb.v), repsAtTop })
  }
  return {
    prev: pick.w,
    sameTitle: pick.sameTitle,
    volume: Math.round(workoutVolume(cur) - workoutVolume(pick.w)),
    sets: workoutSetCount(cur) - workoutSetCount(pick.w),
    exercises,
  }
}

export interface MuscleCount {
  muscle: Muscle
  sets: number
}

export function musclesOf(w: Workout, muscleFor: (exerciseId: string) => Muscle): MuscleCount[] {
  const map = new Map<Muscle, number>()
  for (const x of w.exercises) {
    const n = doneSets(x.sets).length
    const m = muscleFor(x.exerciseId)
    if (n) map.set(m, (map.get(m) ?? 0) + n)
  }
  return [...map.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets)
}
