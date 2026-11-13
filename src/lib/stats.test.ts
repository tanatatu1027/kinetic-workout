import { describe, expect, it } from 'vitest'
import type { SetEntry, Workout } from '../types'
import { bestScores, compareWithPrevious, e1rm, plateCalc, prIndex, progressionFor, recentSessions, repRangeFor } from './stats'

let n = 0
const set = (weight: number | null, reps: number, extra: Partial<SetEntry> = {}): SetEntry => ({ id: `s${++n}`, weight, reps, done: true, ...extra })
const wk = (date: string, exerciseId: string, sets: SetEntry[], title = 'T'): Workout => ({
  id: `w${++n}`,
  date,
  startedAt: new Date(date + 'T10:00:00').getTime(),
  endedAt: new Date(date + 'T11:00:00').getTime(),
  title,
  note: '',
  exercises: [{ id: `x${++n}`, exerciseId, sets }],
})

describe('e1rm', () => {
  it('1回は実重量、複数回はEpley式', () => {
    expect(e1rm(100, 1)).toBe(100)
    expect(e1rm(60, 10)).toBeCloseTo(80)
  })
})

describe('自重・秒数のPR', () => {
  it('回数が増えたらPR、初回と同数はPRでない', () => {
    const a = set(null, 10)
    const b = set(null, 10)
    const c = set(null, 12)
    const ids = prIndex([wk('2026-01-01', 'pullup', [a]), wk('2026-01-08', 'pullup', [b]), wk('2026-01-15', 'pullup', [c])])
    expect(ids.has(a.id)).toBe(false)
    expect(ids.has(b.id)).toBe(false)
    expect(ids.has(c.id)).toBe(true)
  })
  it('加重と自重は別々に比べる', () => {
    const a = set(null, 20)
    const b = set(10, 5)
    const ids = prIndex([wk('2026-01-01', 'pullup', [a]), wk('2026-01-08', 'pullup', [b])])
    expect(ids.size).toBe(0)
  })
  it('bestScores は基準より前だけを見る', () => {
    const ws = [wk('2026-01-01', 'plank', [set(null, 60)]), wk('2026-01-08', 'plank', [set(null, 90)])]
    const ref = { date: '2026-01-08', startedAt: ws[1].startedAt, id: ws[1].id }
    expect(bestScores(ws, 'plank', ref)).toEqual({ w: null, r: 60 })
  })
})

