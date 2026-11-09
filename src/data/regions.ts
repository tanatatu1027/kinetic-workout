import type { Exercise, Muscle } from '../types'

/** 人体モデルで選べる部位（カレンダー用の6分類より細かい） */
export type Region =
  | 'chest' | 'shoulders' | 'traps' | 'lats' | 'lowback'
  | 'biceps' | 'triceps' | 'forearms'
  | 'abs' | 'obliques'
  | 'glutes' | 'quads' | 'hamstrings' | 'calves'

export interface RegionInfo {
  id: Region
  label: string
  /** カレンダー等で使う大分類 */
  group: Muscle
  /** 大筋群は回復に時間がかかる。腹筋など小さく回復の早い部位は small */
  size: 'large' | 'small'
  /** 前面/背面のどちら側から見えるか */
  side: 'front' | 'back' | 'both'
}

export const REGIONS: RegionInfo[] = [
  { id: 'chest', label: '胸', group: 'chest', size: 'large', side: 'front' },
  { id: 'shoulders', label: '肩', group: 'shoulders', size: 'small', side: 'both' },
  { id: 'traps', label: '僧帽筋', group: 'back', size: 'large', side: 'back' },
  { id: 'lats', label: '広背筋', group: 'back', size: 'large', side: 'back' },
  { id: 'lowback', label: '脊柱起立筋', group: 'back', size: 'large', side: 'back' },
  { id: 'biceps', label: '上腕二頭筋', group: 'arms', size: 'small', side: 'front' },
  { id: 'triceps', label: '上腕三頭筋', group: 'arms', size: 'small', side: 'back' },
  { id: 'forearms', label: '前腕', group: 'arms', size: 'small', side: 'both' },
  { id: 'abs', label: '腹筋', group: 'core', size: 'small', side: 'front' },
  { id: 'obliques', label: '腹斜筋', group: 'core', size: 'small', side: 'front' },
  { id: 'glutes', label: '臀筋', group: 'legs', size: 'large', side: 'back' },
  { id: 'quads', label: '大腿四頭筋', group: 'legs', size: 'large', side: 'front' },
  { id: 'hamstrings', label: 'ハムストリングス', group: 'legs', size: 'large', side: 'back' },
  { id: 'calves', label: 'ふくらはぎ', group: 'legs', size: 'small', side: 'both' },
]

export const regionInfo = (id: Region) => REGIONS.find((r) => r.id === id)!

type Targets = [Region, number][]

