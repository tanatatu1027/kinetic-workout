import { useMemo } from 'react'
import { useNow } from '../components/Common'
import { advise, computeRegionStates } from './recovery'
import { allExercises, useStore } from './store'

/** 部位ごとの回復状態とおすすめ。時間経過で変わるので1分ごとに再計算する */
export function useRecovery() {
  const s = useStore()
  const now = useNow(60000)
  return useMemo(() => {
    const exercises = allExercises(s)
    const states = computeRegionStates(s.workouts, exercises, now)
    return { states, advice: advise(states, exercises, now), exercises, now }
  }, [s, now])
}
