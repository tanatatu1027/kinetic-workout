import { useSyncExternalStore } from 'react'
import { BUILTIN_TEMPLATES, MUSCLES, PRESET_EXERCISES, TEMPLATE_SEEDS, TPL_SEED } from '../data/exercises'
import type { ActiveWorkout, AppData, BodyLog, Exercise, SetEntry, Template, TemplateItem, Workout } from '../types'
import { fromKey, todayKey } from './date'
import { lastSets, type TimeRef } from './stats'
import { toast } from './ui'

const KEY = 'kinetic.v1'

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const defaults = (): AppData => ({
  version: 1,
  customExercises: [],
  workouts: [],
  bodyLogs: [],
  templates: BUILTIN_TEMPLATES,
  settings: { restSeconds: 90, weightStep: 2.5, highContrast: false, autoRest: true, heightCm: null, goalWeight: null },
  active: null,
  rest: null,
  lastExportAt: null,
  tplSeed: TPL_SEED,
})

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight']

// 壊れた/細工されたデータで描画が固まらないよう、件数・長さ・値に上限を設ける（通常利用では到達しない大きさ）
const MAX_STR = 500
const MAX_ID = 64
const MAX_VALUE = 1_000_000
const str = (v: unknown, max = MAX_STR): v is string => typeof v === 'string' && v.length <= max
const id = (v: unknown): v is string => str(v, MAX_ID) && /^[\w-]+$/.test(v)

/** 2024-99-99 のような実在しない日付を弾く */
const realDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(v + 'T00:00:00')
  return !Number.isNaN(d.getTime()) && todayKeyOf(d) === v
}
const todayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const MAX_TIME = 4_102_444_800_000 // 2100-01-01

const validSet = (s: unknown) =>
  isObj(s) &&
  id(s.id) &&
  (s.weight === null || (isNum(s.weight) && s.weight >= 0 && s.weight <= MAX_VALUE)) &&
  (s.reps === null || (isNum(s.reps) && s.reps >= 0 && s.reps <= MAX_VALUE)) &&
  typeof s.done === 'boolean' &&
  (s.warmup === undefined || typeof s.warmup === 'boolean') &&
  (s.rir === undefined || s.rir === 0 || s.rir === 1 || s.rir === 2 || s.rir === 3)

const validWorkoutExercise = (x: unknown) =>
  isObj(x) &&
  id(x.id) &&
  id(x.exerciseId) &&
  Array.isArray(x.sets) &&
  x.sets.length <= 200 &&
  x.sets.every(validSet) &&
  (x.note === undefined || str(x.note, 500))

const validWorkout = (w: unknown) =>
  isObj(w) &&
  id(w.id) &&
  realDate(w.date) &&
  isNum(w.startedAt) &&
  isNum(w.endedAt) &&
  w.startedAt >= 0 &&
  w.endedAt <= MAX_TIME &&
  w.endedAt >= w.startedAt &&
  str(w.title) &&
  (w.note === undefined || str(w.note, 2000)) &&
  Array.isArray(w.exercises) &&
  w.exercises.length <= 100 &&
  w.exercises.every(validWorkoutExercise)

const validExercise = (e: unknown) =>
  isObj(e) &&
  id(e.id) &&
  e.id.startsWith('c-') &&
  str(e.name, 80) &&
  MUSCLES.some((m) => m.id === e.muscle) &&
  EQUIPMENT.includes(e.equipment as string) &&
  (e.deleted === undefined || typeof e.deleted === 'boolean')

const validTemplate = (t: unknown) =>
  isObj(t) &&
  id(t.id) &&
  str(t.name, 80) &&
  Array.isArray(t.items) &&
  t.items.length <= 100 &&
  t.items.every((i) => isObj(i) && id(i.exerciseId) && isNum(i.sets) && i.sets >= 1 && i.sets <= 30)

const bodyVal = (v: unknown, max: number) => v === null || (isNum(v) && v > 0 && v <= max)

const validBodyLog = (b: unknown) =>
  isObj(b) &&
  realDate(b.date) &&
  bodyVal(b.weight, 500) &&
  bodyVal(b.fat, 100) &&
  bodyVal(b.muscle, 500) &&
  bodyVal(b.waist, 500) &&
  str(b.note, 2000)

