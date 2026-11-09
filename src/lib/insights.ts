import type { Workout } from '../types'
import { addDays, startOfWeek, toKey } from './date'

/** 少なくとも1回記録した連続週数。今週が未実施でも先週まで続いていれば途切れない */
export function weekStreak(workouts: Workout[], now = new Date()) {
  const weeks = new Set(workouts.map((w) => {
    const [y, m, d] = w.date.split('-').map(Number)
    return toKey(startOfWeek(new Date(y, m - 1, d)))
  }))
  let cursor = startOfWeek(now)
  if (!weeks.has(toKey(cursor))) cursor = addDays(cursor, -7)
  let n = 0
  while (weeks.has(toKey(cursor))) {
    n++
    cursor = addDays(cursor, -7)
  }
  return n
}
