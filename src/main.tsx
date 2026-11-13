import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/orbitron/600.css'
import '@fontsource/orbitron/800.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import './styles.css'
import App from './App'
import { startAutoBackup } from './lib/cloud'
import { unlockAudio } from './lib/sound'

// iOSでは復帰後に音声が止まるため、タップのたびに音声を起こしておく（休憩終了音のため）
window.addEventListener('pointerdown', unlockAudio, { passive: true })

// ブラウザによるデータ削除を避けるよう、最初の操作時に永続化を要求する
window.addEventListener('pointerdown', () => void navigator.storage?.persist?.().catch(() => undefined), { once: true })

// クラウドへの自動バックアップ（Supabase未設定なら何もしない）
startAutoBackup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