// ---- 未知の項目を取り込まないよう、検証済みレコードから既知の項目だけを複製する ----
const cleanSet = (s: SetEntry): SetEntry => ({
  id: s.id,
  weight: s.weight,
  reps: s.reps,
  done: s.done,
  ...(s.warmup === undefined ? {} : { warmup: s.warmup }),
  ...(s.rir === undefined ? {} : { rir: s.rir }),
})
const cleanWorkout = (w: Workout): Workout => ({
  id: w.id,
  date: w.date,
  startedAt: w.startedAt,
  endedAt: w.endedAt,
  title: w.title,
  note: typeof w.note === 'string' ? w.note : '',
  exercises: w.exercises.map((x) => ({
    id: x.id,
    exerciseId: x.exerciseId,
    sets: x.sets.map(cleanSet),
    ...(typeof x.note === 'string' && x.note ? { note: x.note } : {}),
  })),
})
const cleanExercise = (e: Exercise): Exercise => ({
  id: e.id,
  name: e.name,
  muscle: e.muscle,
  equipment: e.equipment,
  ...(e.custom === true ? { custom: true } : {}),
  ...(e.deleted === true ? { deleted: true } : {}),
})
const cleanTemplate = (t: Template): Template => ({
  id: t.id,
  name: t.name,
  items: t.items.map((i) => ({ exerciseId: i.exerciseId, sets: i.sets })),
  ...(t.builtin === true ? { builtin: true } : {}),
})
const cleanBodyLog = (b: BodyLog): BodyLog => ({ date: b.date, weight: b.weight, fat: b.fat, muscle: b.muscle, waist: b.waist, note: b.note })

// ---- データ形式のマイグレーション ----
export const CURRENT_VERSION = 1
/** migrations[n] は version n のデータを version n+1 に変換する。新しい形式を作るときはここへ足す */
export const migrations: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {}

/** 古い version のデータを現行形式まで順に変換する。変換できなければ null。table を渡すとテストで差し替えられる */
export function migrate(raw: unknown, table: typeof migrations = migrations, target = CURRENT_VERSION): Record<string, unknown> | null {
  if (!isObj(raw)) return null
  let v = raw.version
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > target) return null
  let cur: Record<string, unknown> = raw
  while (v < target) {
    const fn = table[v]
    if (!fn) return null
    cur = fn(cur)
    v++
    cur = { ...cur, version: v }
  }
  return cur
}

export interface ParseResult {
  data: AppData
  /** 不正なため取り込まなかったレコード数 */
  dropped: number
}

