import { useState } from 'react'
import { adoptCode, backupNow, cloudConfigured, fetchBackups, formatCode, getCode, useCloudStatus, validCode } from '../lib/cloud'
import { replaceAll, useStore } from '../lib/store'
import { askConfirm, toast } from '../lib/ui'
import { Panel } from './Common'

const fmt = (t: number) => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function CloudBackup() {
  const s = useStore()
  const st = useCloudStatus()
  const [show, setShow] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
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

  const restore = async () => {
    setBusy(true)
    const res = await fetchBackups(input)
    setBusy(false)
    if (!res.ok) return toast(res.reason)
    const latest = res.items[0]
    const d = latest.data
    const ok = await askConfirm({
      title: 'クラウドから復元しますか？',
      body: `現在の記録（${s.workouts.length}件）は、${fmt(latest.updatedAt)}時点のバックアップ（${d.workouts.length}件、体組成${d.bodyLogs.length}件）に置き換わります。直前のデータは端末内に1世代だけ退避します。`,
      ok: '置き換える',
      danger: true,
    })
    if (!ok) return
    if (replaceAll(d)) {
      adoptCode(input)
      setRestoring(false)
      setInput('')
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
              onChange={(e) => setInput(formatCode(e.target.value))}
            />
            <button className="btn primary wide" disabled={busy || !validCode(input)} onClick={() => void restore()}>
              {busy ? '確認中…' : 'この合言葉で復元'}
            </button>
            <button className="btn wide" onClick={() => (setRestoring(false), setInput(''))}>キャンセル</button>
          </>
        )}
      </div>
    </Panel>
  )
}
