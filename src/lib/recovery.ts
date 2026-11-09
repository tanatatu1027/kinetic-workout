import { REGIONS, STAPLES, regionInfo, targetsOf, type Region } from '../data/regions'
import type { Exercise, TemplateItem, Workout } from '../types'
import { fromKey, toKey } from './date'
import { doneSets } from './stats'

/**
 * 部位ごとの回復状態の推定。
 * 根拠: 同一部位の回復はおおむね24〜72時間。限界まで追い込む・ボリュームが多い・
 * 初心者ほど回復が遅い（Damas 2016, Morán-Navarro 2017 など）。
 * ただし部位別の基準時間は研究で確定したものではなく、実務上の目安をもとにした推定値。
 */

export type Stage = 'damaged' | 'recovering' | 'ready' | 'idle' | 'untrained'

export const STAGE_LABEL: Record<Stage, string> = {
  damaged: 'ダメージ直後',
  recovering: '回復中',
  ready: '回復済み',
  idle: 'しばらく未実施',
  untrained: '記録なし',
}

export const STAGE_COLOR: Record<Stage, string> = {
  damaged: '#ff4d6d',
  recovering: '#ffb02e',
  ready: '#a3e635',
  idle: '#6f8aa0',
  untrained: '#4a5d6e',
}

export const STAGE_NOTE: Record<Stage, string> = {
  damaged: '筋繊維にダメージが残っている時期。同じ部位の追い込みは避けましょう',
  recovering: '修復の途中です。軽めなら可、強い負荷は回復を待つのがおすすめ',
  ready: '回復の目安に達しています。鍛えるのに向いています',
  idle: '1週間以上トレーニングしていません',
  untrained: 'まだ記録がありません',
}

/** 完全回復までの基準時間（時間）。大筋群72 / 小筋群48 / 腹筋系36 */
const BASE_HOURS: Record<Region, number> = {
  chest: 72, lats: 72, traps: 60, lowback: 72, glutes: 72, quads: 72, hamstrings: 72,
  shoulders: 48, biceps: 48, triceps: 48, forearms: 36, calves: 48, abs: 36, obliques: 36,
}

/** 全身への負担が大きく、回復が長引きやすい種目 */
const HEAVY_COMPOUND = new Set(['deadlift', 'squat', 'front-squat', 'rdl', 'barbell-row'])

export interface RegionState {
  region: Region
  stage: Stage
  /** 回復の進み具合 0〜1（回復済み・未実施は1） */
  progress: number
  /** 回復済みになるまでの残り時間（h）。回復済みは0 */
  remainingHours: number
  /** 回復済みになる予想時刻 */
  readyAt: number | null
  lastAt: number | null
  lastDate: string | null
  /** 直近セッションでの実質セット数 */
  lastSets: number
  /** 直近7日間の実質セット数 */
  weeklySets: number
  /** 回復に見込んだ総時間（h） */
  needHours: number
  /** 発光の強さ 0〜1 */
  strength: number
}

const endTime = (w: Workout) => (w.endedAt > w.startedAt ? w.endedAt : w.startedAt)

interface Session {
  at: number
  date: string
  sets: number
  heavy: boolean
}

function sessionsFor(workouts: Workout[], exercises: Map<string, Exercise>, region: Region): Session[] {
  const out: Session[] = []
  for (const w of workouts) {
    let sets = 0
    let heavy = false
    for (const x of w.exercises) {
      const ex = exercises.get(x.exerciseId)
      if (!ex) continue
      const weight = targetsOf(ex).find(([r]) => r === region)?.[1]
      if (!weight) continue
      const n = doneSets(x.sets).length
      if (n === 0) continue
      sets += n * weight
      if (weight >= 0.8 && HEAVY_COMPOUND.has(ex.id)) heavy = true
    }
    // 補助的に使っただけ（実質1セット未満）の場合は損傷とみなさない
    if (sets >= 0.5) out.push({ at: endTime(w), date: w.date, sets, heavy })
  }
  return out.sort((a, b) => a.at - b.at)
}