/** 不正なレコードだけ除外して読み込む。version 不一致など構造が根本的に壊れている場合は null */
export function parseDataDetailed(input: unknown): ParseResult | null {
  const raw = migrate(input)
  if (!raw || !Array.isArray(raw.workouts)) return null
  if (raw.workouts.length > 50000) return null
  const rawEx = raw.customExercises ?? []
  const rawTpl = raw.templates ?? BUILTIN_TEMPLATES
  const rawBody = raw.bodyLogs ?? [] // 体組成は後から追加した項目。古いバックアップには無いので空として扱う
  if (!Array.isArray(rawEx) || rawEx.length > 2000) return null
  if (!Array.isArray(rawTpl) || rawTpl.length > 500) return null
  if (!Array.isArray(rawBody) || rawBody.length > 20000) return null

  let dropped = 0
  const keep = <T>(list: unknown[], ok: (v: unknown) => boolean, uniq?: (v: T) => string): T[] => {
    const seen = new Set<string>()
    const out: T[] = []
    for (const v of list) {
      if (!ok(v)) {
        dropped++
        continue
      }
      if (uniq) {
        const k = uniq(v as T)
        if (seen.has(k)) {
          dropped++
          continue
        }
        seen.add(k)
      }
      out.push(v as T)
    }
    return out
  }

  const workouts = keep<Workout>(raw.workouts, validWorkout, (w) => w.id).map(cleanWorkout)
  const customExercises = keep<Exercise>(rawEx, validExercise, (e) => e.id).map(cleanExercise)
  const templates = keep<Template>(rawTpl, validTemplate, (t) => t.id).map(cleanTemplate)
  // 同じ日の体組成は1件のみ（後勝ち）
  const bodyByDate = new Map<string, BodyLog>()
  for (const b of keep<BodyLog>(rawBody, validBodyLog).map(cleanBodyLog)) bodyByDate.set(b.date, b)

  const base = defaults()
  const settings = isObj(raw.settings) ? raw.settings : {}
  // 後から追加した内蔵テンプレートを、既存データへ一度だけ先頭に足す（利用者が消した後は復活させない）
  const seed = raw.templates === undefined ? TPL_SEED : isNum(raw.tplSeed) ? raw.tplSeed : 1
  const have = new Set(templates.map((v) => v.id))
  const added = Object.entries(TEMPLATE_SEEDS)
    .filter(([ver]) => Number(ver) > seed)
    .flatMap(([, ids]) => ids)
    .filter((v) => !have.has(v))
    .flatMap((v) => BUILTIN_TEMPLATES.filter((b) => b.id === v))

  const active = validWorkout(raw.active) ? cleanWorkout(raw.active as Workout) : null
  const activeMode = isObj(raw.active) ? raw.active.mode : undefined
  const rbe: Record<string, number> = {}
  if (isObj(settings.restByExercise)) {
    for (const [k, v] of Object.entries(settings.restByExercise).slice(0, 500)) {
      if (id(k) && isNum(v) && v >= 1 && v <= 3600) rbe[k] = v
    }
  }
  const goal = settings.weeklyGoal
  const data: AppData = {
    ...base,
    workouts,
    bodyLogs: [...bodyByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    customExercises,
    templates: [...added, ...templates],
    tplSeed: TPL_SEED,
    settings: {
      restSeconds: isNum(settings.restSeconds) && settings.restSeconds >= 1 && settings.restSeconds <= 3600 ? settings.restSeconds : base.settings.restSeconds,
      weightStep: isNum(settings.weightStep) && settings.weightStep >= 0.1 && settings.weightStep <= 100 ? settings.weightStep : base.settings.weightStep,
      highContrast: settings.highContrast === true,
      autoRest: settings.autoRest !== false,
      heightCm: isNum(settings.heightCm) && settings.heightCm >= 50 && settings.heightCm <= 260 ? settings.heightCm : null,
      goalWeight: isNum(settings.goalWeight) && settings.goalWeight > 0 && settings.goalWeight <= 500 ? settings.goalWeight : null,
      ...(isNum(goal) && Number.isInteger(goal) && goal >= 1 && goal <= 14 ? { weeklyGoal: goal } : {}),
      ...(Object.keys(rbe).length > 0 ? { restByExercise: rbe } : {}),
    },
    active: active && (activeMode === 'live' || activeMode === 'backfill' || activeMode === 'edit') ? { ...active, mode: activeMode } : null,
    rest:
      isObj(raw.rest) && isNum(raw.rest.endsAt) && isNum(raw.rest.duration) && raw.rest.duration >= 1 && raw.rest.duration <= 3600 && raw.rest.endsAt <= Date.now() + 3600 * 1000
        ? { endsAt: raw.rest.endsAt, duration: raw.rest.duration }
        : null,
    lastExportAt: isNum(raw.lastExportAt) ? raw.lastExportAt : null,
  }
  return { data, dropped }
}

/** 起動時とバックアップ読込の両方で使う形式チェック。不正なレコードは除外して読み込む（除外数が要る場合は parseDataDetailed） */
export function parseData(raw: unknown): AppData | null {
  return parseDataDetailed(raw)?.data ?? null
}

const QUARANTINE_GENERATIONS = 2

/** 壊れたデータ・除外したデータの生データを世代付きで退避する（最新2件を残す）。退避に失敗したら false */
export function quarantine(text: string): boolean {
  try {
    const prefix = KEY + '.corrupt.'
    const old = Object.keys(localStorage).filter((k) => k.startsWith(prefix)).sort()
    while (old.length >= QUARANTINE_GENERATIONS) localStorage.removeItem(old.shift()!)
    localStorage.setItem(prefix + Date.now(), text)
    return true
  } catch {
    return false
  }
}

/** 起動時に読めなかった場合 true。この間は元データを上書きしない */
export let loadFailed = false

function removeKey(k: string) {
  try {
    localStorage.removeItem(k)
  } catch {
    // 無視
  }
}

function load(): AppData {
  let text: string | null = null
  try {
    text = localStorage.getItem(KEY)
    if (!text) return defaults()
    const res = parseDataDetailed(JSON.parse(text))
    if (res) {
      if (res.dropped > 0) {
        // 一部だけ読めなかった。元データを退避したうえで、読めた分で続行する
        if (!quarantine(text)) loadFailed = true
        setTimeout(() => toast(`不正なデータ${res.dropped}件を除外して読み込みました。元データは退避済みです（設定から確認）`), 500)
      } else {
        removeKey(KEY + '.prev') // 復元時の1世代退避は、次回起動で役目を終える
      }
      return res.data
    }
  } catch {
    // JSONの構文エラーも下で同様に退避する
  }
  if (text) {
    // 検証・パースに落ちた生データは次の保存で上書きされるため、必ず退避してから初期化する
    if (!quarantine(text)) loadFailed = true
    setTimeout(() => toast('保存データを読み込めませんでした。元データは退避済みです（設定から確認）'), 500)
  }
  return defaults()
}

let state = load()
const listeners = new Set<() => void>()

export const getState = () => state

function persist(next: AppData): boolean {
  if (loadFailed) return false // 退避に失敗した破損データを上書きしない
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

let saveWarned = false
let dirty = false
let saveTimer: number | undefined
let lastOk = true

/** 未保存の変更を書き込む。失敗したら false */
export function flushSave(): boolean {
  window.clearTimeout(saveTimer)
  if (!dirty) return lastOk
  dirty = false
  lastOk = persist(state)
  if (!lastOk && !saveWarned) {
    saveWarned = true
    toast('保存に失敗しました。バックアップを書き出してください')
    setTimeout(() => (saveWarned = false), 10000)
  }
  return lastOk
}

/** 状態を更新する。保存は短い間隔でまとめて行う（replaceAll など確実さが要る所は flushSave を使う） */
export function setState(update: (s: AppData) => AppData): boolean {
  const next = update(state)
  if (next === state) return true
  state = next
  dirty = true
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flushSave, 300)
  listeners.forEach((l) => l())
  return true
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSave)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave()
  })
}

