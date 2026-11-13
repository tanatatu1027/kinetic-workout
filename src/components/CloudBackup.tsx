import { useState } from 'react'
import { adoptCode, backupAnyway, backupNow, cloudConfigured, fetchBackups, formatCode, getCode, normalizeCode, useCloudStatus, validCode, type CloudSnapshot } from '../lib/cloud'
import { replaceAll, useStore } from '../lib/store'
import { askConfirm, toast } from '../lib/ui'
import { Panel } from './Common'

const fmt = (t: number) => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const fmtDay = (t: number) => new Date(t).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
const fmtTime = (t: number) => new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

export function CloudBackup() {
  const s = useStore()
  const st = useCloudStatus()
  const [show, setShow] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** 取得済みの保存日一覧と、その取得に使った合言葉 */
  const [found, setFound] = useState<{ code: string; items: CloudSnapshot[] } | null>(null)
  const code = getCode()

  if (!cloudConfigured) {
    return (
      <Panel label="CLOUD BACKUP">
        <p className="hint">クラウドバックアップは未設定です（Supabase の接続情報が必要です）。</p>
      </Panel>
    )
  }

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      toast('合言葉をコピーしました')
    } catch {
      toast('コピーできませんでした。表示して書き留めてください')
    }
  }

  const now = async () => {
    const ok = await backupNow(true)
    if (ok) toast('クラウドにバックアップしました')
    else if (s.workouts.length === 0 && s.bodyLogs.length === 0) toast('記録がないため保存しませんでした')
  }

  const saveAnyway = async () => {
    const ok = await backupAnyway()
    if (ok) toast('クラウドにバックアップしました')
  }

  const closeRestore = () => {
    setRestoring(false)
    setInput('')
    setFound(null)
  }

  const search = async () => {
    setBusy(true)
    const res = await fetchBackups(input)
    setBusy(false)
    if (!res.ok) return toast(res.reason)
    setFound({ code: input, items: res.items })
  }

  const restore = async (snap: CloudSnapshot, fromCode: string) => {
    const d = snap.data
    const switching = !!code && normalizeCode(code) !== normalizeCode(fromCode)
    const lines = [
      `現在の記録（${s.workouts.length}件）は、${fmt(snap.updatedAt)}時点のバックアップ（${d.workouts.length}件、体組成${d.bodyLogs.length}件）に置き換わります。直前のデータは端末内に1世代だけ退避します。`,
    ]
    if (snap.dropped > 0) lines.push(`読み込めない記録${snap.dropped}件は除外されます。`)
    if (switching) {
      lines.push(
        `復元後、この端末の合言葉は復元元（${formatCode(fromCode)}）に切り替わります。切り替え前の合言葉は ${code} です（控えておけば元の保存先にも戻せます）。` +
          '元の端末で同時に使うと互いに上書きします（機種変更向けです）。',
      )
    }
    const ok = await askConfirm({
      title: 'クラウドから復元しますか？',
      body: lines.join('\n'),
      ok: '置き換える',
      danger: true,
    })
    if (!ok) return
    if (replaceAll(d)) {
      adoptCode(fromCode, d.workouts.length + d.bodyLogs.length)
      closeRestore()
      toast('復元しました')
    } else {
      toast('保存できなかったため、元のデータに戻しました。容量を確認してください')
    }
  }

  return (
    <Panel label="CLOUD BACKUP">
      <dl className="kv">
        <dt>自動バックアップ</dt>
        <dd>{st.busy ? '送信中…' : st.lastAt ? `${fmt(st.lastAt)} に完了` : '未実施'}</dd>
        <dt>合言葉</dt>
        <dd className="num">{code ? (show ? code : '••••-••••-••••-••••-••••') : '未作成'}</dd>
      </dl>
      {st.error && <p className="hint">{st.error}</p>}
      {st.warn && (
        <>
          <p className="hint" role="alert">{st.warn}それでよければ「それでも保存」を押してください。</p>
          <button className="btn wide danger-text" disabled={st.busy} onClick={() => void saveAnyway()}>それでも保存</button>
        </>
      )}
      <p className="hint">記録を変更すると自動でクラウドに保存されます。機種変更や紛失のときは、この合言葉で復元できます。合言葉は他の人に教えず、ポップメモなど別の場所にも控えてください。</p>
      <div className="stack">
        <button className="btn wide" onClick={() => setShow((v) => !v)}>{show ? '合言葉を隠す' : '合言葉を表示'}</button>
        {show && <button className="btn wide" onClick={() => void copy()}>合言葉をコピー</button>}
        <button className="btn wide" disabled={st.busy} onClick={() => void now()}>今すぐバックアップ</button>
        {!restoring ? (
          <button className="btn wide" onClick={() => setRestoring(true)}>合言葉で復元する</button>
        ) : (
          <>
            <input
              className="text num"
              value={input}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={24}
              onChange={(e) => {
                setInput(formatCode(e.target.value))
                setFound(null)
              }}
            />
            <button className="btn primary wide" disabled={busy || !validCode(input)} onClick={() => void search()}>
              {busy ? '確認中…' : 'この合言葉の保存日を探す'}
            </button>
            {found && (
              <>
                <p className="hint">復元する保存日を選んでください（最大7日分）。</p>
                <ul className="my-ex">
                  {found.items.map((it) => (
                    <li key={it.day + it.updatedAt}>
                      <button onClick={() => void restore(it, found.code)}>
                        <span>{fmtDay(it.updatedAt)} {fmtTime(it.updatedAt)}</span>
                        <small>記録{it.data.workouts.length}件・体組成{it.data.bodyLogs.length}件</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button className="btn wide" onClick={closeRestore}>キャンセル</button>
          </>
        )}
      </div>
    </Panel>
  )
}
