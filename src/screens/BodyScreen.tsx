import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import type { StartOptions } from '../App'
import type { RegionLook } from '../components/BodyModel'
import { Panel } from '../components/Common'
import { REGIONS, regionInfo, type Region } from '../data/regions'
import { buildMenu, fmtElapsed, fmtRemaining, STAGE_COLOR, STAGE_LABEL, STAGE_NOTE, WEEKLY_TARGET, type Stage } from '../lib/recovery'
import { findExercise, useStore } from '../lib/store'
import { useRecovery } from '../lib/useRecovery'

/** three.js を含む重い部品は、ボディ画面を開いたときに読み込む */
const BodyModel = lazy(() => import('../components/BodyModel').then((m) => ({ default: m.BodyModel })))

const LEGEND: Stage[] = ['damaged', 'recovering', 'ready', 'untrained']

const fmtAt = (t: number) => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}時ごろ`
}

export function StageDot({ stage }: { stage: Stage }) {
  return <i className="stage-dot" style={{ background: STAGE_COLOR[stage] }} aria-hidden="true" />
}

export function BodyScreen({ onStart, paused }: { onStart: (o: StartOptions) => void; paused?: boolean }) {
  const s = useStore()
  const { states, advice, exercises } = useRecovery()
  const [selected, setSelected] = useState<Region[]>([])
  const [snap, setSnap] = useState({ angle: 0, n: 0 })
  // 回転角の表示は毎フレーム変わるため、再描画せずDOMを直接更新する
  const rotRef = useRef<HTMLSpanElement>(null)
  const onAngle = useCallback((deg: number) => {
    if (rotRef.current) rotRef.current.textContent = `ROT ${String(deg).padStart(3, '0')}°`
  }, [])
  const [noGl, setNoGl] = useState(false)

  const look = useMemo(() => {
    const out = {} as Record<Region, RegionLook>
    for (const r of REGIONS) out[r.id] = { color: STAGE_COLOR[states[r.id].stage], strength: states[r.id].strength }
    return out
  }, [states])

  const toggle = (r: Region) => setSelected((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))
  const face = (angle: number) => setSnap((v) => ({ angle, n: v.n + 1 }))

  // おすすめの「使える」判定（回復85%以上）と揃える
  const notReady = selected.filter((r) => states[r].stage === 'damaged' || (states[r].stage === 'recovering' && states[r].progress < 0.85))
  const menu = useMemo(() => buildMenu(selected, exercises), [selected, exercises])
  const title = selected.map((r) => regionInfo(r).label).join('・')

  const pickAdvice = () => {
    const regions = advice.focus.map((f) => f.region)
    setSelected(regions)
    const back = regions.filter((r) => regionInfo(r).side === 'back').length
    face(back > regions.length / 2 ? Math.PI : 0)
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>BODY</h1>
        <span className="day-date">タップで部位を選択</span>
      </header>

      <Panel className="body-panel">
        <div className="body-stage">
          {noGl ? (
            <p className="empty big">3D表示に対応していない環境です。下の一覧から部位を選べます</p>
          ) : (
            <Suspense fallback={<div className="body-skeleton" role="status" aria-label="3Dモデルを読み込み中"><span>3Dモデルを読み込み中…</span></div>}>
              <BodyModel look={look} selected={selected} onToggle={toggle} snap={snap} paused={paused} onAngle={onAngle} onUnsupported={() => setNoGl(true)} />
            </Suspense>
          )}
          <div className="body-hud" aria-hidden="true">
            <span className="num" ref={rotRef}>ROT 000°</span>
          </div>
          <div className="body-snap">
            <button className="chip" onClick={() => face(0)}>前面</button>
            <button className="chip" onClick={() => face(Math.PI)}>背面</button>
          </div>
        </div>
        <div className="legend stage-legend">
          <b className="legend-title">色は目安</b>
          {LEGEND.map((st) => (
            <span key={st}><StageDot stage={st} />{st === 'untrained' ? '未記録・未実施' : STAGE_LABEL[st]}</span>
          ))}
        </div>
        {selected.length > 0 && (
          <div className="sel-bar">
            <div className="sel-chips" aria-label="選択中の部位">
              {selected.map((r) => (
                <button key={r} className="chip on" onClick={() => toggle(r)} aria-label={`${regionInfo(r).label}の選択を外す`}>
                  <StageDot stage={states[r].stage} />
                  {regionInfo(r).label}
                </button>
              ))}
            </div>
            <button className="btn primary" onClick={() => onStart({ title, items: menu })}>開始</button>
          </div>
        )}
        <p className="hint">ドラッグで360°回転、部位をタップで選択。色は最後のトレーニングからの経過時間をもとにした目安です。</p>
      </Panel>

      <Panel label="ADVISOR" className="advisor">
        <h3 className="advisor-title">{advice.title}</h3>
        <p className="advisor-head">{advice.headline}</p>
        {advice.focus.length > 0 && (
          <ul className="advice-list">
            {advice.focus.map((f) => (
              <li key={f.region}>
                <StageDot stage={states[f.region].stage} />
                <b>{regionInfo(f.region).label}</b>
                <span>{f.reason}</span>
              </li>
            ))}
          </ul>
        )}
        {advice.rest.length > 0 && (
          <>
            <h4 className="hud-label">休ませたい部位</h4>
            <ul className="advice-list rest">
              {advice.rest.map((f) => (
                <li key={f.region}>
                  <StageDot stage={states[f.region].stage} />
                  <b>{regionInfo(f.region).label}</b>
                  <span>{f.reason}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {advice.kind === 'train' && (
          <div className="advice-actions">
            <button className="btn" onClick={pickAdvice}>モデルで確認</button>
            <button className="btn primary" onClick={() => onStart({ title: advice.title.replace('今日は ', '').split('（')[0], items: advice.items })}>
              おすすめで開始
            </button>
          </div>
        )}
      </Panel>

      <Panel
        label="SELECTED"
        className="sel-panel"
        right={selected.length > 0 ? <button className="link" onClick={() => setSelected([])}>すべて解除</button> : undefined}
      >
        {selected.length === 0 ? (
          <p className="empty">人体モデルか下の一覧から、鍛えたい部位をタップしてください（複数選べます）</p>
        ) : (
          <>
            <ul className="sel-list">
              {selected.map((r) => {
                const st = states[r]
                return (
                  <li key={r} className="sel-card" style={{ borderLeftColor: STAGE_COLOR[st.stage] }}>
                    <div className="sel-head">
                      <b>{regionInfo(r).label}</b>
                      <span className="sel-stage" style={{ color: STAGE_COLOR[st.stage] }}>{STAGE_LABEL[st.stage]}</span>
                    </div>
                    {st.lastAt !== null && (
                      <div className="recov-bar" role="img" aria-label={`経過の目安 ${Math.round(st.progress * 100)}%`}>
                        <i style={{ width: `${st.progress * 100}%`, background: STAGE_COLOR[st.stage] }} />
                      </div>
                    )}
                    {st.elapsedHours !== null && <p className="sel-elapsed num">前回から{fmtElapsed(st.elapsedHours)}経過</p>}
                    <p className="sel-note">{STAGE_NOTE[st.stage]}</p>
                    <dl className="kv sm">
                      {st.lastAt !== null && st.remainingHours > 0 && (<><dt>間隔の目安</dt><dd>あと{fmtRemaining(st.remainingHours)}（{fmtAt(st.readyAt!)}）</dd></>)}
                      {st.lastDate && (<><dt>前回</dt><dd>{st.lastDate.slice(5).replace('-', '/')}・{st.lastSets}セット</dd></>)}
                      <dt>直近7日のセット</dt>
                      <dd className="num">{st.weeklySets} / {WEEKLY_TARGET}</dd>
                    </dl>
                  </li>
                )
              })}
            </ul>
            {notReady.length > 0 && (
              <p className="warn">
                {notReady.map((r) => regionInfo(r).label).join('・')}は前回からの間隔が短めです（目安）。強い追い込みは避け、軽めの負荷にするか、間隔をあけるのがおすすめです。
              </p>
            )}
            <div className="menu-preview">
              <h4 className="hud-label">おすすめメニュー</h4>
              <ol>
                {menu.map((it) => (
                  <li key={it.exerciseId}>{findExercise(s, it.exerciseId).name}<span className="num">{it.sets}セット</span></li>
                ))}
              </ol>
            </div>
            <button className="btn primary wide big" onClick={() => onStart({ title, items: menu })}>
              この部位でトレーニング開始
            </button>
          </>
        )}
      </Panel>

      <Panel label="ALL REGIONS" className="regions-panel">
        <ul className="region-list">
          {REGIONS.map((r) => {
            const st = states[r.id]
            const on = selected.includes(r.id)
            return (
              <li key={r.id}>
                <button className={`region-row ${on ? 'on' : ''}`} onClick={() => toggle(r.id)} aria-pressed={on}>
                  <StageDot stage={st.stage} />
                  <span className="region-name">{r.label}</span>
                  <span className="region-state">
                    {st.elapsedHours === null ? STAGE_LABEL[st.stage] : <>前回から{fmtElapsed(st.elapsedHours)}</>}
                    <small>{st.elapsedHours === null ? '' : STAGE_LABEL[st.stage]}</small>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Panel>

      <p className="hint disclaimer">
        部位ごとの色・割合・時間は、トレーニング記録（部位・セット数・経過時間）から推定した目安で、科学的に確立した回復時間ではありません。個人差が大きく、医学的な診断でもありません。実際の筋肉痛や疲労感を優先し、痛みが続くときは休んでください。
      </p>
    </div>
  )
}