// 別タブ・別ウィンドウでの変更を取り込む（後勝ちで上書きし合わない）
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return
    try {
      const parsed = parseData(JSON.parse(e.newValue))
      if (parsed) {
        if (dirty) {
          // 未保存の変更がある場合は先に保存し、他タブの内容と合流させる（進行中の記録と、こちらだけにある記録を残す）
          flushSave()
          const have = new Set(parsed.workouts.map((w) => w.id))
          const mine = state.workouts.filter((w) => !have.has(w.id))
          state = {
            ...parsed,
            workouts: mine.length ? [...parsed.workouts, ...mine] : parsed.workouts,
            active: state.active ?? parsed.active,
            rest: state.rest ?? parsed.rest,
          }
          dirty = true
          window.clearTimeout(saveTimer)
          saveTimer = window.setTimeout(flushSave, 300)
        } else {
          state = parsed
        }
        listeners.forEach((l) => l())
      }
    } catch {
      // 不正な値は無視
    }
  })
}

export const subscribeStore = (l: () => void) => subscribe(l)

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export const useStore = () => useSyncExternalStore(subscribe, getState)

/** 種目選択・設定の一覧に出す種目（削除済みは含まない） */
export const allExercises = (s: AppData): Exercise[] => [...PRESET_EXERCISES, ...s.customExercises.filter((e) => !e.deleted)]
/** 削除済みの自作種目も含む。過去の記録を集計するときに使う */
export const allExercisesIncludingDeleted = (s: AppData): Exercise[] => [...PRESET_EXERCISES, ...s.customExercises]
/** 設定画面の自作種目一覧用（削除済みを除く） */
export const activeCustomExercises = (s: AppData): Exercise[] => s.customExercises.filter((e) => !e.deleted)

const presetMap = new Map(PRESET_EXERCISES.map((e) => [e.id, e]))
/** 削除済みの自作種目も、元の名前と部位で返す（過去の記録の表示用） */
export const findExercise = (s: AppData, id: string): Exercise =>
  presetMap.get(id) ?? s.customExercises.find((e) => e.id === id) ?? { id, name: '削除された種目', muscle: 'core', equipment: 'bodyweight' }

