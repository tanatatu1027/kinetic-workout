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

/**
 * 短い3連ビープのWAVをその場で生成する（16bit/mono）。
 * iPhoneのマナーモードでは Web Audio は無音になりやすいが、<audio> 要素は鳴りやすいため、こちらを主に使う。
 */
export function makeBeepWav(rate = 22050): string {
  const tones = [
    { at: 0, f: 880 },
    { at: 0.2, f: 880 },
    { at: 0.4, f: 1320 },
  ]
  const len = Math.floor(rate * 0.62)
  const pcm = new Int16Array(len)
  for (const t of tones) {
    const start = Math.floor(rate * t.at)
    const n = Math.floor(rate * 0.16)
    for (let i = 0; i < n && start + i < len; i++) {
      const env = Math.min(1, i / (rate * 0.01), (n - i) / (rate * 0.03)) // 立ち上がり/減衰でクリック音を避ける
      const square = Math.sin((2 * Math.PI * t.f * i) / rate) >= 0 ? 1 : -1
      pcm[start + i] = Math.round(square * env * 0.35 * 32767)
    }
  }
  const bytes = new Uint8Array(44 + pcm.length * 2)
  const dv = new DataView(bytes.buffer)
  const str = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  dv.setUint32(4, 36 + pcm.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, rate, true)
  dv.setUint32(28, rate * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  str(36, 'data')
  dv.setUint32(40, pcm.length * 2, true)
  pcm.forEach((v, i) => dv.setInt16(44 + i * 2, v, true))
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return 'data:audio/wav;base64,' + btoa(bin)
}

let el: HTMLAudioElement | null = null
let elUnlocked = false

function audioEl(): HTMLAudioElement | null {
  try {
    if (!el) {
      el = new Audio(makeBeepWav())
      el.preload = 'auto'
    }
    return el
  } catch {
    return null
  }
}

/** iOSはユーザー操作中に音声を一度再生しておかないと、後から鳴らせない。音の出ない形でアンロックする */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    /* 音は補助機能なので失敗しても続行 */
  }
  if (elUnlocked) return
  const a = audioEl()
  if (!a) return
  try {
    a.muted = true
    const p = a.play()
    const done = () => {
      a.pause()
      a.currentTime = 0
      a.muted = false
    }
    if (p) {
      void p.then(() => {
        elUnlocked = true
        done()
      }).catch(() => {
        a.muted = false
      })
    }
  } catch {
    a.muted = false
  }
}

function webAudioBeep() {
  const ac = ctx
  if (!ac || ac.state !== 'running') return
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

export function beep() {
  navigator.vibrate?.([120, 60, 120])
  const a = audioEl()
  if (a) {
    try {
      a.muted = false
      a.currentTime = 0
      const p = a.play()
      // HTMLAudioが拒否された場合だけ Web Audio にフォールバック（両方鳴らして二重にならないように）
      if (p) void p.catch(webAudioBeep)
      return
    } catch {
      /* 下のフォールバックへ */
    }
  }
  webAudioBeep()
}