export function computeRegionStates(workouts: Workout[], exercises: Exercise[], now = Date.now()): Record<Region, RegionState> {
  const map = new Map(exercises.map((e) => [e.id, e]))
  const beginner = workouts.length < 12
  const result = {} as Record<Region, RegionState>

  for (const { id: region } of REGIONS) {
    const sessions = sessionsFor(workouts, map, region)
    const weekly = sessions.filter((s) => now - s.at <= 7 * 86400000).reduce((n, s) => n + s.sets, 0)
    const last = sessions[sessions.length - 1]

    if (!last) {
      result[region] = { region, stage: 'untrained', progress: 1, remainingHours: 0, readyAt: null, lastAt: null, lastDate: null, lastSets: 0, weeklySets: 0, needHours: 0, strength: 0 }
      continue
    }

    // 同じ日に複数回トレーニングした場合は合算して負荷を見る
    const sameDay = sessions.filter((x) => last.at - x.at <= 24 * 3600000)
    const loadSets = sameDay.reduce((n, x) => n + x.sets, 0)
    let hours = BASE_HOURS[region]
    if (loadSets < 5) hours *= 0.8
    else if (loadSets >= 10) hours *= 1.25
    if (sameDay.some((x) => x.heavy)) hours *= 1.15
    if (beginner) hours *= 1.2
    // 前回の疲労が抜けきる前に再度刺激した場合は、回復を長めに見る
    const prev = sessions.filter((x) => last.at - x.at > 24 * 3600000).pop()
    if (prev && last.at - prev.at < BASE_HOURS[region] * 3600000) hours *= 1.15
    hours = Math.min(120, Math.max(18, hours))

    const elapsed = (now - last.at) / 3600000
    const progress = Math.max(0, Math.min(1, elapsed / hours))
    let stage: Stage
    if (progress < 0.33) stage = 'damaged'
    else if (progress < 1) stage = 'recovering'
    else if (elapsed > 24 * 7) stage = 'idle'
    else stage = 'ready'

    const strength = stage === 'damaged' ? 1 : stage === 'recovering' ? 0.25 + 0.5 * (1 - progress) : stage === 'ready' ? 0.2 : 0
    result[region] = {
      region,
      stage,
      progress,
      remainingHours: Math.max(0, hours - elapsed),
      readyAt: last.at + hours * 3600000,
      lastAt: last.at,
      lastDate: last.date,
      lastSets: Math.round(loadSets * 10) / 10,
      weeklySets: Math.round(weekly * 10) / 10,
      needHours: hours,
      strength,
    }
  }
  return result
}

export const fmtRemaining = (h: number) => {
  if (h < 1) return '1時間以内'
  // 先に時間へ丸めてから日と時間に分ける（「1日24時間」のような表示を防ぐ）
  const total = Math.round(h)
  if (total < 24) return `約${total}時間`
  const d = Math.floor(total / 24)
  const rest = total - d * 24
  return rest >= 1 ? `約${d}日${rest}時間` : `約${d}日`
}

/* ---------- おすすめ ---------- */

export const WEEKLY_TARGET = 10

type Family = 'push' | 'pull' | 'legs' | 'core'
const FAMILY: Record<Family, { label: string; regions: Region[] }> = {
  push: { label: 'PUSH（押す日）', regions: ['chest', 'shoulders', 'triceps'] },
  pull: { label: 'PULL（引く日）', regions: ['lats', 'traps', 'biceps', 'forearms', 'lowback'] },
  legs: { label: 'LEGS（脚の日）', regions: ['quads', 'hamstrings', 'glutes', 'calves'] },
  core: { label: 'CORE（体幹の日）', regions: ['abs', 'obliques'] },
}

export interface Advice {
  kind: 'train' | 'rest'
  title: string
  headline: string
  /** 鍛える候補（優先順） */
  focus: { region: Region; reason: string }[]
  /** 休ませたい部位 */
  rest: { region: Region; reason: string }[]
  items: TemplateItem[]
}

const usable = (s: RegionState) => s.stage === 'ready' || s.stage === 'idle' || s.stage === 'untrained' || (s.stage === 'recovering' && s.progress >= 0.85)

/** 回復状態・今週のセット数・未実施期間から、今日鍛える部位を決める */
/** メニューの軸になる部位。僧帽筋・前腕・脊柱起立筋・腹斜筋は補助的に扱い、おすすめの主役にしない */
const PRIMARY = new Set<Region>(['chest', 'shoulders', 'triceps', 'lats', 'biceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'])