export const blankSet = (from?: Partial<SetEntry>): SetEntry => ({
  id: uid(),
  weight: from?.weight ?? null,
  reps: from?.reps ?? null,
  done: false,
})

/** 前回の内容で事前入力したセットを作る */
export function buildSets(s: AppData, exerciseId: string, count: number | null, ref: TimeRef): SetEntry[] {
  const last = lastSets(s.workouts, exerciseId, ref)?.sets ?? []
  const n = count ?? Math.max(last.length, 3)
  return Array.from({ length: n }, (_, i) => blankSet(last[i] ?? last[last.length - 1]))
}

export function startWorkout(opts: { title: string; items: TemplateItem[]; date?: string }) {
  setState((s) => {
    const date = opts.date ?? todayKey()
    const backfill = date !== todayKey()
    // 同じ過去日に複数追加しても前後関係が付くよう、既存の件数分だけ後ろにずらす
    const sameDay = s.workouts.filter((w) => w.date === date).length
    const startedAt = backfill ? fromKey(date).getTime() + 12 * 3600 * 1000 + sameDay * 60000 : Date.now()
    const ref: TimeRef = { date, startedAt, id: '' }
    const active: ActiveWorkout = {
      id: uid(),
      date,
      startedAt,
      endedAt: startedAt,
      title: opts.title,
      note: '',
      mode: backfill ? 'backfill' : 'live',
      exercises: opts.items.map((it) => ({
        id: uid(),
        exerciseId: it.exerciseId,
        sets: buildSets(s, it.exerciseId, it.sets, ref),
      })),
    }
    return { ...s, active, rest: null }
  })
}

export const updateActive = (fn: (w: ActiveWorkout) => ActiveWorkout) =>
  setState((s) => (s.active ? { ...s, active: fn(s.active) } : s))

export const discardActive = () => setState((s) => ({ ...s, active: null, rest: null }))

/** 完了セットのみ残して保存する。保存対象がなければ null */
export function finishActive(): Workout | null {
  const a = getState().active
  if (!a) return null
  const exercises = a.exercises
    .map((x) => ({ ...x, sets: x.sets.filter((st) => st.done) }))
    .filter((x) => x.sets.length > 0)
  if (exercises.length === 0) return null
  const { mode, ...rest } = a
  const saved: Workout = { ...rest, title: rest.title.trim() || 'トレーニング', exercises, endedAt: mode === 'live' ? Date.now() : a.endedAt }
  setState((s) => ({
    ...s,
    workouts: mode === 'edit' ? s.workouts.map((w) => (w.id === saved.id ? saved : w)) : [...s.workouts, saved],
    active: null,
    rest: null,
  }))
  return saved
}

export const editWorkout = (id: string) =>
  setState((s) => {
    const w = s.workouts.find((x) => x.id === id)
    return w ? { ...s, active: { ...structuredClone(w), mode: 'edit' }, rest: null } : s
  })

export const deleteWorkout = (id: string) => setState((s) => ({ ...s, workouts: s.workouts.filter((w) => w.id !== id) }))

export const startRest = (duration: number) => setState((s) => ({ ...s, rest: { endsAt: Date.now() + duration * 1000, duration } }))

export const adjustRest = (delta: number) =>
  setState((s) => {
    if (!s.rest) return s
    const endsAt = s.rest.endsAt + delta * 1000
    if (endsAt <= Date.now()) return { ...s, rest: null }
    return { ...s, rest: { endsAt, duration: Math.max(s.rest.duration + delta, 1) } }
  })

export const clearRest = () => setState((s) => (s.rest ? { ...s, rest: null } : s))

export const saveTemplate = (name: string, items: TemplateItem[]) =>
  setState((s) => ({ ...s, templates: [...s.templates, { id: uid(), name, items }] }))

export const deleteTemplate = (id: string) => setState((s) => ({ ...s, templates: s.templates.filter((t) => t.id !== id) }))

export const addCustomExercise = (ex: Omit<Exercise, 'id' | 'custom'>): Exercise => {
  const created: Exercise = { ...ex, id: 'c-' + uid(), custom: true }
  setState((s) => ({ ...s, customExercises: [...s.customExercises, created] }))
  return created
}

