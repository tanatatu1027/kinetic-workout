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

/** 基準より前の、その種目の推定1RM最高値（実績がなければ null） */
export function bestBefore(workouts: Workout[], exerciseId: string, ref: TimeRef) {
  let best: number | null = null
  for (const w of workouts) {
    if (w.id === ref.id || !isBefore(w, ref)) continue
    for (const x of w.exercises) {
      if (x.exerciseId !== exerciseId) continue
      for (const s of doneSets(x.sets)) {
        if (!s.weight) continue
        const v = e1rm(s.weight, s.reps!)
        if (best === null || v > best) best = v
      }
    }
  }
  return best
}

/** 全履歴を時系列に走査し、自己ベストを更新したセットIDを集める。初回記録はPR扱いしない */
export function prIndex(workouts: Workout[]) {
  const best = new Map<string, number>()
  const prSets = new Set<string>()
  for (const w of chronological(workouts)) {
    for (const x of w.exercises) {
      for (const s of doneSets(x.sets)) {
        if (!s.weight) continue
        const v = e1rm(s.weight, s.reps!)
        const cur = best.get(x.exerciseId)
        if (cur === undefined) best.set(x.exerciseId, v)
        else if (v > cur + 1e-6) {
          best.set(x.exerciseId, v)
          prSets.add(s.id)
        }
      }
    }
  }
  return prSets
}

/** 前回が全セット同重量で全て目標回数以上なら増量を提案 */
export function suggestWeight(last: SetEntry[] | undefined, step: number, targetReps = 10) {
  if (!last || last.length === 0) return null
  const w = last[0].weight
  if (!w) return null
  if (!last.every((s) => s.weight === w && (s.reps ?? 0) >= targetReps)) return null
  return w + step
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
