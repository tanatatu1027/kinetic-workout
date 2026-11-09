let ctx: AudioContext | null = null

// iOSのPWAは復帰後にAudioContextが止まることがあるため、復帰時はまず resume を試し、駄目なら作り直す
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !ctx) return
  const old = ctx
  void old.resume().catch(() => {
    void old.close().catch(() => undefined)
    if (ctx === old) ctx = null
  })
})

/** iOSはユーザー操作中にAudioContextを起こす必要がある */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    /* 音は補助機能なので失敗しても続行 */
  }
}

export function beep() {
  navigator.vibrate?.([120, 60, 120])
  const ac = ctx
  if (!ac) return
  const now = ac.currentTime
  ;[0, 0.18, 0.36].forEach((t, i) => {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'square'
    osc.frequency.value = i === 2 ? 1320 : 880
    gain.gain.setValueAtTime(0.0001, now + t)
    gain.gain.exponentialRampToValueAtTime(0.25, now + t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.15)
    osc.connect(gain).connect(ac.destination)
    osc.start(now + t)
    osc.stop(now + t + 0.16)
  })
}
