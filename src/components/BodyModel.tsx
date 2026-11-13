import { useEffect, useRef } from 'react'
import { REGIONS, type Region } from '../data/regions'
import frontUrl from '../assets/body-front.png'
import backUrl from '../assets/body-back.png'

export interface RegionLook {
  color: string
  /** 0〜1。明るさの強さ（回復途中の疲労が強いほど大きい） */
  strength: number
}

interface Props {
  look: Record<Region, RegionLook>
  selected: Region[]
  onToggle: (r: Region) => void
  /** angle: 0=正面 / Math.PI=背面。n が変わるたびにその向きへ回す */
  snap: { angle: number; n: number }
  onUnsupported?: () => void
  onAngle?: (deg: number) => void
  /** 他の画面に隠れているときは描画を止める */
  paused?: boolean
}

const ORDER: Region[] = REGIONS.map((r) => r.id)

/**
 * 筋肉図（正面・背面）を、ターンテーブルのように横幅を縮めながら入れ替えて360°回す。
 * テクスチャは R=線と筋肉の形、G=部位ID（ORDERの順+1）。scripts/make-body-textures.py で作成。
 */
interface View {
  w: number
  h: number
  lum: Uint8Array
  reg: Uint8Array
  /** 部位ごとの画素番号 */
  pix: number[][]
  off: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  img: ImageData
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('image'))
    i.src = src
  })

async function loadView(src: string): Promise<View> {
  const im = await loadImage(src)
  const w = im.naturalWidth
  const h = im.naturalHeight
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const ctx = off.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(im, 0, 0)
  const src4 = ctx.getImageData(0, 0, w, h).data
  const lum = new Uint8Array(w * h)
  const reg = new Uint8Array(w * h)
  const pix: number[][] = ORDER.map(() => [])
  for (let p = 0; p < w * h; p++) {
    lum[p] = src4[p * 4]
    const g = src4[p * 4 + 1]
    reg[p] = g
    if (g > 0 && g <= ORDER.length) pix[g - 1].push(p)
  }
  return { w, h, lum, reg, pix, off, ctx, img: ctx.createImageData(w, h) }
}

const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255]
}