describe('ダブルプログレッション', () => {
  const o = { range: { min: 6, max: 10 }, step: 2.5, lower: false }
  it('全セット上限なら重量アップ（上半身+2.5%を刻みに丸め、最低1刻み）', () => {
    const p = progressionFor([[set(60, 10), set(60, 10), set(60, 10)]], o)
    expect(p).toEqual({ kind: 'raise', weight: 62.5, from: 60, startReps: 6 })
    const q = progressionFor([[set(20, 10)]], o)
    expect(q).toMatchObject({ kind: 'raise', weight: 22.5 })
  })
  it('下半身は+5%', () => {
    const p = progressionFor([[set(100, 10), set(100, 10)]], { ...o, lower: true })
    expect(p).toMatchObject({ kind: 'raise', weight: 105 })
  })
  it('上限に届かなければ同重量で各セット+1回（上限でキャップ）', () => {
    const p = progressionFor([[set(60, 8), set(60, 7), set(60, 10)]], o)
    expect(p).toEqual({ kind: 'reps', weight: 60, targets: [9, 8, 10] })
  })
  it('下限を2回連続で下回ったら減量', () => {
    const bad = [set(60, 5), set(60, 4), set(60, 5)]
    const p = progressionFor([bad, [set(60, 5), set(60, 5)]], o)
    expect(p).toMatchObject({ kind: 'deload', from: 60, weight: 55 })
  })
  it('1回だけ下回っても減量しない', () => {
    const p = progressionFor([[set(60, 5), set(60, 5)], [set(60, 8)]], o)
    expect(p?.kind).toBe('reps')
  })
  it('自重は上限なしで回数を伸ばす', () => {
    expect(progressionFor([[set(null, 8), set(null, 6)]], { ...o, range: repRangeFor('pullup', 'bodyweight') })).toEqual({ kind: 'reps', weight: 0, targets: [9, 7] })
    expect(progressionFor([[set(null, 30)]], { ...o, repStep: 5 })).toEqual({ kind: 'reps', weight: 0, targets: [35] })
  })
  it('RIR: 全セット余力2以上なら増量幅を大きめに', () => {
    const r = (w: number, n: number, rir: 0 | 1 | 2 | 3) => ({ ...set(w, n), rir })
    const p = progressionFor([[r(100, 10, 2), r(100, 10, 3)]], o)
    expect(p).toMatchObject({ kind: 'raise', weight: 105, big: true })
    const q = progressionFor([[r(100, 10, 2)]], { ...o, lower: true })
    expect(q).toMatchObject({ kind: 'raise', weight: 107.5 })
    // 1セットでも余力が少なければ通常幅
    expect(progressionFor([[r(100, 10, 2), r(100, 10, 1)]], o)).toEqual({ kind: 'raise', weight: 102.5, from: 100, startReps: 6 })
  })
  it('RIR: 同重量で限界(0)が2回続いたら据え置き', () => {
    const r = (n: number, rir: 0 | 1 | 2 | 3) => ({ ...set(60, n), rir })
    const p = progressionFor([[r(8, 0), r(7, 0)], [r(8, 0), r(7, 1)]], o)
    expect(p).toEqual({ kind: 'hold', weight: 60, targets: [8, 7] })
    // 1回だけなら据え置かない。RIR未入力も従来どおり
    expect(progressionFor([[r(8, 0)], [r(8, 2)]], o)?.kind).toBe('reps')
    expect(progressionFor([[set(60, 8)], [set(60, 8)]], o)?.kind).toBe('reps')
  })
  it('前回が無ければ null', () => {
    expect(progressionFor([], o)).toBeNull()
  })
})

describe('プレート計算', () => {
  it('100kg = バー20 + 片側40 (25+15)', () => {
    const r = plateCalc(100)
    expect(r.perSide).toEqual([{ plate: 25, count: 1 }, { plate: 15, count: 1 }])
    expect(r.total).toBe(100)
    expect(r.remainder).toBe(0)
  })
  it('1.25kg単位と組めない端数', () => {
    expect(plateCalc(62.5).perSide).toEqual([{ plate: 20, count: 1 }, { plate: 1.25, count: 1 }])
    const r = plateCalc(61)
    expect(r.total).toBe(60)
    expect(r.remainder).toBe(1)
  })
  it('バーより軽い目標は空', () => {
    expect(plateCalc(15).perSide).toEqual([])
  })
  it('手持ちプレートを指定できる', () => {
    expect(plateCalc(60, 20, [10, 5]).perSide).toEqual([{ plate: 10, count: 2 }])
  })
})

describe('recentSessions / 前回との比較', () => {
  it('新しい順に取る', () => {
    const ws = [wk('2026-01-01', 'bench', [set(50, 5)]), wk('2026-01-08', 'bench', [set(55, 5)]), wk('2026-01-15', 'bench', [set(60, 5)])]
    const ref = { date: '2026-01-15', startedAt: ws[2].startedAt, id: ws[2].id }
    expect(recentSessions(ws, 'bench', ref).map((s) => s.date)).toEqual(['2026-01-08', '2026-01-01'])
  })
  it('比較: 総量・セット・最高重量の増減', () => {
    const prev = wk('2026-01-01', 'bench', [set(50, 10), set(50, 10)])
    const cur = wk('2026-01-08', 'bench', [set(55, 10), set(55, 10), set(55, 8)])
    const c = compareWithPrevious([prev, cur], cur)!
    expect(c.sets).toBe(1)
    expect(c.volume).toBe(55 * 28 - 1000)
    expect(c.exercises[0]).toMatchObject({ kind: 'weight', diff: 5 })
  })
  it('前回が無ければ null', () => {
    const cur = wk('2026-01-08', 'bench', [set(55, 10)])
    expect(compareWithPrevious([cur], cur)).toBeNull()
  })
})
