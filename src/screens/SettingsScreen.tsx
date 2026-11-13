import { useEffect, useRef, useState } from 'react'
import { CloudBackup } from '../components/CloudBackup'
import { Panel, Sheet } from '../components/Common'
import { EQUIPMENT_LABEL, MUSCLES } from '../data/exercises'
import { exportCsv, exportJson, readBackup } from '../lib/backup'
import { activeCustomExercises, corruptKeys, deleteCustomExercise, readCorrupt, replaceAll, resetAll, setExerciseRest, setWeeklyGoal, updateCustomExercise, updateSettings, useStore } from '../lib/store'
import type { Equipment, Muscle } from '../types'
import { askConfirm, toast } from '../lib/ui'
import { findExercise } from '../lib/store'
import '../workout-extra.css'

const REST = [30, 45, 60, 90, 120, 180]
const fmtRest = (r: number) => (r < 60 ? `${r}秒` : r % 60 === 0 ? `${r / 60}分` : `${Math.floor(r / 60)}分${r % 60}秒`)
const STEPS = [1, 1.25, 2.5, 5]

export function SettingsScreen() {
  const s = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [corrupt, setCorrupt] = useState<string[]>(() => corruptKeys())
  const goal = s.settings.weeklyGoal
  const restList = Object.entries(s.settings.restByExercise ?? {})
  const customList = activeCustomExercises(s)
  const editing = customList.find((e) => e.id === editId)
  const [name, setName] = useState('')
  const [muscle, setMuscle] = useState<Muscle>('chest')
  const [eq, setEq] = useState<Equipment>('machine')

  const openEdit = (id: string) => {
    const e = customList.find((v) => v.id === id)
    if (!e) return
    setName(e.name)
    setMuscle(e.muscle)
    setEq(e.equipment)
    setEditId(id)
  }

  const saveEdit = () => {
    if (!editId || !name.trim()) return
    updateCustomExercise(editId, { name: name.trim(), muscle, equipment: eq })
    setEditId(null)
  }

  const removeCustom = async () => {
    if (!editing) return
    const used = s.workouts.some((w) => w.exercises.some((x) => x.exerciseId === editing.id))
    const ok = await askConfirm({
      title: `「${editing.name}」を削除しますか？`,
      body: used ? '過去の記録には「削除された種目」として残ります。' : undefined,
      ok: '削除',
      danger: true,
    })
    if (!ok) return
    deleteCustomExercise(editing.id)
    setEditId(null)
  }

  const exportCorrupt = () => {
    const key = corrupt[corrupt.length - 1]
    const text = key ? readCorrupt(key) : null
    if (!text) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    a.download = 'kinetic-recovered.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    setCorrupt(corruptKeys())
  }

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])

  const importFile = async (file: File | undefined) => {
    if (!file) return
    const res = await readBackup(file)
    if (fileRef.current) fileRef.current.value = ''
    if (!res.ok) return toast(res.reason)
    const data = res.data
    const dates = data.workouts.map((w) => w.date).sort()
    const range = dates.length ? `（${dates[0]} 〜 ${dates[dates.length - 1]}）` : ''
    const ok = await askConfirm({
      title: 'バックアップを読み込みますか？',
      body: `現在の記録（${s.workouts.length}件）は、ファイルの内容（${data.workouts.length}件${range}、体組成${data.bodyLogs.length}件）に置き換わります。直前のデータは端末内に1世代だけ退避します。`,
      ok: '置き換える',
      danger: true,
    })
    if (ok) {
      if (replaceAll(data)) toast(res.dropped > 0 ? `読み込みました（不正なデータ${res.dropped}件を除外。元の内容は端末内に退避済み）` : '読み込みました')
      else toast('保存できなかったため、元のデータに戻しました。容量を確認してください')
    }
  }

  const reset = async () => {
    const first = await askConfirm({ title: 'すべてのデータを消去しますか？', body: `記録${s.workouts.length}件が削除されます。元に戻せません。`, ok: '消去へ進む', danger: true })
    if (!first) return
    const second = await askConfirm({ title: '本当に消去しますか？', body: 'バックアップがない場合、復元できません。', ok: '完全に消去', danger: true })
    if (second) {
      resetAll()
      toast('消去しました')
    }
  }

  return (
    <div className="page">
      <header className="page-head"><h1>SETTINGS</h1></header>

      <Panel label="TRAINING">
        <div className="field">
          <span>休憩タイマーの初期時間</span>
          <div className="chips">
            {REST.map((r) => (
              <button key={r} className={`chip num ${s.settings.restSeconds === r ? 'on' : ''}`} onClick={() => updateSettings({ restSeconds: r })}>
                {fmtRest(r)}
              </button>
            ))}
          </div>
        </div>
        <button className="toggle-row" role="switch" aria-checked={s.settings.autoRest} onClick={() => updateSettings({ autoRest: !s.settings.autoRest })}>
          <span>
            休憩を自動で開始
            <small>セットを完了すると休憩タイマーが始まります</small>
          </span>
          <i className={`toggle ${s.settings.autoRest ? 'on' : ''}`} aria-hidden="true" />
        </button>
        <div className="field">
          <span>重量の増減幅</span>
          <div className="chips">
            {STEPS.map((v) => (
              <button key={v} className={`chip num ${s.settings.weightStep === v ? 'on' : ''}`} onClick={() => updateSettings({ weightStep: v })}>
                {v}kg
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel label="GOAL / REST">
        <div className="field">
          <span>週の目標回数</span>
          <div className="goal-row">
            <button className="goal-mini" aria-label="目標を1回減らす" disabled={goal === undefined} onClick={() => setWeeklyGoal(goal! - 1)}>−</button>
            <b className="goal-text num">{goal === undefined ? '未設定' : `週${goal}回`}</b>
            <button className="goal-mini" aria-label="目標を1回増やす" disabled={goal !== undefined && goal >= 14} onClick={() => setWeeklyGoal((goal ?? 2) + 1)}>＋</button>
            {goal !== undefined && <button className="btn" onClick={() => setWeeklyGoal(0)}>解除</button>}
          </div>
        </div>
        <div className="field">
          <span>種目ごとの休憩時間（共通は {fmtRest(s.settings.restSeconds)}）</span>
          {restList.length === 0 ? (
            <p className="hint">個別に変えた種目はありません。ワークアウト中の種目カード「休憩」ボタンで種目ごとに変えられます。</p>
          ) : (
            <ul className="rest-overrides">
              {restList.map(([id, sec]) => (
                <li key={id}>
                  <span>{findExercise(s, id).name}</span>
                  <b className="num">{fmtRest(sec)}</b>
                  <button className="btn" onClick={() => setExerciseRest(id, null)}>戻す</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="hint">バー重量とプレート構成は、ワークアウト画面の「RM・プレート計算」で設定します（プレート構成は端末に保存、バー重量は開くたびに20kgから始まります）。</p>
      </Panel>

      <Panel label="DISPLAY">
        <button className="toggle-row" role="switch" aria-checked={s.settings.highContrast} onClick={() => updateSettings({ highContrast: !s.settings.highContrast })}>
          <span>
            高コントラスト
            <small>発光を消して文字を最大輝度に。明るいジム向け</small>
          </span>
          <i className={`toggle ${s.settings.highContrast ? 'on' : ''}`} aria-hidden="true" />
        </button>
      </Panel>

      {customList.length > 0 && (
        <Panel label="MY EXERCISES">
          <ul className="my-ex">
            {customList.map((e) => (
              <li key={e.id}>
                <button onClick={() => openEdit(e.id)}>
                  <span>{e.name}</span>
                  <small>{MUSCLES.find((m) => m.id === e.muscle)?.label}・{EQUIPMENT_LABEL[e.equipment]}</small>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel label="DATA">
        <dl className="kv">
          <dt>記録件数</dt>
          <dd className="num">{s.workouts.length}</dd>
          <dt>最終バックアップ</dt>
          <dd>{s.lastExportAt ? new Date(s.lastExportAt).toLocaleDateString('ja-JP') : '未実施'}</dd>
          <dt>データ保護</dt>
          <dd>
            {persisted === null ? '確認できません' : persisted ? '有効' : '未許可'}
            {persisted === false && (
              <button className="link" onClick={() => navigator.storage?.persist?.().then((ok) => (setPersisted(ok), ok || toast('許可されませんでした。バックアップを定期的に書き出してください'))).catch(() => undefined)}>
                要求する
              </button>
            )}
          </dd>
        </dl>
        <p className="hint">記録はまずこのiPhone内に保存され、下のクラウドバックアップを使うと変更のたびに自動でクラウドにも控えが保存されます。アプリの削除や機種変更に備えて、JSONの書き出しも定期的に行ってください。</p>
        <div className="stack">
          <button className="btn wide" onClick={() => void exportJson()}>バックアップを書き出す（JSON）</button>
          <button className="btn wide" onClick={() => fileRef.current?.click()}>バックアップを読み込む</button>
          <button className="btn wide" onClick={() => void exportCsv()}>CSVで書き出す</button>
          {corrupt.length > 0 && (
            <button className="btn wide" onClick={exportCorrupt}>読み込めなかったデータを書き出す</button>
          )}
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
        </div>
      </Panel>

      <CloudBackup />

      <Panel label="DANGER ZONE">
        <button className="btn wide danger-text" onClick={reset}>すべてのデータを消去</button>
      </Panel>

      {editing && (
        <Sheet
          title="自作種目を編集"
          onClose={() => setEditId(null)}
          footer={
            <>
              <button className="btn danger-text" onClick={() => void removeCustom()}>削除</button>
              <button className="btn primary" disabled={!name.trim()} onClick={saveEdit}>保存</button>
            </>
          }
        >
          <label className="field">
            <span>種目名</span>
            <input className="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="field">
            <span>部位</span>
            <div className="chips">
              {MUSCLES.map((m) => (
                <button key={m.id} className={`chip ${muscle === m.id ? 'on' : ''}`} onClick={() => setMuscle(m.id)}>{m.label}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>器具</span>
            <div className="chips">
              {(Object.keys(EQUIPMENT_LABEL) as Equipment[]).map((k) => (
                <button key={k} className={`chip ${eq === k ? 'on' : ''}`} onClick={() => setEq(k)}>{EQUIPMENT_LABEL[k]}</button>
              ))}
            </div>
          </div>
        </Sheet>
      )}

      <p className="footer-note num">KINETIC v1.0</p>
    </div>
  )
}
