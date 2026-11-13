import { useMemo } from 'react'
import { useNow } from '../components/Common'
import { advise, computeRegionStates } from './recovery'
import { allExercises, allExercisesIncludingDeleted, useStore } from './store'

/** 部位ごとの回復状態とおすすめ。時間経過で変わるので1分ごとに再計算する */
export function useRecovery() {
  const s = useStore()
  const now = useNow(60000)
  return useMemo(() => {
    const exercises = allExercises(s)
    // 回復計算は削除済み種目の過去記録も含める。おすすめ表示用の一覧は現役の種目のみ
    const states = computeRegionStates(s.workouts, allExercisesIncludingDeleted(s), now)
    return { states, advice: advise(states, exercises, now), exercises, now }
  }, [s, now])
}