export function advise(states: Record<Region, RegionState>, exercises: Exercise[], now = Date.now()): Advice {
  // 記録が1件もないときは、まず全身をバランスよく
  if (REGIONS.every((r) => states[r.id].stage === 'untrained')) {
    const exist = new Set(exercises.map((e) => e.id))
    return {
      kind: 'train',
      title: '今日は 全身トレーニング',
      headline: 'まだ記録がないので、まず全身をバランスよく鍛えましょう。記録がたまると、回復状況に合わせて提案します。',
      focus: [],
      rest: [],
      items: [['squat', 3], ['bench', 3], ['barbell-row', 3], ['plank', 2]].filter(([id]) => exist.has(id as string)).map(([exerciseId, sets]) => ({ exerciseId: exerciseId as string, sets: sets as number })),
    }
  }

  const need = (s: RegionState) => {
    const lack = Math.max(0, WEEKLY_TARGET - s.weeklySets) / WEEKLY_TARGET
    const stale = s.lastAt === null ? 1 : Math.min(1, (now - s.lastAt) / (7 * 86400000))
    return 0.6 * lack + 0.4 * stale
  }

  const reason = (s: RegionState) => {
    if (s.lastAt === null) return 'まだ記録がありません'
    // カレンダーの日付で数える（時間の切り捨てだと「2日前」と「3日前」がずれる）
    const days = Math.round((fromKey(toKey(new Date(now))).getTime() - fromKey(s.lastDate!).getTime()) / 86400000)
    const since = days <= 0 ? '今日' : `${days}日前`
    return `前回は${since}・直近7日${s.weeklySets}セット（目安${WEEKLY_TARGET}）`
  }

  const rest = REGIONS.map((r) => states[r.id])
    .filter((s) => s.stage === 'damaged' || (s.stage === 'recovering' && s.progress < 0.85))
    .sort((a, b) => a.progress - b.progress)
    .map((s) => ({ region: s.region, reason: `${STAGE_LABEL[s.stage]}・あと${fmtRemaining(s.remainingHours)}` }))

  const scored = (Object.keys(FAMILY) as Family[]).map((f) => {
    // 回復していて、かつ今週の目標にまだ届いていない部位だけを候補にする
    const ready = FAMILY[f].regions.filter((r) => usable(states[r]) && need(states[r]) >= 0.1)
    // 主役の部位の平均で比べる（部位数が多い系統が有利にならないように）。主役が使えない系統は候補にしない
    const lead = ready.filter((r) => PRIMARY.has(r))
    const score = lead.length === 0 ? 0 : (lead.reduce((n, r) => n + need(states[r]), 0) / lead.length) * (f === 'core' ? 0.6 : 1)
    return { f, ready, score }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]

  // どの系統もほぼ使えない、または不足がない場合は休養をすすめる
  if (!best || best.ready.length === 0 || best.score < 0.12) {
    return {
      kind: 'rest',
      title: '今日は休養',
      headline: '各部位がまだ回復中か、直近7日の目標セットを満たしています。軽い散歩やストレッチで回復を促しましょう。',
      focus: [],
      rest,
      items: [],
    }
  }

  // 主役の部位を先に、補助的な部位は後ろに並べる
  const focus = best.ready
    .map((r) => states[r])
    .sort((a, b) => Number(PRIMARY.has(b.region)) - Number(PRIMARY.has(a.region)) || need(b) - need(a))
    .map((s) => ({ region: s.region, reason: reason(s) }))

  const done = REGIONS.filter((r) => states[r.id].weeklySets >= WEEKLY_TARGET).length
  return {
    kind: 'train',
    title: `今日は ${FAMILY[best.f].label}`,
    headline:
      focus.length > 0
        ? `${focus.slice(0, 3).map((f) => regionInfo(f.region).label).join('・')}は回復が進んでおり、直近7日のセット数が不足している部位です。` +
          (done > 0 ? `（${done}部位は直近7日の目標達成済み）` : '')
        : '',
    focus,
    rest,
    items: buildMenu(focus.map((f) => f.region).filter((r) => PRIMARY.has(r)), exercises),
  }
}

/** 選んだ部位から、代表種目でメニューを作る（多くの部位を同時に使う複合種目を先頭に） */
export function buildMenu(regions: Region[], exercises: Exercise[]): TemplateItem[] {
  const exist = new Set(exercises.map((e) => e.id))
  const chosen: string[] = []
  const perRegion = regions.length <= 2 ? 3 : regions.length <= 4 ? 2 : 1
  for (const r of regions) {
    const picks = STAPLES[r].filter((id) => exist.has(id) && !chosen.includes(id)).slice(0, perRegion)
    chosen.push(...picks)
  }
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const spread = (id: string) => targetsOf(byId.get(id)!).filter(([r]) => regions.includes(r)).length
  const ordered = chosen.slice(0, 8).sort((a, b) => spread(b) - spread(a))
  return ordered.map((exerciseId, i) => ({ exerciseId, sets: i === 0 ? 4 : 3 }))
}
