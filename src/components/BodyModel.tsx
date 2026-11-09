import { useEffect, useRef } from 'react'
import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  SplineCurve,
  Vector2,
  Vector3,
  WebGLRenderer,
  DoubleSide,
  type BufferGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { REGIONS, regionInfo, type Region } from '../data/regions'

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

type V3 = [number, number, number]

/** 体表に塗る筋肉の領域（楕円体）。中心と半径は体の座標系。x軸で左右対称に複製する */
interface Zone {
  region: Region
  c: V3
  r: V3
  mirror?: boolean
}

// y=0 が腰の少し上。身長はおよそ -1.08〜1.0。+zが正面
const ZONES: Zone[] = [
  { region: 'chest', c: [0.098, 0.565, 0.085], r: [0.112, 0.078, 0.07], mirror: true },
  { region: 'shoulders', c: [0.262, 0.635, 0.0], r: [0.062, 0.095, 0.075], mirror: true },
  { region: 'traps', c: [0, 0.63, -0.1], r: [0.1, 0.15, 0.07] },
  { region: 'traps', c: [0.1, 0.71, -0.03], r: [0.1, 0.05, 0.09], mirror: true },
  { region: 'lats', c: [0.135, 0.4, -0.08], r: [0.08, 0.17, 0.07], mirror: true },
  { region: 'lowback', c: [0.045, 0.17, -0.07], r: [0.045, 0.11, 0.06], mirror: true },
  { region: 'biceps', c: [0.272, 0.46, 0.03], r: [0.055, 0.115, 0.045], mirror: true },
  { region: 'triceps', c: [0.272, 0.46, -0.03], r: [0.055, 0.12, 0.045], mirror: true },
  { region: 'forearms', c: [0.292, 0.17, 0], r: [0.055, 0.14, 0.055], mirror: true },
  { region: 'abs', c: [0.036, 0.46, 0.085], r: [0.044, 0.033, 0.05], mirror: true },
  { region: 'abs', c: [0.036, 0.395, 0.08], r: [0.045, 0.033, 0.05], mirror: true },
  { region: 'abs', c: [0.036, 0.327, 0.074], r: [0.045, 0.033, 0.05], mirror: true },
  { region: 'abs', c: [0.036, 0.258, 0.072], r: [0.045, 0.033, 0.05], mirror: true },
  { region: 'abs', c: [0.034, 0.19, 0.07], r: [0.042, 0.036, 0.05], mirror: true },
  { region: 'obliques', c: [0.128, 0.34, 0.05], r: [0.05, 0.13, 0.07], mirror: true },
  { region: 'glutes', c: [0.078, -0.02, -0.09], r: [0.092, 0.1, 0.075], mirror: true },
  { region: 'quads', c: [0.095, -0.32, 0.07], r: [0.085, 0.25, 0.075], mirror: true },
  { region: 'hamstrings', c: [0.095, -0.32, -0.07], r: [0.085, 0.25, 0.075], mirror: true },
  { region: 'calves', c: [0.075, -0.72, -0.04], r: [0.065, 0.16, 0.055], mirror: true },
]

const ORDER: Region[] = REGIONS.map((r) => r.id)
const zoneList = ZONES.flatMap((z) =>
  (z.mirror ? [1, -1] : [1]).map((sx) => ({ region: z.region, c: [z.c[0] * sx, z.c[1], z.c[2]] as V3, r: z.r })),
)

/** 回転体で作る手足。keys は [y, 半径] を下から上へ。スプラインでなめらかに補間する */
const limb = (keys: [number, number][], radial = 28) => {
  const curve = new SplineCurve(keys.map(([y, r]) => new Vector2(r, y)))
  const pts = curve.getPoints(24)
  pts.unshift(new Vector2(0, keys[0][0]))
  pts.push(new Vector2(0, keys[keys.length - 1][0]))
  return new LatheGeometry(pts, radial)
}

// 胴体：腰→くびれ→ろく骨→広い肩→首へのなだらかな僧帽筋の傾斜
const torsoGeo = new LatheGeometry(
  [
    [0.0, -0.08], [0.15, -0.08], [0.168, 0.0], [0.15, 0.12], [0.138, 0.24], [0.15, 0.38],
    [0.185, 0.5], [0.215, 0.6], [0.215, 0.67], [0.16, 0.73], [0.075, 0.77], [0.045, 0.8], [0.0, 0.8],
  ].map(([r, y]) => new Vector2(r, y)),
  36,
)

