import { beforeEach, describe, expect, it } from 'vitest'
import { addDays, fromKey, startOfWeek, toKey } from './date'
import {
  addCustomExercise,
  allExercises,
  allExercisesIncludingDeleted,
  deleteCustomExercise,
  findExercise,
  getState,
  migrate,
  moveTemplate,
  parseData,
  parseDataDetailed,
  setExerciseNote,
  setExerciseRest,
  setState,
  setWeeklyGoal,
  startWorkout,
  updateTemplate,
} from './store'

const set = (over: Record<string, unknown> = {}) => ({ id: 's1', weight: 60, reps: 8, done: true, ...over })
const workout = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  date: '2026-01-05',
  startedAt: 1000,
  endedAt: 2000,
  title: 'T',
  note: '',
  exercises: [{ id: 'x' + id, exerciseId: 'bench', sets: [set()] }],
  ...over,
})
const base = (over: Record<string, unknown> = {}) => ({ version: 1, workouts: [workout('w1'), workout('w2')], ...over })

describe('parseData', () => {
  it('正常なデータをそのまま読み込む', () => {
    const r = parseDataDetailed(base())
    expect(r?.dropped).toBe(0)
    expect(r?.data.workouts).toHaveLength(2)
    expect(parseData(base())?.settings.restSeconds).toBe(90)
  })

  it('1件だけ不正なら、その1件だけ除外して残りを読み込む', () => {
    const r = parseDataDetailed(base({ workouts: [workout('w1'), workout('w2', { date: '2026-99-99' }), workout('w3')] }))
    expect(r?.dropped).toBe(1)
    expect(r?.data.workouts.map((w) => w.id)).toEqual(['w1', 'w3'])
  })

  it('IDが重複した記録は後のものを除外する', () => {
    const r = parseDataDetailed(base({ workouts: [workout('w1'), workout('w1')] }))
    expect(r?.dropped).toBe(1)
    expect(r?.data.workouts).toHaveLength(1)
  })

  it('不正な体組成・テンプレート・自作種目も、そのレコードだけ除外する', () => {
    const r = parseDataDetailed(
      base({
        bodyLogs: [{ date: '2026-01-01', weight: 60, fat: null, muscle: null, waist: null, note: '' }, { date: 'x', weight: 1, fat: null, muscle: null, waist: null, note: '' }],
        templates: [{ id: 't1', name: 'ok', items: [{ exerciseId: 'bench', sets: 3 }] }, { id: 't2', name: 'bad', items: [{ exerciseId: 'bench', sets: 0 }] }],
        customExercises: [{ id: 'c-1', name: 'A', muscle: 'chest', equipment: 'machine' }, { id: 'c-2', name: 'B', muscle: 'nope', equipment: 'machine' }],
      }),
    )
    expect(r?.dropped).toBe(3)
    expect(r?.data.bodyLogs).toHaveLength(1)
    expect(r?.data.customExercises.map((e) => e.id)).toEqual(['c-1'])
    expect(r?.data.templates.some((t) => t.id === 't2')).toBe(false)
  })

  it('version 不一致・構造破壊は全体を拒否する', () => {
    expect(parseData({ ...base(), version: 2 })).toBeNull()
    expect(parseData({ ...base(), version: 0 })).toBeNull()
    expect(parseData({ ...base(), version: '1' })).toBeNull()
    expect(parseData({ version: 1 })).toBeNull()
    expect(parseData({ version: 1, workouts: 'x' })).toBeNull()
    expect(parseData(null)).toBeNull()
    expect(parseData([])).toBeNull()
  })

  it('空データ（記録0件）は読み込める', () => {
    const r = parseDataDetailed({ version: 1, workouts: [] })
    expect(r?.dropped).toBe(0)
    expect(r?.data.workouts).toEqual([])
    expect(r?.data.templates.length).toBeGreaterThan(0)
  })

  it('rir は 0〜3 のみ許し、不正値のセットは捨てる', () => {
    const ok = parseData(base({ workouts: [workout('w1', { exercises: [{ id: 'x', exerciseId: 'bench', sets: [set({ rir: 2 }), set({ id: 's2' })] }] })] }))
    const sets = ok!.workouts[0].exercises[0].sets
    expect(sets[0].rir).toBe(2)
    expect('rir' in sets[1]).toBe(false)
    for (const v of [4, -1, 1.5, '1', null]) {
      const bad = parseDataDetailed(base({ workouts: [workout('w1', { exercises: [{ id: 'x', exerciseId: 'bench', sets: [set({ rir: v })] }] })] }))
      expect(bad?.dropped).toBe(1)
    }
  })

  it('warmup は真偽値のみ許し、未知の項目は取り込まない', () => {
    const bad = parseDataDetailed(base({ workouts: [workout('w1', { exercises: [{ id: 'x', exerciseId: 'bench', sets: [set({ warmup: 'yes' })] }] })] }))
    expect(bad?.dropped).toBe(1)
    const ok = parseData(
      base({ workouts: [{ ...workout('w1'), evil: 1, exercises: [{ id: 'x', exerciseId: 'bench', extra: 1, sets: [set({ warmup: true, junk: 1 })] }] }] }),
    )
    const w = ok!.workouts[0] as unknown as Record<string, unknown>
    expect(w.evil).toBeUndefined()
    const x = ok!.workouts[0].exercises[0] as unknown as Record<string, unknown>
    expect(x.extra).toBeUndefined()
    const st = ok!.workouts[0].exercises[0].sets[0] as unknown as Record<string, unknown>
    expect(st.warmup).toBe(true)
    expect(st.junk).toBeUndefined()
  })

  it('新しい設定項目（週目標・種目別休憩）を検証し、不正値は捨てる', () => {
    const ok = parseData(base({ settings: { weeklyGoal: 3, restByExercise: { bench: 120, bad: -1, sq: 'x' } } }))
    expect(ok?.settings.weeklyGoal).toBe(3)
    expect(ok?.settings.restByExercise).toEqual({ bench: 120 })
    const ng = parseData(base({ settings: { weeklyGoal: 99, restByExercise: 5 } }))
    expect(ng?.settings.weeklyGoal).toBeUndefined()
    expect(ng?.settings.restByExercise).toBeUndefined()
  })

  it('種目メモは文字列のみ（500字まで）', () => {
    const ok = parseData(base({ workouts: [workout('w1', { exercises: [{ id: 'x', exerciseId: 'bench', sets: [set()], note: '肘を締める' }] })] }))
    expect(ok?.workouts[0].exercises[0].note).toBe('肘を締める')
    const ng = parseDataDetailed(base({ workouts: [workout('w1', { exercises: [{ id: 'x', exerciseId: 'bench', sets: [set()], note: 5 }] })] }))
    expect(ng?.dropped).toBe(1)
  })
})