/** 種目ごとの使われる部位。1=主働、0.5=補助 */
const T: Record<string, Targets> = {
  bench: [['chest', 1], ['triceps', 0.5], ['shoulders', 0.5]],
  'incline-bench': [['chest', 1], ['shoulders', 0.6], ['triceps', 0.5]],
  'db-press': [['chest', 1], ['triceps', 0.5], ['shoulders', 0.5]],
  'incline-db': [['chest', 1], ['shoulders', 0.6], ['triceps', 0.5]],
  'db-fly': [['chest', 1]],
  'chest-press': [['chest', 1], ['triceps', 0.5]],
  'pec-fly': [['chest', 1]],
  'cable-cross': [['chest', 1]],
  pushup: [['chest', 1], ['triceps', 0.5], ['shoulders', 0.5], ['abs', 0.3]],
  dips: [['chest', 0.8], ['triceps', 1], ['shoulders', 0.5]],

  deadlift: [['lowback', 1], ['glutes', 1], ['hamstrings', 1], ['traps', 0.6], ['lats', 0.5], ['forearms', 0.5]],
  'barbell-row': [['lats', 1], ['traps', 0.7], ['lowback', 0.5], ['biceps', 0.5], ['forearms', 0.3]],
  'db-row': [['lats', 1], ['traps', 0.6], ['biceps', 0.5]],
  'lat-pulldown': [['lats', 1], ['biceps', 0.5]],
  'seated-row': [['lats', 1], ['traps', 0.7], ['biceps', 0.5]],
  'machine-row': [['lats', 1], ['traps', 0.7], ['biceps', 0.5]],
  pullup: [['lats', 1], ['biceps', 0.6], ['forearms', 0.4]],
  'back-ext': [['lowback', 1], ['glutes', 0.5], ['hamstrings', 0.4]],

  squat: [['quads', 1], ['glutes', 1], ['hamstrings', 0.4], ['lowback', 0.4], ['abs', 0.3]],
  'front-squat': [['quads', 1], ['glutes', 0.7], ['abs', 0.4]],
  rdl: [['hamstrings', 1], ['glutes', 1], ['lowback', 0.6]],
  'leg-press': [['quads', 1], ['glutes', 0.6]],
  'leg-ext': [['quads', 1]],
  'leg-curl': [['hamstrings', 1]],
  lunge: [['quads', 1], ['glutes', 0.8], ['hamstrings', 0.3]],
  bulgarian: [['quads', 1], ['glutes', 0.9]],
  'calf-raise': [['calves', 1]],
  'bw-squat': [['quads', 1], ['glutes', 0.7]],

  ohp: [['shoulders', 1], ['triceps', 0.5], ['traps', 0.4], ['abs', 0.3]],
  'db-shoulder': [['shoulders', 1], ['triceps', 0.5]],
  'shoulder-press': [['shoulders', 1], ['triceps', 0.5]],
  lateral: [['shoulders', 1]],
  'rear-delt': [['shoulders', 1], ['traps', 0.4]],
  'face-pull': [['shoulders', 0.8], ['traps', 0.7]],

  'barbell-curl': [['biceps', 1], ['forearms', 0.5]],
  'db-curl': [['biceps', 1], ['forearms', 0.4]],
  'hammer-curl': [['biceps', 0.8], ['forearms', 0.8]],
  pushdown: [['triceps', 1]],
  skull: [['triceps', 1]],
  'overhead-ext': [['triceps', 1]],

  plank: [['abs', 1], ['obliques', 0.6]],
  crunch: [['abs', 1]],
  'leg-raise': [['abs', 1], ['obliques', 0.4]],
  'ab-roller': [['abs', 1], ['obliques', 0.5]],
  'cable-crunch': [['abs', 1], ['obliques', 0.4]],
}

/** 自作種目は大分類から代表的な部位を割り当てる */
const GROUP_DEFAULT: Record<Muscle, Targets> = {
  chest: [['chest', 1]],
  back: [['lats', 1], ['traps', 0.5]],
  legs: [['quads', 1], ['glutes', 0.5]],
  shoulders: [['shoulders', 1]],
  arms: [['biceps', 0.6], ['triceps', 0.6]],
  core: [['abs', 1]],
}

export const targetsOf = (ex: Pick<Exercise, 'id' | 'muscle'>): Targets => T[ex.id] ?? GROUP_DEFAULT[ex.muscle]

/** 部位を主働とする代表種目（メニュー自動作成用。先頭ほど優先） */
export const STAPLES: Record<Region, string[]> = {
  chest: ['bench', 'incline-db', 'cable-cross'],
  shoulders: ['ohp', 'lateral', 'rear-delt'],
  traps: ['barbell-row', 'face-pull'],
  lats: ['lat-pulldown', 'seated-row', 'pullup'],
  lowback: ['back-ext', 'rdl'],
  biceps: ['db-curl', 'hammer-curl'],
  triceps: ['pushdown', 'overhead-ext'],
  forearms: ['hammer-curl'],
  abs: ['cable-crunch', 'leg-raise', 'plank'],
  obliques: ['plank', 'ab-roller'],
  glutes: ['rdl', 'bulgarian', 'squat'],
  quads: ['squat', 'leg-press', 'leg-ext'],
  hamstrings: ['rdl', 'leg-curl'],
  calves: ['calf-raise'],
}
