import { useEffect, useRef } from 'react'
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PerspectiveCamera,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { REGIONS, type Region } from '../data/regions'
import meta from '../assets/body-meta.json'
import frontUrl from '../assets/body-front.png'
import backUrl from '../assets/body-back.png'
import depthUrl from '../assets/body-depth.png'

export interface RegionLook {
  color: string
  /** 0〜1。発光の強さ（回復途中の疲労が強いほど大きい） */
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
const NR = ORDER.length

/**
 * 筋肉図のシルエットを膨らませて作った3Dの体。
 * 正面側・背面側の厚みは body-depth.png（R=正面, G=背面, B=シルエット）。
 * 筋肉の模様は body-front.png / body-back.png（R=形, G=部位ID）を貼る。頭は別の楕円体。
 * 画像は scripts/make-body-textures.py で作る。
 */
const WORLD_H = 2.08 // 体の高さ（頭のてっぺん〜足元）
const FOOT_Y = -1.08
const SC = WORLD_H / (meta.bodyBottom - meta.headTop) // グリッド1マスのワールド長
const SKIN = new Color('#161f2a')

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('image'))
    i.src = src
  })

const pixels = (img: HTMLImageElement) => {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.drawImage(img, 0, 0)
  return x.getImageData(0, 0, c.width, c.height)
}

interface BodyData {
  geo: BufferGeometry
  nFront: number
  frontImg: HTMLImageElement
  backImg: HTMLImageElement
  ids: [Uint8Array, Uint8Array]
  texW: number
  texH: number
}

/** 厚みの画像から、正面・背面の2枚の面でできた体のメッシュを作る */
async function loadBody(): Promise<BodyData> {
  const [dImg, frontImg, backImg] = await Promise.all([loadImage(depthUrl), loadImage(frontUrl), loadImage(backUrl)])
  const d = pixels(dImg).data
  const W = dImg.naturalWidth
  const H = dImg.naturalHeight
  const at = (i: number, j: number) => (j * W + i) * 4
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && d[at(i, j) + 2] > 127

  const idx = new Int32Array(W * H).fill(-1)
  const pos: number[] = []
  const uv: number[] = []
  const side: number[] = []
  const emit = (s: 0 | 1) => {
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (!inside(i, j)) continue
        const t = (d[at(i, j) + s] / 255) * meta.depthMax * SC
        const k = pos.length / 3
        if (s === 0) idx[j * W + i] = k
        pos.push((i - W / 2) * SC, FOOT_Y + (meta.bodyBottom - j) * SC, s === 0 ? t : -t)
        uv.push(i / (W - 1), 1 - j / (H - 1))
        side.push(s)
      }
    }
  }
  emit(0)
  const nFront = pos.length / 3
  emit(1)
  // 背面の頂点番号は、正面と同じ並びで nFront を足したもの
  const index: number[] = []
  const vi = (i: number, j: number) => idx[j * W + i]
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      if (!(inside(i, j) && inside(i + 1, j) && inside(i, j + 1) && inside(i + 1, j + 1))) continue
      const a = vi(i, j)
      const b = vi(i + 1, j)
      const c = vi(i, j + 1)
      const e = vi(i + 1, j + 1)
      // 正面：上から見て反時計回り
      index.push(a, c, b, b, c, e)
      // 背面：逆向き
      index.push(a + nFront, b + nFront, c + nFront, b + nFront, e + nFront, c + nFront)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1))
  geo.setIndex(index)
  geo.computeVertexNormals()

  const ids = [frontImg, backImg].map((im) => {
    const px = pixels(im).data
    const out = new Uint8Array(px.length / 4)
    for (let p = 0; p < out.length; p++) out[p] = px[p * 4 + 1]
    return out
  }) as [Uint8Array, Uint8Array]
  return { geo, nFront, frontImg, backImg, ids, texW: frontImg.naturalWidth, texH: frontImg.naturalHeight }
}