interface Part {
  geo: BufferGeometry
  pos: V3
  scale?: V3
  rot?: V3
  mirror?: boolean
}

const PARTS: Part[] = [
  { geo: new SphereGeometry(0.1, 32, 24), pos: [0, 0.91, 0.012], scale: [0.86, 1.14, 1.0] },
  { geo: new CylinderGeometry(0.046, 0.054, 0.14, 20), pos: [0, 0.79, 0] },
  { geo: torsoGeo, pos: [0, 0, 0], scale: [1, 1, 0.5] },
  // 胸板・三角筋・臀部の盛り上がり
  { geo: new SphereGeometry(1, 28, 20), pos: [0.098, 0.565, 0.078], scale: [0.108, 0.072, 0.05], mirror: true },
  { geo: new SphereGeometry(1, 24, 18), pos: [0.258, 0.63, 0.0], scale: [0.058, 0.085, 0.066], mirror: true },
  { geo: new SphereGeometry(1, 24, 18), pos: [0.078, -0.02, -0.07], scale: [0.088, 0.1, 0.078], mirror: true },
  // 腕（上腕→前腕→手）
  { geo: limb([[0.3, 0.036], [0.4, 0.043], [0.5, 0.05], [0.58, 0.05], [0.64, 0.044]]), pos: [0.272, 0, 0], mirror: true },
  { geo: limb([[-0.0, 0.024], [0.08, 0.03], [0.18, 0.038], [0.24, 0.04], [0.3, 0.034]]), pos: [0.292, 0, 0], mirror: true },
  { geo: new SphereGeometry(0.03, 16, 12), pos: [0.3, -0.04, 0], scale: [0.85, 1.5, 0.6], mirror: true },
  // 脚（腿→すね）
  { geo: limb([[-0.58, 0.05], [-0.45, 0.062], [-0.32, 0.088], [-0.15, 0.1], [-0.02, 0.098]], 32), pos: [0.093, 0, 0], mirror: true },
  { geo: limb([[-1.0, 0.026], [-0.9, 0.034], [-0.78, 0.04], [-0.7, 0.054], [-0.64, 0.056], [-0.58, 0.05]], 28), pos: [0.083, 0, -0.004], mirror: true },
  { geo: new SphereGeometry(0.05, 16, 12), pos: [0.083, -1.05, 0.045], scale: [0.85, 0.65, 2.0], mirror: true },
]

const bodyGeo = (() => {
  const geos: BufferGeometry[] = []
  const m = new Matrix4()
  for (const p of PARTS) {
    for (const sx of p.mirror ? [1, -1] : [1]) {
      const g = p.geo.clone()
      m.compose(
        new Vector3(p.pos[0] * sx, p.pos[1], p.pos[2]),
        new Quaternion().setFromEuler(new Euler(...(p.rot ?? [0, 0, 0]))),
        new Vector3(...(p.scale ?? [1, 1, 1])),
      )
      g.applyMatrix4(m)
      geos.push(g)
    }
  }
  const merged = mergeGeometries(geos, false)!
  merged.computeVertexNormals()
  return merged
})()

