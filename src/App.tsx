import { lazy, Suspense, useEffect, useState } from 'react'
import { UiHost, useNow } from './components/Common'
import { ErrorBoundary } from './components/ErrorBoundary'
import { IconBody, IconCalendar, IconChart, IconGear, IconHome, IconNext } from './components/Icons'
import { fmtDuration, todayKey } from './lib/date'
import { beep } from './lib/sound'
import { clearRest, editWorkout, getState, startWorkout, useStore } from './lib/store'
import { askConfirm, toast } from './lib/ui'
import { AnalyticsScreen } from './screens/AnalyticsScreen'
import { CalendarScreen } from './screens/CalendarScreen'
import { HomeScreen } from './screens/HomeScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SummaryScreen } from './screens/SummaryScreen'
import { WorkoutScreen } from './screens/WorkoutScreen'
import type { TemplateItem, Workout } from './types'

// ボディ画面は three.js を含み重いので、開いたときに読み込む
const BodyScreen = lazy(() => import('./screens/BodyScreen').then((m) => ({ default: m.BodyScreen })))

type Tab = 'home' | 'body' | 'calendar' | 'analytics' | 'settings'

const TABS: { id: Tab; label: string; icon: typeof IconHome }[] = [
  { id: 'home', label: 'ホーム', icon: IconHome },
  { id: 'body', label: 'ボディ', icon: IconBody },
  { id: 'calendar', label: 'カレンダー', icon: IconCalendar },
  { id: 'analytics', label: '分析', icon: IconChart },
  { id: 'settings', label: '設定', icon: IconGear },
]

export interface StartOptions {
  title: string
  items: TemplateItem[]
  date?: string
}

function ResumeBar({ startedAt, title, live, onOpen }: { startedAt: number; title: string; live: boolean; onOpen: () => void }) {
  const now = useNow(1000)
  const rest = useStore().rest
  return (
    <button className="resume-bar" onClick={onOpen}>
      <span className="pulse" aria-hidden="true" />
      <span className="resume-title">{title}</span>
      {rest && rest.endsAt > now ? (
        <span className="num resume-rest">REST {fmtDuration(rest.endsAt - now + 999)}</span>
      ) : (
        live && <span className="num">{fmtDuration(now - startedAt)}</span>
      )}
      <span className="resume-go">
        再開 <IconNext size={16} />
      </span>
    </button>
  )
}

export default function App() {
  const s = useStore()
  const [tab, setTab] = useState<Tab>('home')
  const [workoutOpen, setWorkoutOpen] = useState(() => getState().active !== null)
  const [summary, setSummary] = useState<Workout | null>(null)
  const [calendarDate, setCalendarDate] = useState(todayKey())
  const [flash, setFlash] = useState(0)
  // 日付をまたいだら再描画して「今日」を更新する。画面は作り直さない（入力中の内容を守るため）。
  // 日付の更新が必要な画面は、描画のたびに todayKey() を読む（またはBodyCompのように自分で追従する）
  useNow(60_000)

  useEffect(() => {
    document.documentElement.classList.toggle('hc', s.settings.highContrast)
  }, [s.settings.highContrast])

  // 休憩終了の監視。どのタブにいても画面全体のフラッシュで知らせる
  const restEndsAt = s.rest?.endsAt ?? null
  useEffect(() => {
    if (restEndsAt === null) return
    const check = () => {
      const late = Date.now() - restEndsAt
      if (late < 0) return
      clearRest()
      if (late < 3000) {
        beep()
        setFlash((n) => n + 1)
      } else {
        toast('休憩時間が終了しています')
      }
    }
    check()
    const id = window.setInterval(check, 250)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', check)
    }
  }, [restEndsAt])

  const canStart = async () => {
    if (!getState().active) return true
    const resume = await askConfirm({ title: '進行中の記録があります', body: '先に進行中の記録を完了または破棄してください。', ok: '進行中の記録を開く' })
    if (resume) setWorkoutOpen(true)
    return false
  }

  const begin = async (opts: StartOptions) => {
    if (!(await canStart())) return
    startWorkout(opts)
    setWorkoutOpen(true)
  }

  const edit = async (id: string) => {
    if (!(await canStart())) return
    editWorkout(id)
    setWorkoutOpen(true)
  }

  const showCalendar = (date: string) => {
    setCalendarDate(date)
    setTab('calendar')
  }

  return (
    <ErrorBoundary>
    <div className="app">
      <main className="screen" key={tab}>
        {tab === 'home' && <HomeScreen onStart={begin} onShowDay={showCalendar} onOpenBody={() => setTab('body')} />}
        {tab === 'body' && (
          <Suspense fallback={<div className="page"><header className="page-head"><h1>BODY</h1></header><div className="panel body-skeleton tall" role="status"><span>読み込み中…</span></div></div>}>
            <BodyScreen onStart={begin} paused={workoutOpen} />
          </Suspense>
        )}
        {tab === 'calendar' && <CalendarScreen selected={calendarDate} onSelect={setCalendarDate} onStart={begin} onEdit={edit} />}
        {tab === 'analytics' && <AnalyticsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      {s.active && !workoutOpen && (
        <ResumeBar startedAt={s.active.startedAt} title={s.active.title} live={s.active.mode === 'live'} onOpen={() => setWorkoutOpen(true)} />
      )}

      <nav className="nav" aria-label="メイン">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <t.icon size={24} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {s.active && workoutOpen && (
        <WorkoutScreen
          onMinimize={() => setWorkoutOpen(false)}
          onClosed={(saved) => {
            setWorkoutOpen(false)
            if (saved) setSummary(saved)
          }}
        />
      )}

      {summary && (
        <SummaryScreen
          workout={summary}
          onClose={() => setSummary(null)}
          onShowDay={() => {
            showCalendar(summary.date)
            setSummary(null)
          }}
        />
      )}

      {flash > 0 && (
        <div className="rest-flash" key={flash} onAnimationEnd={() => setFlash(0)} aria-live="assertive">
          <b>REST COMPLETE</b>
          <span>休憩終了 次のセットへ</span>
        </div>
      )}
      <UiHost />
    </div>
    </ErrorBoundary>
  )
}