/** 輪郭の白い縁取り（体のふち）を、面の向きから作る */
const RIM_GLSL = `
  float rimK = 1.0 - abs(dot(normal, normalize(vViewPosition)));
  totalEmissiveRadiance += vec3(0.95, 0.97, 1.0) * smoothstep(0.68, 0.86, rimK);
`

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

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      onUnsupported?.()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    const canvas = renderer.domElement
    canvas.className = 'body-canvas'
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', '人体モデル。ドラッグで回転、部位をタップで選択')
    el.appendChild(canvas)

    const scene = new Scene()
    const camera = new PerspectiveCamera(30, 1, 0.1, 50)
    camera.position.set(0, 0.02, 4.5)
    scene.add(new AmbientLight(0xffffff, 0.9))
    const key = new DirectionalLight(0xffffff, 1.6)
    key.position.set(2, 3, 4)
    scene.add(key)
    const back = new DirectionalLight(0xffffff, 1.0)
    back.position.set(-2, 2, -4)
    scene.add(back)
    const rim = new DirectionalLight(0x22d3ee, 0.8)
    rim.position.set(-3, 1, 0)
    scene.add(rim)

    let disposed = false
    const disposables: { dispose: () => void }[] = []
    const track = <T extends { dispose: () => void }>(o: T) => {
      disposables.push(o)
      return o
    }

    const body = new Group()
    scene.add(body)

    // 体表シェーダー：貼った模様の部位IDごとに、回復状況の色を塗る
    const uniforms = {
      tLumF: { value: null as Texture | null },
      tLumB: { value: null as Texture | null },
      tIdF: { value: null as Texture | null },
      tIdB: { value: null as Texture | null },
      uCol: { value: ORDER.map(() => new Color('#4a5d6e')) },
      uAmt: { value: ORDER.map(() => 0) },
      uSel: { value: ORDER.map(() => 0) },
      uSkin: { value: SKIN },
    }
    const bodyMat = track(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0 }))
    bodyMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', 'attribute float aSide;\nvarying float vSide;\nvarying vec2 vTuv;\nvarying float vFace;\n#include <common>')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSide = aSide; vTuv = uv; vFace = abs(normal.z);')
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying float vSide; varying vec2 vTuv; varying float vFace;
          uniform sampler2D tLumF; uniform sampler2D tLumB; uniform sampler2D tIdF; uniform sampler2D tIdB;
          uniform vec3 uCol[${NR}]; uniform float uAmt[${NR}]; uniform float uSel[${NR}];
          uniform vec3 uSkin;
          float gLum = 0.0; vec3 gEm = vec3(0.0);`,
        )
        .replace(
          '#include <color_fragment>',
          `float lumF = texture2D(tLumF, vTuv).r; float lumB = texture2D(tLumB, vTuv).r;
          float idF = texture2D(tIdF, vTuv).g; float idB = texture2D(tIdB, vTuv).g;
          float isB = step(0.5, vSide);
          float lum = mix(lumF, lumB, isB) * smoothstep(0.18, 0.5, vFace); // 真横の急な面は模様が伸びるので薄くする
          int rid = int(mix(idF, idB, isB) * 255.0 + 0.5);
          vec3 mcol = vec3(0.29, 0.36, 0.43); float amt = 0.0; float sel = 0.0;
          for (int k = 0; k < ${NR}; k++) {
            if (k + 1 == rid) { mcol = uCol[k]; amt = uAmt[k]; sel = uSel[k]; }
          }
          diffuseColor.rgb = mix(uSkin, mcol, lum);
          gEm = (mcol * (0.10 + 0.34 * amt) + vec3(1.0) * sel) * lum;`,
        )
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEm;\n${RIM_GLSL}`)
    }

    // 頭は別の楕円体（輪郭の縁取りだけ）
    const headMat = track(new MeshStandardMaterial({ color: SKIN, roughness: 0.5, metalness: 0.0 }))
    headMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${RIM_GLSL}`)
    }
    const headTop = FOOT_Y + (meta.bodyBottom - meta.headTop) * SC
    const headBottom = FOOT_Y + (meta.bodyBottom - meta.neckY) * SC
    const headR = (meta.headW / 2) * SC
    const headGeo = track(new SphereGeometry(1, 48, 36))
    // あご側を細くして、卵ではなく頭の形にする
    const hp = headGeo.attributes.position
    for (let i = 0; i < hp.count; i++) {
      const y = hp.getY(i)
      if (y < 0) {
        const f = 1 + 0.2 * y
        hp.setX(i, hp.getX(i) * f)
        hp.setZ(i, hp.getZ(i) * f)
      }
    }
    headGeo.computeVertexNormals()
    const head = new Mesh(headGeo, headMat)
    head.scale.set(headR, (headTop - headBottom) / 2, headR * 1.0)
    head.position.set((meta.headCx - meta.gridW / 2) * SC, (headTop + headBottom) / 2, headR * 0.1)
    body.add(head)

    let bodyMesh: Mesh | null = null
    let data: BodyData | null = null
    loadBody()
      .then((bd) => {
        if (disposed) {
          bd.geo.dispose()
          return
        }
        data = bd
        const mk = (img: HTMLImageElement, nearest: boolean) => {
          const t = track(new Texture(img))
          t.minFilter = nearest ? NearestFilter : LinearMipmapLinearFilter
          t.magFilter = nearest ? NearestFilter : LinearFilter
          t.generateMipmaps = !nearest
          t.anisotropy = 4
          t.needsUpdate = true
          return t
        }
        uniforms.tLumF.value = mk(bd.frontImg, false)
        uniforms.tLumB.value = mk(bd.backImg, false)
        uniforms.tIdF.value = mk(bd.frontImg, true)
        uniforms.tIdB.value = mk(bd.backImg, true)
        track(bd.geo)
        bodyMesh = new Mesh(bd.geo, bodyMat)
        body.add(bodyMesh)
      })
      .catch(() => {
        if (!disposed) onUnsupported?.()
      })

    // 足元のHUDリング
    const hud = new Group()
    hud.position.y = -1.1
    hud.rotation.x = -Math.PI / 2
    scene.add(hud)
    const ringMat = track(new MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55, side: DoubleSide }))
    const ring1 = track(new RingGeometry(0.52, 0.535, 72))
    const ring2 = track(new RingGeometry(0.66, 0.67, 72, 1, 0, Math.PI * 1.5))
    hud.add(new Mesh(ring1, ringMat), new Mesh(ring2, ringMat))
    const ticks = new Group()
    for (let i = 0; i < 24; i++) {
      const t = new Mesh(track(new BoxGeometry(0.008, i % 6 === 0 ? 0.07 : 0.035, 0.001)), ringMat)
      const a = (i / 24) * Math.PI * 2
      t.position.set(Math.cos(a) * 0.58, Math.sin(a) * 0.58, 0)
      t.rotation.z = a + Math.PI / 2
      ticks.add(t)
    }
    hud.add(ticks)

    // 回転・操作
    let rotY = 0.5
    let vel = 0
    let target: number | null = null
    let spin = true
    let down: { x: number; y: number; t: number; lastX: number; moved: boolean; id: number } | null = null
    let lastMoveT = 0
    const ray = new Raycaster()
    const pointer = new Vector2()
    const tmp = new Vector3()

    /** 画面上の1点から、当たった体表の部位を調べる（当たらなければ null） */
    const regionAt = (cx: number, cy: number, fuzzy: number): Region | null => {
      if (!bodyMesh || !data) return null
      const r = canvas.getBoundingClientRect()
      pointer.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(pointer, camera)
      const hit = ray.intersectObject(bodyMesh, false)[0]
      if (!hit || !hit.uv || !hit.face) return null
      const s = hit.face.a < data.nFront ? 0 : 1
      const { texW, texH } = data
      const ids = data.ids[s]
      const px = hit.uv.x * (texW - 1)
      const py = (1 - hit.uv.y) * (texH - 1)
      // 画面の30px相当を、画像のピクセルに換算して探す
      tmp.set(0, 0, 0).project(camera)
      const pxPerWorld = r.height / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z)
      const texPerPx = (4 / SC) / pxPerWorld
      const rad = Math.max(2, fuzzy * texPerPx)
      let best = 0
      let bestD = Infinity
      for (let dy = -rad; dy <= rad; dy += 3) {
        for (let dx = -rad; dx <= rad; dx += 3) {
          const x = Math.round(px + dx)
          const y = Math.round(py + dy)
          if (x < 0 || y < 0 || x >= texW || y >= texH) continue
          const g = ids[y * texW + x]
          if (!g || g > NR) continue
          const dd = Math.hypot(dx, dy)
          if (dd <= rad && dd < bestD) {
            bestD = dd
            best = g
          }
        }
      }
      return best ? ORDER[best - 1] : null
    }
    const pick = (cx: number, cy: number) => {
      let region = regionAt(cx, cy, 14)
      if (!region) {
        // 細い部位は指がずれやすいので、周りも少し探す
        for (let a = 0; a < 8 && !region; a++) {
          const ang = (a / 8) * Math.PI * 2
          region = regionAt(cx + Math.cos(ang) * 16, cy + Math.sin(ang) * 16, 6)
        }
      }
      if (region) latest.current.onToggle(region)
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
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      // 狭い幅でも全身が入るようにカメラを引く
      camera.position.z = Math.max(4.5, 4.5 * (0.62 / camera.aspect))
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

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
      body.rotation.y = rotY
      ticks.rotation.z = time * 0.0003
      hud.rotation.z = -time * 0.0001

      const { look: lk, selected: sel } = latest.current
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.006)
      ORDER.forEach((region, i) => {
        const l = lk[region]
        uniforms.uCol.value[i].set(l.color)
        uniforms.uAmt.value[i] = l.strength
        uniforms.uSel.value[i] = sel.includes(region) ? 0.22 + 0.16 * pulse : 0
      })

      const deg = Math.round((((rotY * 180) / Math.PI) % 360 + 360) % 360)
      if (deg !== lastAngleReport) {
        lastAngleReport = deg
        latest.current.onAngle?.(deg)
      }
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      api.current = null
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="body-host" ref={host} />
}
