import { useEffect, useState } from 'react'
import { EQUIPMENT_LABEL, isSeconds, muscleOf } from '../data/exercises'
import { demoSrc, GUIDES, hasDemo } from '../data/guides'
import { findExercise, useStore } from '../lib/store'
import { MuscleBadge, Sheet } from './Common'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 一覧用の小さな写真。写真のない種目（自作）は何も出さない */
export function ExerciseThumb({ id }: { id: string }) {
  if (!hasDemo(id)) return <span className="ex-thumb none" aria-hidden="true" />
  return <img className="ex-thumb" src={demoSrc(id, 0)} alt="" loading="lazy" width={60} height={40} />
}

/** 開始と終了の2枚を交互に切り替えて動きを見せる。タップで一時停止 */
export function ExerciseDemo({ id, name }: { id: string; name: string }) {
  const [frame, setFrame] = useState<0 | 1>(0)
  const [playing, setPlaying] = useState(() => !reducedMotion())
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), 1300)
    return () => window.clearInterval(t)
  }, [playing])

  if (failed) return <p className="demo-missing">写真を読み込めませんでした。通信状態を確認してください。</p>

  return (
    <div className="demo">
      <button className="demo-stage" onClick={() => setPlaying((p) => !p)} aria-label={playing ? '動きの再生を止める' : '動きを再生する'}>
        <img src={demoSrc(id, 0)} alt={`${name}の開始姿勢`} onError={() => setFailed(true)} />
        <img src={demoSrc(id, 1)} alt={`${name}の動作後の姿勢`} className={frame === 1 ? 'show' : ''} onError={() => setFailed(true)} />
        <span className="demo-state">{playing ? '再生中（タップで停止）' : '停止中（タップで再生）'}</span>
      </button>
      <div className="seg wide demo-frames" role="group" aria-label="表示する姿勢">
        {([0, 1] as const).map((n) => (
          <button
            key={n}
            className={frame === n ? 'on' : ''}
            aria-pressed={frame === n}
            onClick={() => {
              setPlaying(false)
              setFrame(n)
            }}
          >
            {n === 0 ? '① はじめの姿勢' : '② 動かしたところ'}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 種目ガイド: 動き・使う筋肉・やり方・注意点 */
export function GuideSheet({ exerciseId, onClose }: { exerciseId: string; onClose: () => void }) {
  const s = useStore()
  const ex = findExercise(s, exerciseId)
  const guide = GUIDES[exerciseId]
  const m = muscleOf(ex.muscle)

  return (
    <Sheet title={ex.name} onClose={onClose} footer={<button className="btn wide" onClick={onClose}>閉じる</button>}>
      <div className="guide-tags">
        <MuscleBadge muscle={ex.muscle} />
        <span>{m.label}</span>
        <span className="guide-tag">{EQUIPMENT_LABEL[ex.equipment]}</span>
        {guide?.easy && <span className="guide-tag easy">初心者におすすめ</span>}
      </div>

      {guide ? (
        <>
          {hasDemo(exerciseId) ? (
            <ExerciseDemo key={exerciseId} id={exerciseId} name={ex.name} />
          ) : (
            <p className="demo-missing">この種目は動きの合う写真がないため、文章での説明のみです。</p>
          )}
          {guide.photoNote && <p className="hint">※ {guide.photoNote}</p>}

          <section className="guide-block">
            <h3 className="hud-label">使う筋肉</h3>
            <p>{guide.muscles}</p>
          </section>
          <section className="guide-block">
            <h3 className="hud-label">やり方</h3>
            <ol className="guide-steps">
              {guide.steps.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          </section>
          <section className="guide-block caution">
            <h3 className="hud-label">気をつけること</h3>
            <p>{guide.caution}</p>
          </section>
          <section className="guide-block">
            <h3 className="hud-label">回数の目安</h3>
            <p>
              {isSeconds(exerciseId)
                ? '20〜30秒を2〜3セット。姿勢が崩れる前に終えます。'
                : ex.equipment === 'bodyweight'
                  ? '10〜15回を2〜3セット。フォームが崩れない回数で行います。'
                  : '10回前後を3セット。「あと2回できるかどうか」で終わる重さが目安です。最初は軽めで動きを覚えましょう。'}
            </p>
          </section>
          <p className="hint">{hasDemo(exerciseId) ? '写真出典: free-exercise-db（パブリックドメイン）。' : ''}痛みが出たら中止してください。</p>
        </>
      ) : (
        <p className="empty big">自作の種目には、動きの写真と解説がありません。</p>
      )}
    </Sheet>
  )
}
