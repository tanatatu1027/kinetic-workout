// 種目の「開始・終了」写真を free-exercise-db（Unlicense / パブリックドメイン）から取得し、
// public/exercises/<アプリの種目ID>/0.jpg, 1.jpg として保存する。
// 出典: https://github.com/yuhonas/free-exercise-db
// 実行: node scripts/fetch-exercise-images.mjs（取得済みのファイルは飛ばす）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'

/** アプリの種目ID → free-exercise-db の種目ID（rotary-torso と hanging-knee-raise は動きの合う写真がないため対象外） */
const MAP = {
  bench: 'Barbell_Bench_Press_-_Medium_Grip',
  'incline-bench': 'Barbell_Incline_Bench_Press_-_Medium_Grip',
  'db-press': 'Dumbbell_Bench_Press',
  'incline-db': 'Incline_Dumbbell_Press',
  'db-fly': 'Dumbbell_Flyes',
  'chest-press': 'Machine_Bench_Press',
  'pec-fly': 'Butterfly',
  'cable-cross': 'Cable_Crossover',
  pushup: 'Pushups',
  dips: 'Dips_-_Chest_Version',

  deadlift: 'Barbell_Deadlift',
  'barbell-row': 'Bent_Over_Barbell_Row',
  'db-row': 'One-Arm_Dumbbell_Row',
  'lat-pulldown': 'Wide-Grip_Lat_Pulldown',
  'seated-row': 'Seated_Cable_Rows',
  'machine-row': 'Leverage_Iso_Row',
  pullup: 'Pullups',
  'back-ext': 'Hyperextensions_Back_Extensions',

  squat: 'Barbell_Squat',
  'front-squat': 'Front_Barbell_Squat',
  rdl: 'Romanian_Deadlift',
  'leg-press': 'Leg_Press',
  'leg-ext': 'Leg_Extensions',
  'leg-curl': 'Seated_Leg_Curl',
  lunge: 'Dumbbell_Lunges',
  bulgarian: 'Split_Squat_with_Dumbbells',
  'calf-raise': 'Standing_Calf_Raises',
  'bw-squat': 'Bodyweight_Squat',

  ohp: 'Standing_Military_Press',
  'db-shoulder': 'Dumbbell_Shoulder_Press',
  'shoulder-press': 'Machine_Shoulder_Military_Press',
  lateral: 'Side_Lateral_Raise',
  'rear-delt': 'Seated_Bent-Over_Rear_Delt_Raise',
  'face-pull': 'Face_Pull',

  'barbell-curl': 'Barbell_Curl',
  'db-curl': 'Dumbbell_Bicep_Curl',
  'hammer-curl': 'Hammer_Curls',
  pushdown: 'Triceps_Pushdown',
  skull: 'EZ-Bar_Skullcrusher',
  'overhead-ext': 'Standing_Dumbbell_Triceps_Extension',

  plank: 'Plank',
  crunch: 'Crunches',
  'leg-raise': 'Flat_Bench_Lying_Leg_Raise',
  'ab-roller': 'Ab_Roller',
  'cable-crunch': 'Cable_Crunch',
  'ab-machine': 'Ab_Crunch_Machine',
  'captain-leg-raise': 'Knee_Hip_Raise_On_Parallel_Bars',
  'hanging-leg-raise': 'Hanging_Leg_Raise',
  situp: 'Sit-Up',
  'decline-situp': 'Decline_Crunch',
  'bicycle-crunch': 'Air_Bike',
  'side-plank': 'Side_Bridge',
  'weighted-crunch': 'Weighted_Crunches',
  'russian-twist': 'Russian_Twist',
  'side-bend': 'Dumbbell_Side_Bend',
  woodchop: 'Standing_Cable_Wood_Chop',
  pallof: 'Pallof_Press',
  'cable-twist': 'Cable_Russian_Twists',
}

let ok = 0
let failed = []
for (const [id, src] of Object.entries(MAP)) {
  const dir = new URL(`../public/exercises/${id}/`, import.meta.url)
  mkdirSync(dir, { recursive: true })
  for (const n of [0, 1]) {
    const out = new URL(`${n}.jpg`, dir)
    if (existsSync(out)) {
      ok++
      continue
    }
    const res = await fetch(`${BASE}${encodeURIComponent(src)}/${n}.jpg`)
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.startsWith('image/')) {
      failed.push(`${id} (${src}/${n}.jpg): ${res.status} ${type}`)
      continue
    }
    writeFileSync(out, Buffer.from(await res.arrayBuffer()))
    ok++
  }
}
console.log(`saved ${ok} files`)
if (failed.length) console.log('FAILED:\n' + failed.join('\n'))
