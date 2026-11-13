import { Component, type ReactNode } from 'react'
import { exportJson } from '../lib/backup'
import { discardActive, flushSave } from '../lib/store'

/** 描画中の想定外エラーで白画面にならないよう、バックアップ書き出しと再読み込みの導線を出す */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  /** 進行中の記録が原因で毎回落ちる場合の脱出口。確認ダイアログも描画できない可能性があるため、標準の confirm を使う */
  discardAndReload = () => {
    const ok = window.confirm(
      '進行中のワークアウトの記録を破棄して再読み込みします。完了済みの過去の記録は残ります。\n\n先に「バックアップを書き出す」を押しましたか？ 破棄してよければ OK を押してください。',
    )
    if (!ok) return
    try {
      discardActive()
      flushSave()
    } catch {
      // 失敗しても再読み込みへ進む
    }
    location.reload()
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page" role="alert">
        <header className="page-head"><h1>エラーが発生しました</h1></header>
        <p className="hint">記録は端末内に残っています。念のためバックアップを書き出してから、再読み込みしてください。</p>
        <div className="stack">
          <button className="btn wide" onClick={() => void exportJson()}>バックアップを書き出す</button>
          <button className="btn primary wide" onClick={() => location.reload()}>再読み込み</button>
          <button className="btn wide danger-text" onClick={this.discardAndReload}>進行中の記録を破棄して再読み込み</button>
        </div>
      </div>
    )
  }
}