const SKIN = new Color('#3d5066')

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
    scene.add(new AmbientLight(0xffffff, 0.8))
    const key = new DirectionalLight(0xffffff, 1.2)
    key.position.set(2, 3, 4)
    scene.add(key)
    const rim = new DirectionalLight(0x22d3ee, 0.8)
    rim.position.set(-3, 1, -3)
    scene.add(rim)

    const disposables: { dispose: () => void }[] = []
    const track = <T extends { dispose: () => void }>(o: T) => {
      disposables.push(o)
      return o
    }

    const body = new Group()
    scene.add(body)

    // 体表シェーダー：各筋肉の楕円領域に回復状況の色を塗り、筋肉の境目に細い溝を入れる
    const N = zoneList.length
    const NR = ORDER.length
    const uniforms = {
      uC: { value: zoneList.map((z) => new Vector3(...z.c)) },
      uR: { value: zoneList.map((z) => new Vector3(...z.r)) },
      uI: { value: zoneList.map((z) => ORDER.indexOf(z.region)) },
      uCol: { value: ORDER.map(() => new Color('#4a5d6e')) },
      uAmt: { value: ORDER.map(() => 0) },
      uSel: { value: ORDER.map(() => 0) },
      uSkin: { value: SKIN },
    }
    const bodyMat = track(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 }))
    bodyMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', 'varying vec3 vBP;\n#include <common>')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBP = position;')
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vBP;
          uniform vec3 uC[${N}]; uniform vec3 uR[${N}]; uniform float uI[${N}];
          uniform vec3 uCol[${NR}]; uniform float uAmt[${NR}]; uniform float uSel[${NR}];
          uniform vec3 uSkin;`,
        )
        .replace(
          '#include <color_fragment>',
          `float rw[${NR}];
          for (int k = 0; k < ${NR}; k++) rw[k] = 0.0;
          float groove = 0.0; float bulge = 0.0;
          for (int i = 0; i < ${N}; i++) {
            vec3 q = (vBP - uC[i]) / uR[i]; float d = mix(length(q), max(max(abs(q.x), abs(q.y)), abs(q.z)), 0.45);
            int r = int(uI[i] + 0.5);
            bulge = max(bulge, 1.0 - d);
            rw[r] = max(rw[r], 1.0 - smoothstep(0.78, 0.97, d));
            groove = max(groove, smoothstep(0.84, 0.97, d) * (1.0 - smoothstep(0.97, 1.1, d)));
          }
          vec3 gEm = vec3(0.0);
          vec3 base = uSkin;
          for (int k = 0; k < ${NR}; k++) {
            base = mix(base, uCol[k], rw[k] * 0.95);
            gEm += uCol[k] * rw[k] * (0.08 + 0.32 * uAmt[k]) + vec3(1.0) * rw[k] * uSel[k];
          }
          diffuseColor.rgb = base * (0.78 + 0.45 * bulge) * (1.0 - 0.42 * groove);`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEm;')
    }
    const bodyMesh = new Mesh(track(bodyGeo.clone()), bodyMat)
    body.add(bodyMesh)

    const centers = zoneList.map((z) => ({ region: z.region, c: new Vector3(...z.c), r: z.r }))

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

    // 向きに応じて、裏側にしか見えない部位は選べないようにする（正面で背中の筋肉を拾わない）
    const allowed = (region: Region) => {
      const side = regionInfo(region).side
      const facing = Math.cos(rotY)
      if (side === 'back') return facing < 0.35
      if (side === 'front') return facing > -0.35
      return true
    }
    const world = new Vector3()
    const local = new Vector3()
    const pick = (cx: number, cy: number) => {
      const r = canvas.getBoundingClientRect()
      pointer.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(pointer, camera)
      // 体表に当たった点が、どの筋肉の領域に入っているかで判定する
      const hit = ray.intersectObject(bodyMesh, false)[0]
      if (hit) {
        local.copy(hit.point)
        bodyMesh.worldToLocal(local)
        let best: Region | null = null
        let bestD = 1
        for (const z of centers) {
          if (!allowed(z.region)) continue
          const d = Math.hypot((local.x - z.c.x) / z.r[0], (local.y - z.c.y) / z.r[1], (local.z - z.c.z) / z.r[2])
          if (d < bestD) {
            bestD = d
            best = z.region
          }
        }
        if (best) {
          latest.current.onToggle(best)
          return
        }
      }
      // ぴったり当たらなくても、指の大きさ分（約30px）の範囲で最も近い部位を選ぶ
      let near: Region | null = null
      let nearD = 30
      for (const z of centers) {
        if (!allowed(z.region)) continue
        world.copy(z.c)
        body.localToWorld(world)
        world.project(camera)
        const sx = ((world.x + 1) / 2) * r.width + r.left
        const sy = ((1 - world.y) / 2) * r.height + r.top
        const d = Math.hypot(sx - cx, sy - cy)
        if (d < nearD) {
          nearD = d
          near = z.region
        }
      }
      if (near) latest.current.onToggle(near)
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
