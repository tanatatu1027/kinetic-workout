import { useMemo, useState } from 'react'
import type { StartOptions } from '../App'
import { MuscleBadge, Panel, Sheet, Stat } from '../components/Common'
import { RmSheet } from '../components/RmSheet'
import { ExerciseThumb, GuideSheet } from '../components/ExerciseGuide'
import { ExercisePicker } from '../components/ExercisePicker'
import { IconBolt, IconClose, IconInfo, IconMinus, IconNext, IconPlus } from '../components/Icons'
import { addDays, fmtLong, startOfWeek, toKey, todayKey, WEEK_JP } from '../lib/date'
import { weekStreak } from '../lib/insights'
import { exportJson } from '../lib/backup'
import { fmtVolume, musclesOf, workoutSetCount, workoutVolume } from '../lib/stats'
import { deleteTemplate, findExercise, saveTemplate, useStore } from '../lib/store'
import { askConfirm } from '../lib/ui'
import { useRecovery } from '../lib/useRecovery'
import type { Muscle, Template, TemplateItem } from '../types'

const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

function TemplateBuilder({ onClose }: { onClose: () => void }) {
  const s = useStore()
  const [name, setName] = useState('')
  const [items, setItems] = useState<TemplateItem[]>([])
  const [picking, setPicking] = useState(false)

  const change = (i: number, d: number) =>
    setItems((list) => list.map((it, n) => (n === i ? { ...it, sets: Math.min(30, Math.max(1, it.sets + d)) } : it)))

  return (
    <>
      <Sheet
        title="テンプレートを作成"
        onClose={onClose}
        footer={
          <button
            className="btn primary wide"
            disabled={!name.trim() || items.length === 0}
            onClick={() => {
              saveTemplate(name.trim(), items)
              onClose()
            }}
          >
            保存する
          </button>
        }
      >
        <label className="field">
          <span>テンプレート名</span>
          <input className="text" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="例: 月曜 胸の日" />
        </label>
        <ul className="tpl-edit">
          {items.map((it, i) => {
            const ex = findExercise(s, it.exerciseId)
            return (
              <li key={it.exerciseId}>
                <MuscleBadge muscle={ex.muscle} />
                <span className="tpl-edit-name">{ex.name}</span>
                <button className="icon-btn" onClick={() => change(i, -1)} aria-label="セットを減らす"><IconMinus size={18} /></button>
                <span className="num">{it.sets}</span>
                <button className="icon-btn" onClick={() => change(i, 1)} aria-label="セットを増やす"><IconPlus size={18} /></button>
                <button className="icon-btn" onClick={() => setItems((l) => l.filter((_, n) => n !== i))} aria-label={`${ex.name}を外す`}><IconClose size={18} /></button>
              </li>
            )
          })}
        </ul>
        <button className="btn wide" onClick={() => setPicking(true)}>
          <IconPlus size={18} /> 種目を追加
        </button>
      </Sheet>
      {picking && (
        <ExercisePicker
          onClose={() => setPicking(false)}
          onPick={(ids) => {
            setItems((l) => [...l, ...ids.filter((id) => !l.some((it) => it.exerciseId === id)).map((exerciseId) => ({ exerciseId, sets: 3 }))])
            setPicking(false)
          }}
        />
      )}
    </>
  )
}

/** メニューの中身を、開始する前に確認する。種目をタップすると動きとやり方が見られる */
function TemplatePreview({ template, onStart, onClose }: { template: Template; onStart: () => void; onClose: () => void }) {
  const s = useStore()
  const [guideId, setGuideId] = useState<string | null>(null)
  return (
    <>
      <Sheet title={template.name} onClose={onClose} footer={<button className="btn primary wide big" onClick={onStart}>このメニューで開始</button>}>
        <p className="hint">種目をタップすると、動きとやり方を確認できます。重さと回数は開始後に入力します。</p>
        <ol className="tpl-preview">
          {template.items.map((it, i) => {
            const ex = findExercise(s, it.exerciseId)
            return (
              <li key={`${it.exerciseId}-${i}`}>
                <button onClick={() => setGuideId(ex.id)} aria-label={`${ex.name}の動きを見る`}>
                  <span className="num tpl-no">{i + 1}</span>
                  <ExerciseThumb id={ex.id} />
                  <span className="pick-name">
                    {ex.name}
                    <small><MuscleBadge muscle={ex.muscle} size="sm" /> {it.sets}セット</small>
                  </span>
                  <IconNext size={18} />
                </button>
              </li>
            )
          })}
        </ol>
      </Sheet>
      {guideId && <GuideSheet exerciseId={guideId} onClose={() => setGuideId(null)} />}
    </>
  )
}

const fmtTon = (kg: number) => (kg / 1000).toFixed(kg >= 100000 ? 0 : 1)