export function BodyModel({ look, selected, onToggle, snap, onUnsupported, onAngle, paused }: Props) {
  const host = useRef<HTMLDivElement>(null)
  // 最新のpropsを描画ループから参照する
  const latest = useRef({ look, selected, onToggle, onAngle, paused })
  latest.current = { look, selected, onToggle, onAngle, paused }
  const snapRef = useRef(snap)
  const api = useRef<{ snapTo: (a: number) => void } | null>(null)

  useEffect(() => {
    snapRef.current = snap
    api.current?.snapTo(snap.angle)
  }, [snap])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      onUnsupported?.()
      return
    }
    canvas.className = 'body-canvas'
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', '人体の筋肉図。ドラッグで回転、部位をタップで選択')
    el.appendChild(canvas)

    let disposed = false
    let views: [View, View] | null = null // [正面, 背面]
    Promise.all([loadView(frontUrl), loadView(backUrl)])
      .then((v) => {
        if (!disposed) views = v
      })
      .catch(() => {
        if (!disposed) onUnsupported?.()
      })

    // 回転・操作
    let rotY = 0.5
    let vel = 0
    let target: number | null = null
    let spin = true
    let down: { x: number; y: number; t: number; lastX: number; moved: boolean; id: number } | null = null
    let lastMoveT = 0
    let cw = 0
    let ch = 0
    let dpr = 1

    // 図の配置（正面・背面で共通）
    const layout = () => {
      const v = views?.[0]
      if (!v) return null
      const s = Math.min(ch / v.h, cw / v.w)
      return { s, ox: cw / 2, oy: (ch - v.h * s) / 2, v }
    }
    const facing = () => Math.cos(rotY)

    const pick = (cx: number, cy: number) => {
      const L = layout()
      if (!L || !views) return
      const k = facing()
      if (Math.abs(k) < 0.3) return
      const view = k > 0 ? views[0] : views[1]
      const rect = canvas.getBoundingClientRect()
      const px = cx - rect.left
      const py = cy - rect.top
      const sx = L.s * Math.abs(k)
      const u = (px - L.ox) / sx + view.w / 2
      const v = (py - L.oy) / L.s
      // ぴったり当たらなくても、指の大きさ分（約24px）の範囲で最も近い部位を選ぶ
      const rx = 24 / sx
      const ry = 24 / L.s
      let best = -1
      let bestD = Infinity
      for (let y = Math.max(0, Math.floor(v - ry)); y <= Math.min(view.h - 1, Math.ceil(v + ry)); y += 2) {
        for (let x = Math.max(0, Math.floor(u - rx)); x <= Math.min(view.w - 1, Math.ceil(u + rx)); x += 2) {
          const g = view.reg[y * view.w + x]
          if (!g || g > ORDER.length) continue
          const d = Math.hypot((x - u) * sx, (y - v) * L.s)
          if (d < bestD && d <= 24) {
            bestD = d
            best = g - 1
          }
        }
      }
      if (best >= 0) latest.current.onToggle(ORDER[best])
    }

    const onDown = (e: PointerEvent) => {
      // 2本目の指や右クリックは無視する（誤って部位を選択しないように）
      if (!e.isPrimary || e.button > 0) return
      canvas.setPointerCapture(e.pointerId)
      down = { x: e.clientX, y: e.clientY, t: performance.now(), lastX: e.clientX, moved: false, id: e.pointerId }
      spin = false
      target = null
      vel = 0
    }
    const onMove = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return
      const dx = e.clientX - down.lastX
      if (Math.abs(e.clientX - down.x) > 6 || Math.abs(e.clientY - down.y) > 6) down.moved = true
      down.lastX = e.clientX
      if (down.moved) {
        rotY += dx * 0.012
        vel = dx * 0.012
        lastMoveT = performance.now()
      }
    }
    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return
      if (!down.moved && performance.now() - down.t < 600) pick(e.clientX, e.clientY)
      // 止めてから指を離した場合は、勝手に回り出さないよう慣性を捨てる
      if (performance.now() - lastMoveT > 80) vel = 0
      down = null
    }
    const onCancel = () => {
      down = null
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)

    api.current = {
      snapTo: (a) => {
        spin = false
        vel = 0
        // 現在の角度に最も近い等価な角度へ回す（遠回りしない）
        const turns = Math.round((rotY - a) / (Math.PI * 2))
        target = a + turns * Math.PI * 2
      },
    }

    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      cw = w
      ch = h
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    // 部位ごとの色を画素に塗る（色や選択が変わった部位だけ更新する）
    const paintKey: string[][] = [[], []]
    const paint = (vi: number, time: number) => {
      const view = views![vi]
      const { look: lk, selected: sel } = latest.current
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.006)
      const out = view.img.data
      let dirty = false
      ORDER.forEach((region, i) => {
        const l = lk[region]
        const isSel = sel.includes(region)
        const key = `${l.color}|${l.strength.toFixed(2)}|${isSel ? pulse.toFixed(2) : '-'}`
        if (paintKey[vi][i] === key) return
        paintKey[vi][i] = key
        dirty = true
        const [r, g, b] = hex(l.color)
        // 回復途中の疲労が強いほど少し明るく、選択中は白へ脈打つ
        const boost = 0.9 + 0.2 * l.strength
        const mix = isSel ? 0.25 + 0.3 * pulse : 0
        const R = Math.min(255, (r * boost) * (1 - mix) + 255 * mix)
        const G = Math.min(255, (g * boost) * (1 - mix) + 255 * mix)
        const B = Math.min(255, (b * boost) * (1 - mix) + 255 * mix)
        for (const p of view.pix[i]) {
          out[p * 4] = R
          out[p * 4 + 1] = G
          out[p * 4 + 2] = B
          out[p * 4 + 3] = view.lum[p]
        }
      })
      if (dirty) view.ctx.putImageData(view.img, 0, 0)
    }

    // 初回に、部位なしの画素（輪郭・内転筋など）を白で塗る
    const initBase = (vi: number) => {
      const view = views![vi]
      const out = view.img.data
      for (let p = 0; p < view.w * view.h; p++) {
        const g = view.reg[p]
        if (g === 0 || g > ORDER.length) {
          out[p * 4] = 255
          out[p * 4 + 1] = 255
          out[p * 4 + 2] = 255
          out[p * 4 + 3] = view.lum[p]
        }
      }
    }
    const ready = [false, false]

    let raf = 0
    let lastAngleReport = -1
    let prevTime = 0
    // 画面外・他の画面の下に隠れている間は描画を止めて電池を節約する
    let visible = true
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    })
    io.observe(el)
    const frame = (time: number) => {
      raf = requestAnimationFrame(frame)
      if (!visible || latest.current.paused) {
        prevTime = 0
        return
      }
      // 60fps換算の経過フレーム数。120Hz端末でも回転速度が変わらないようにする
      const f = prevTime ? Math.min(3, (time - prevTime) / 16.667) : 1
      prevTime = time
      if (spin) rotY += 0.004 * f
      if (target !== null) {
        rotY += (target - rotY) * (1 - Math.pow(1 - 0.16, f))
        if (Math.abs(target - rotY) < 0.002) {
          rotY = target
          target = null
        }
      } else if (!down) {
        rotY += vel * f
        vel *= Math.pow(0.94, f)
        if (Math.abs(vel) < 0.0004) vel = 0
      }

      const deg = Math.round((((rotY * 180) / Math.PI) % 360 + 360) % 360)
      if (deg !== lastAngleReport) {
        lastAngleReport = deg
        latest.current.onAngle?.(deg)
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const L = layout()
      if (!views || !L) return
      const k = facing()
      const vi = k >= 0 ? 0 : 1
      if (!ready[vi]) {
        initBase(vi)
        ready[vi] = true
      }
      paint(vi, time)
      const view = views[vi]
      // 横幅を cos で縮める。真横を向く瞬間に、うっすら線だけ残す
      const sx = Math.max(0.02, Math.abs(k))
      ctx.setTransform(dpr * L.s * sx, 0, 0, dpr * L.s, dpr * L.ox, dpr * L.oy)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(view.off, -view.w / 2, 0)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      api.current = null
      canvas.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="body-host" ref={host} />
}
