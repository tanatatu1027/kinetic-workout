import type { Equipment, Exercise, Muscle, Template } from '../types'

export const MUSCLES: { id: Muscle; label: string; short: string; color: string }[] = [
  { id: 'chest', label: '胸', short: '胸', color: '#ff5c7a' },
  { id: 'back', label: '背中', short: '背', color: '#3fe0ff' },
  { id: 'legs', label: '脚', short: '脚', color: '#b9ff4a' },
  { id: 'shoulders', label: '肩', short: '肩', color: '#ffc043' },
  { id: 'arms', label: '腕', short: '腕', color: '#bf9bff' },
  { id: 'core', label: '腹筋', short: '腹', color: '#ff9a5c' },
]

export const muscleOf = (id: Muscle) => MUSCLES.find((m) => m.id === id)!

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'バーベル',
  dumbbell: 'ダンベル',
  machine: 'マシン',
  cable: 'ケーブル',
  bodyweight: '自重',
}

/** 回数ではなく秒数で記録する種目 */
export const isSeconds = (id: string) => id === 'plank' || id === 'side-plank'

/** ダンベルは2kg刻みが一般的なので、設定の増減幅が大きくても2kgまでに抑える */
export const stepFor = (equipment: Equipment, base: number) => (equipment === 'dumbbell' ? Math.min(base, 2) : base)

const e = (id: string, name: string, muscle: Muscle, equipment: Equipment): Exercise => ({ id, name, muscle, equipment })

export const PRESET_EXERCISES: Exercise[] = [
  e('bench', 'ベンチプレス', 'chest', 'barbell'),
  e('incline-bench', 'インクラインベンチプレス', 'chest', 'barbell'),
  e('db-press', 'ダンベルプレス', 'chest', 'dumbbell'),
  e('incline-db', 'インクラインダンベルプレス', 'chest', 'dumbbell'),
  e('db-fly', 'ダンベルフライ', 'chest', 'dumbbell'),
  e('chest-press', 'チェストプレス', 'chest', 'machine'),
  e('pec-fly', 'ペックフライ', 'chest', 'machine'),
  e('cable-cross', 'ケーブルクロスオーバー', 'chest', 'cable'),
  e('pushup', '腕立て伏せ', 'chest', 'bodyweight'),
  e('dips', 'ディップス', 'chest', 'bodyweight'),

  e('deadlift', 'デッドリフト', 'back', 'barbell'),
  e('barbell-row', 'ベントオーバーロウ', 'back', 'barbell'),
  e('db-row', 'ワンハンドロウ', 'back', 'dumbbell'),
  e('lat-pulldown', 'ラットプルダウン', 'back', 'machine'),
  e('seated-row', 'シーテッドロウ', 'back', 'cable'),
  e('machine-row', 'マシンロウ', 'back', 'machine'),
  e('pullup', '懸垂', 'back', 'bodyweight'),
  e('back-ext', 'バックエクステンション', 'back', 'bodyweight'),

  e('squat', 'スクワット', 'legs', 'barbell'),
  e('front-squat', 'フロントスクワット', 'legs', 'barbell'),
  e('rdl', 'ルーマニアンデッドリフト', 'legs', 'barbell'),
  e('leg-press', 'レッグプレス', 'legs', 'machine'),
  e('leg-ext', 'レッグエクステンション', 'legs', 'machine'),
  e('leg-curl', 'レッグカール', 'legs', 'machine'),
  e('lunge', 'ランジ', 'legs', 'dumbbell'),
  e('bulgarian', 'ブルガリアンスクワット', 'legs', 'dumbbell'),
  e('calf-raise', 'カーフレイズ', 'legs', 'machine'),
  e('bw-squat', '自重スクワット', 'legs', 'bodyweight'),

  e('ohp', 'オーバーヘッドプレス', 'shoulders', 'barbell'),
  e('db-shoulder', 'ダンベルショルダープレス', 'shoulders', 'dumbbell'),
  e('shoulder-press', 'ショルダープレス', 'shoulders', 'machine'),
  e('lateral', 'サイドレイズ', 'shoulders', 'dumbbell'),
  e('rear-delt', 'リアレイズ', 'shoulders', 'dumbbell'),
  e('face-pull', 'フェイスプル', 'shoulders', 'cable'),

  e('barbell-curl', 'バーベルカール', 'arms', 'barbell'),
  e('db-curl', 'ダンベルカール', 'arms', 'dumbbell'),
  e('hammer-curl', 'ハンマーカール', 'arms', 'dumbbell'),
  e('pushdown', 'トライセプスプッシュダウン', 'arms', 'cable'),
  e('skull', 'ライイングエクステンション', 'arms', 'barbell'),
  e('overhead-ext', 'オーバーヘッドエクステンション', 'arms', 'dumbbell'),

  e('plank', 'プランク（秒）', 'core', 'bodyweight'),
  e('crunch', 'クランチ', 'core', 'bodyweight'),
  e('leg-raise', 'レッグレイズ', 'core', 'bodyweight'),
  e('ab-roller', 'アブローラー', 'core', 'bodyweight'),
  e('cable-crunch', 'ケーブルクランチ', 'core', 'cable'),
  e('ab-machine', 'アブドミナルマシン', 'core', 'machine'),
  e('rotary-torso', 'ロータリートーソ', 'core', 'machine'),
  e('captain-leg-raise', 'キャプテンチェア レッグレイズ', 'core', 'machine'),
  e('hanging-leg-raise', 'ハンギングレッグレイズ', 'core', 'bodyweight'),
  e('hanging-knee-raise', 'ハンギングニーレイズ', 'core', 'bodyweight'),
  e('situp', 'シットアップ', 'core', 'bodyweight'),
  e('decline-situp', 'デクラインシットアップ', 'core', 'bodyweight'),
  e('bicycle-crunch', 'バイシクルクランチ', 'core', 'bodyweight'),
  e('side-plank', 'サイドプランク（秒）', 'core', 'bodyweight'),
  e('weighted-crunch', 'ウェイテッドクランチ', 'core', 'dumbbell'),
  e('russian-twist', 'ロシアンツイスト', 'core', 'dumbbell'),
  e('side-bend', 'サイドベンド', 'core', 'dumbbell'),
  e('woodchop', 'ケーブルウッドチョップ', 'core', 'cable'),
  e('pallof', 'パロフプレス', 'core', 'cable'),
  e('cable-twist', 'ケーブルツイスト', 'core', 'cable'),
]