function VolCard({ label, t, unit, per, icon }: { label: string; t: number; unit: string; per: number; icon: string }) {
  return (
    <div className="vol-card">
      <span>{label}</span>
      <b className="num">{fmtTon(t)}<small>t</small></b>
      <em>×{(t / 1000 / per).toFixed(1)}</em>
      <span className="vol-unit">{icon} {unit}</span>
    </div>
  )
}

/** 直近6週の週ごとの総量。今週が一番上 */
function WeekBars({ weeks }: { weeks: number[] }) {
  const max = Math.max(...weeks, 1)
  const label = (i: number) => (i === 0 ? '今週' : `${i}週前`)
  return (
    <ul className="week-bars" aria-label="週ごとの総量">
      {weeks.map((v, i) => (
        <li key={i}>
          <span>{label(i)}</span>
          <i><u className={i === 0 ? 'now' : ''} style={{ width: `${(v / max) * 100}%` }} /></i>
          <b className="num">{fmtTon(v)}t</b>
        </li>
      ))}
    </ul>
  )
}

export function HomeScreen({ onStart, onShowDay, onOpenBody }: { onStart: (o: StartOptions) => void; onShowDay: (date: string) => void; onOpenBody: () => void }) {
  const s = useStore()
  const { advice } = useRecovery()
  const [building, setBuilding] = useState(false)
  const [rmOpen, setRmOpen] = useState(false)
  const [preview, setPreview] = useState<Template | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const beginner = s.workouts.length === 0
  const starter = s.templates.find((t) => t.id === 'tpl-machine-a') ?? s.templates[0]
  const today = todayKey()
  const muscleFor = (id: string): Muscle => findExercise(s, id).muscle

  const week = useMemo(() => {
    const start = startOfWeek(new Date())
    return Array.from({ length: 7 }, (_, i) => {
      const date = toKey(addDays(start, i))
      return { date, count: s.workouts.filter((w) => w.date === date).length, jp: WEEK_JP[i], d: addDays(start, i).getDate() }
    })
  }, [s.workouts])

  const vol = useMemo(() => {
    const sunday = startOfWeek(new Date())
    const inRange = (from: string, to: string) => s.workouts.filter((w) => w.date >= from && w.date < to)
    const sum = (ws: typeof s.workouts) => ws.reduce((n, w) => n + workoutVolume(w), 0)
    const weeks = Array.from({ length: 6 }, (_, i) => sum(inRange(toKey(addDays(sunday, -7 * i)), toKey(addDays(sunday, -7 * i + 7)))))
    const tomorrow = toKey(addDays(new Date(), 1))
    const d7 = sum(inRange(toKey(addDays(new Date(), -6)), tomorrow))
    const d28 = sum(inRange(toKey(addDays(new Date(), -27)), tomorrow))
    const month = todayKey().slice(0, 7)
    const monthDays = new Set(s.workouts.filter((w) => w.date.startsWith(month)).map((w) => w.date)).size
    return { weeks, d7, d28, total: sum(s.workouts), monthDays, totalDays: new Set(s.workouts.map((w) => w.date)).size }
  }, [s.workouts])

  const weekWorkouts = s.workouts.filter((w) => week.some((d) => d.date === w.date))
  const todays = s.workouts.filter((w) => w.date === today)
  const needBackup = s.workouts.length >= 5 && (!s.lastExportAt || Date.now() - s.lastExportAt > 30 * 86400000)

  return (
    <div className="page">
      <header className="brand">
        <div>
          <h1>KINETIC</h1>
          <p>{fmtLong(today)}</p>
        </div>
        <div className="brand-status" aria-hidden="true">
          <i aria-hidden="true" /> SYSTEM READY
        </div>
      </header>

      {isIos && !isStandalone && (
        <div className="notice">
          <b>ホーム画面に追加してご利用ください</b>
          <p>共有ボタンから「ホーム画面に追加」で使うと、アプリとして動作しデータも消えにくくなります。Safariで記録した内容はホーム画面のアプリに引き継がれません。</p>
        </div>
      )}
      {needBackup && (
        <button className="notice action" onClick={() => void exportJson()}>
          <b>バックアップを書き出しましょう</b>
          <p>最後の書き出しから30日以上たっています。タップで保存します。</p>
        </button>
      )}

      {beginner && (
        <Panel label="START GUIDE" className="starter">
          <b className="starter-title">はじめての方へ</b>
          <ol className="guide-steps">
            <li>下の「MENU」からメニューを選ぶ（迷ったら「マシン全身 A」）</li>
            <li>各種目の写真をタップして、動きとやり方を確認する</li>
            <li>重さと回数を入れて ✓ を押す。休憩タイマーが自動で始まります</li>
          </ol>
          {starter && (
            <button className="btn wide" onClick={() => setPreview(starter)}>
              おすすめ「{starter.name}」を見る
            </button>
          )}
        </Panel>
      )}

      <Panel label="TODAY" className="hero">
        {todays.length > 0 ? (
          <button className="today-done" onClick={() => onShowDay(today)}>
            <span className="today-badges">
              {[...new Set(todays.flatMap((w) => musclesOf(w, muscleFor).map((m) => m.muscle)))].map((m) => (
                <MuscleBadge key={m} muscle={m} />
              ))}
            </span>
            <span className="today-text">
              本日 {todays.reduce((n, w) => n + workoutSetCount(w), 0)}セット完了 / {fmtVolume(todays.reduce((n, w) => n + workoutVolume(w), 0))}kg
            </span>
            <IconNext size={18} />
          </button>
        ) : (
          <p className="today-empty">今日のトレーニングはまだありません</p>
        )}
        <button className="btn primary wide big" onClick={() => onStart({ title: 'フリートレーニング', items: [] })}>
          トレーニングを開始
        </button>
        <div className="btn-pair">
          <button className="btn" onClick={() => setGuideOpen(true)}>
            <IconInfo size={18} /> 種目ガイド
          </button>
          <button className="btn" onClick={() => setRmOpen(true)}>
            <IconBolt size={18} /> RM計算
          </button>
        </div>
      </Panel>

      <Panel
        label="MENU"
        right={
          <button className="link" onClick={() => setBuilding(true)}>
            <IconPlus size={14} /> 作成
          </button>
        }
      >
        <p className="hint">メニューを選ぶと、種目と動きを確認してから開始できます。</p>
        <ul className="tpl-list">
          {s.templates.map((t) => (
            <li key={t.id}>
              <button className="tpl-row" onClick={() => setPreview(t)}>
                <span className="tpl-name">{t.name}</span>
                <span className="tpl-meta">
                  {[...new Set(t.items.map((it) => findExercise(s, it.exerciseId).muscle))].map((m) => (
                    <MuscleBadge key={m} muscle={m} size="sm" />
                  ))}
                  <span>{t.items.length}種目</span>
                </span>
              </button>
              <button
                className="icon-btn"
                aria-label={`${t.name}を削除`}
                onClick={async () => {
                  if (await askConfirm({ title: `「${t.name}」を削除しますか？`, ok: '削除', danger: true })) deleteTemplate(t.id)
                }}
              >
                <IconClose size={16} />
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel label="TODAY'S PICK" right={<button className="link" onClick={onOpenBody}>ボディで見る <IconNext size={14} /></button>}>
        <div className="pick">
          <b>{advice.title}</b>
          <p>{advice.headline}</p>
          {advice.kind === 'train' && (
            <button className="btn wide" onClick={() => onStart({ title: advice.title.replace('今日は ', '').split('（')[0], items: advice.items })}>
              このメニューで開始
            </button>
          )}
        </div>
      </Panel>

      <Panel label="THIS WEEK">
        <div className="week-strip">
          {week.map((d) => (
            <button key={d.date} className={`week-day ${d.count ? 'lit' : ''} ${d.date === today ? 'today' : ''}`} onClick={() => onShowDay(d.date)} aria-label={`${d.d}日 ${d.count ? '実施' : '記録なし'}`}>
              <small>{d.jp}</small>
              <b>{d.d}</b>
            </button>
          ))}
        </div>
        <div className="stats">
          <Stat label="今週の回数" value={weekWorkouts.length} unit="回" />
          <Stat label="連続週" value={weekStreak(s.workouts)} unit="週" />
          <Stat label="今週の総量" value={fmtVolume(weekWorkouts.reduce((n, w) => n + workoutVolume(w), 0))} unit="kg" />
        </div>
      </Panel>

      <Panel label="VOLUME" right={<span className="hint-inline">総挙上量</span>}>
        <div className="vol-grid">
          <VolCard label="直近7日" t={vol.d7} unit="乗用車" per={1.5} icon="🚗" />
          <VolCard label="直近28日" t={vol.d28} unit="バス" per={10} icon="🚌" />
          <VolCard label="累計" t={vol.total} unit="ジェット機" per={180} icon="✈️" />
        </div>
        <WeekBars weeks={vol.weeks} />
        <div className="stats">
          <Stat label="今月のトレ日数" value={vol.monthDays} unit="日" />
          <Stat label="累計の日数" value={vol.totalDays} unit="日" />
        </div>
      </Panel>

      {rmOpen && <RmSheet onClose={() => setRmOpen(false)} />}
      {guideOpen && <ExercisePicker onClose={() => setGuideOpen(false)} />}
      {preview && (
        <TemplatePreview
          template={preview}
          onClose={() => setPreview(null)}
          onStart={() => {
            onStart({ title: preview.name, items: preview.items })
            setPreview(null)
          }}
        />
      )}
      {building && <TemplateBuilder onClose={() => setBuilding(false)} />}
    </div>
  )
}
