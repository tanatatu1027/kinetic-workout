import { Component, type ReactNode } from 'react'
import { exportJson } from '../lib/backup'

/** 描画中の想定外エラーで白画面にならないよう、バックアップ書き出しと再読み込みの導線を出す */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page" role="alert">
        <h1>エラーが発生しました</h1>
        <p className="hint">記録は端末内に残っています。念のためバックアップを書き出してから、再読み込みしてください。</p>
        <div className="stack">
          <button className="btn wide" onClick={() => void exportJson()}>バックアップを書き出す</button>
          <button className="btn primary wide" onClick={() => location.reload()}>再読み込み</button>
        </div>
      </div>
    )
  }
}