const t = (id: string, name: string, items: [string, number][]): Template => ({
  id,
  name,
  builtin: true,
  items: items.map(([exerciseId, sets]) => ({ exerciseId, sets })),
})

/** 内蔵テンプレートの版。テンプレートを追加したら上げ、TEMPLATE_SEEDS に追加分を書く */
export const TPL_SEED = 2

export const BUILTIN_TEMPLATES: Template[] = [
  t('tpl-machine-a', 'マシン全身 A（ジム初心者）', [['leg-press', 3], ['chest-press', 3], ['lat-pulldown', 3], ['shoulder-press', 2], ['ab-machine', 2]]),
  t('tpl-machine-b', 'マシン全身 B（ジム初心者）', [['leg-ext', 3], ['leg-curl', 3], ['pec-fly', 3], ['seated-row', 3], ['pushdown', 2], ['crunch', 2]]),
  t('tpl-full-a', '全身 A（初心者向け）', [['squat', 3], ['bench', 3], ['barbell-row', 3], ['plank', 2]]),
  t('tpl-full-b', '全身 B（初心者向け）', [['deadlift', 3], ['ohp', 3], ['lat-pulldown', 3], ['crunch', 2]]),
  t('tpl-push', 'PUSH（胸・肩・三頭）', [['bench', 4], ['incline-db', 3], ['ohp', 3], ['lateral', 3], ['pushdown', 3]]),
  t('tpl-pull', 'PULL（背中・二頭）', [['deadlift', 3], ['lat-pulldown', 3], ['seated-row', 3], ['face-pull', 3], ['db-curl', 3]]),
  t('tpl-legs', 'LEGS（脚）', [['squat', 4], ['rdl', 3], ['leg-press', 3], ['leg-curl', 3], ['calf-raise', 3]]),
]

/** 版2で追加した内蔵テンプレートのID */
export const TEMPLATE_SEEDS: Record<number, string[]> = { 2: ['tpl-machine-a', 'tpl-machine-b'] }