describe('migrate', () => {
  it('現行versionはそのまま通る', () => {
    expect(migrate({ version: 1, workouts: [] })).toEqual({ version: 1, workouts: [] })
  })

  it('migrations を version 順に適用する', () => {
    const table = {
      1: (r: Record<string, unknown>) => ({ ...r, steps: [...((r.steps as string[]) ?? []), '1->2'] }),
      2: (r: Record<string, unknown>) => ({ ...r, steps: [...((r.steps as string[]) ?? []), '2->3'] }),
    }
    const out = migrate({ version: 1 }, table, 3)
    expect(out).toEqual({ version: 3, steps: ['1->2', '2->3'] })
    expect(migrate({ version: 2 }, table, 3)).toEqual({ version: 3, steps: ['2->3'] })
  })

  it('変換関数が無い・未来の version は null', () => {
    expect(migrate({ version: 1 }, {}, 2)).toBeNull()
    expect(migrate({ version: 5 })).toBeNull()
    expect(migrate({ version: 1.5 })).toBeNull()
  })
})

describe('自作種目のソフト削除', () => {
  beforeEach(() => {
    setState((s) => ({ ...s, customExercises: [], workouts: [], templates: s.templates, active: null }))
  })

  it('削除しても過去の記録では元の名前・部位で引ける。選択肢には出ない', () => {
    const ex = addCustomExercise({ name: 'ケーブルX', muscle: 'back', equipment: 'cable' })
    setState((s) => ({
      ...s,
      workouts: [
        {
          id: 'w1',
          date: '2026-01-05',
          startedAt: 1,
          endedAt: 2,
          title: 'T',
          note: '',
          exercises: [{ id: 'x1', exerciseId: ex.id, sets: [{ id: 's1', weight: 10, reps: 10, done: true }] }],
        },
      ],
    }))
    expect(allExercises(getState()).some((e) => e.id === ex.id)).toBe(true)
    deleteCustomExercise(ex.id)
    const s = getState()
    expect(allExercises(s).some((e) => e.id === ex.id)).toBe(false)
    expect(allExercisesIncludingDeleted(s).some((e) => e.id === ex.id)).toBe(true)
    const found = findExercise(s, ex.id)
    expect(found.name).toBe('ケーブルX')
    expect(found.muscle).toBe('back')
    // 保存・再読み込みでも deleted が保たれる
    const re = parseData(JSON.parse(JSON.stringify(s)))
    expect(re?.customExercises.find((e) => e.id === ex.id)?.deleted).toBe(true)
  })

  it('存在しない種目は従来どおり「削除された種目」', () => {
    expect(findExercise(getState(), 'c-unknown').name).toBe('削除された種目')
  })
})