export const setWeeklyGoal = (n: number) =>
  setState((s) => {
    const v = Math.round(n)
    const { weeklyGoal: _drop, ...rest } = s.settings
    void _drop
    return { ...s, settings: Number.isFinite(v) && v >= 1 && v <= 14 ? { ...rest, weeklyGoal: v } : rest }
  })

/** 種目ごとの休憩秒数。null で共通設定に戻す */
export const setExerciseRest = (exerciseId: string, sec: number | null) =>
  setState((s) => {
    const map = { ...(s.settings.restByExercise ?? {}) }
    if (sec === null || !Number.isFinite(sec) || sec < 1) delete map[exerciseId]
    else map[exerciseId] = Math.min(Math.round(sec), 3600)
    const { restByExercise: _drop, ...rest } = s.settings
    void _drop
    return { ...s, settings: Object.keys(map).length ? { ...rest, restByExercise: map } : rest }
  })

/** 進行中ワークアウトの種目のメモを更新する。workoutExerciseId は ActiveWorkout.exercises[].id */
export const setExerciseNote = (workoutExerciseId: string, note: string) =>
  setState((s) =>
    s.active
      ? { ...s, active: { ...s.active, exercises: s.active.exercises.map((x) => (x.id === workoutExerciseId ? { ...x, note: note.slice(0, 500) } : x)) } }
      : s,
  )

/** テンプレートを編集する（内蔵テンプレートも可） */
export const updateTemplate = (id: string, patch: Partial<Pick<Template, 'name' | 'items'>>) =>
  setState((s) => ({ ...s, templates: s.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))

/** テンプレートを一覧内で上(-1)または下(1)へ動かす */
export const moveTemplate = (id: string, direction: -1 | 1) =>
  setState((s) => {
    const i = s.templates.findIndex((t) => t.id === id)
    const j = i + direction
    if (i < 0 || j < 0 || j >= s.templates.length) return s
    const list = [...s.templates]
    ;[list[i], list[j]] = [list[j], list[i]]
    return { ...s, templates: list }
  })

export const updateSettings = (patch: Partial<AppData['settings']>) =>
  setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }))

/** 体組成を日付単位で保存する。全項目が空なら記録ごと消す */
export const saveBodyLog = (log: BodyLog) =>
  setState((s) => {
    const rest = s.bodyLogs.filter((b) => b.date !== log.date)
    const empty = log.weight === null && log.fat === null && log.muscle === null && log.waist === null && !log.note.trim()
    return { ...s, bodyLogs: empty ? rest : [...rest, log].sort((a, b) => a.date.localeCompare(b.date)) }
  })

/** 復元。直前のデータを kinetic.v1.prev に退避し、保存に失敗したら元に戻す */
export function replaceAll(next: AppData): boolean {
  const prev = state
  try {
    localStorage.setItem(KEY + '.prev', JSON.stringify(prev))
  } catch {
    // 容量不足で退避できなくても復元自体は続行する
  }
  // 進行中のセッションは端末固有なので、復元しても今のものを保持する
  setState((cur) => ({ ...next, active: cur.active, rest: cur.rest }))
  if (flushSave()) return true
  state = prev
  dirty = true
  flushSave()
  listeners.forEach((l) => l())
  return false
}

export function resetAll() {
  setState(() => defaults())
  flushSave()
  // 退避データも消去対象（個人の記録が端末に残らないように）
  for (const k of corruptKeys()) localStorage.removeItem(k)
  localStorage.removeItem(KEY + '.prev')
}

export const updateCustomExercise = (id: string, patch: Partial<Pick<Exercise, 'name' | 'muscle' | 'equipment'>>) =>
  setState((s) => ({ ...s, customExercises: s.customExercises.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))

/** ソフト削除。過去の記録・集計では元の名前と部位のまま表示される */
export const deleteCustomExercise = (id: string) =>
  setState((s) => ({ ...s, customExercises: s.customExercises.map((e) => (e.id === id ? { ...e, deleted: true } : e)) }))

/** 読み込めず退避されたデータのキー一覧 */
export const corruptKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(KEY + '.corrupt')).sort()
export const readCorrupt = (key: string) => localStorage.getItem(key)
