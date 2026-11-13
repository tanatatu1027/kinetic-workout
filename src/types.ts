export type Muscle = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core'
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight'

export interface Exercise {
  id: string
  name: string
  muscle: Muscle
  equipment: Equipment
  custom?: boolean
}

export interface SetEntry {
  id: string
  weight: number | null
  reps: number | null
  done: boolean
  /** ウォームアップは集計・PR・前回値の対象外 */
  warmup?: boolean
}

export interface WorkoutExercise {
  id: string
  exerciseId: string
  sets: SetEntry[]
}

export interface Workout {
  id: string
  /** ローカル日付 YYYY-MM-DD */
  date: string
  startedAt: number
  endedAt: number
  title: string
  note: string
  exercises: WorkoutExercise[]
}

/** live: 今まさに実施中 / backfill: 過去日の後付け / edit: 保存済みの編集 */
export type WorkoutMode = 'live' | 'backfill' | 'edit'

export interface ActiveWorkout extends Workout {
  mode: WorkoutMode
}

export interface TemplateItem {
  exerciseId: string
  sets: number
}

export interface Template {
  id: string
  name: string
  items: TemplateItem[]
  builtin?: boolean
}

export interface Settings {
  restSeconds: number
  weightStep: number
  /** ジムの明るい環境向け。発光を切り文字を最大輝度にする */
  highContrast: boolean
  /** セット完了で休憩タイマーを自動開始する */
  autoRest: boolean
  /** BMI計算用。未設定なら null */
  heightCm: number | null
  /** 目標体重。未設定なら null */
  goalWeight: number | null
}

/** 体組成の記録（1日1件）。測っていない項目は null */
export interface BodyLog {
  /** ローカル日付 YYYY-MM-DD */
  date: string
  weight: number | null
  /** 体脂肪率 % */
  fat: number | null
  /** 筋肉量 kg */
  muscle: number | null
  /** ウエスト cm */
  waist: number | null
  note: string
}

export interface RestState {
  endsAt: number
  duration: number
}

export interface AppData {
  version: 1
  customExercises: Exercise[]
  workouts: Workout[]
  bodyLogs: BodyLog[]
  templates: Template[]
  settings: Settings
  active: ActiveWorkout | null
  rest: RestState | null
  lastExportAt: number | null
  /** 内蔵テンプレートをどの版まで配布済みか（後から追加した内蔵テンプレートを既存データへ一度だけ足すため） */
  tplSeed: number
}