describe('新しいアクション', () => {
  it('週目標・種目別休憩・テンプレート編集と並べ替え', () => {
    setWeeklyGoal(4)
    expect(getState().settings.weeklyGoal).toBe(4)
    setWeeklyGoal(0)
    expect(getState().settings.weeklyGoal).toBeUndefined()

    setExerciseRest('bench', 150)
    expect(getState().settings.restByExercise).toEqual({ bench: 150 })
    setExerciseRest('bench', null)
    expect(getState().settings.restByExercise).toBeUndefined()

    const [a, b] = getState().templates
    moveTemplate(a.id, 1)
    expect(getState().templates[1].id).toBe(a.id)
    expect(getState().templates[0].id).toBe(b.id)
    moveTemplate(b.id, -1) // 先頭からは動かない
    expect(getState().templates[0].id).toBe(b.id)

    updateTemplate(a.id, { name: '改名' })
    expect(getState().templates.find((t) => t.id === a.id)?.name).toBe('改名')
  })

  it('進行中ワークアウトの種目メモを更新できる', () => {
    startWorkout({ title: 'T', items: [{ exerciseId: 'bench', sets: 1 }] })
    const xid = getState().active!.exercises[0].id
    setExerciseNote(xid, '肩甲骨を寄せる')
    expect(getState().active!.exercises[0].note).toBe('肩甲骨を寄せる')
  })
})

describe('日付キー関数', () => {
  it('toKey / fromKey は往復で一致する', () => {
    expect(toKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toKey(fromKey('2026-12-31'))).toBe('2026-12-31')
    expect(toKey(fromKey('2024-02-29'))).toBe('2024-02-29')
  })

  it('addDays は月・年またぎを正しく扱う', () => {
    expect(toKey(addDays(fromKey('2026-01-31'), 1))).toBe('2026-02-01')
    expect(toKey(addDays(fromKey('2026-01-01'), -1))).toBe('2025-12-31')
  })

  it('startOfWeek は日曜始まり', () => {
    expect(toKey(startOfWeek(fromKey('2026-11-13')))).toBe('2026-11-08') // 金曜 -> 日曜
    expect(toKey(startOfWeek(fromKey('2026-11-08')))).toBe('2026-11-08')
  })
})
