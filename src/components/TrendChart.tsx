import { useRef, useState } from 'react'
import { fmtShort } from '../lib/date'

export interface Point {
  date: string
  value: number
}

const W = 340
const PAD = { l: 40, r: 12, t: 14, b: 26 }

function niceTicks(min: number, max: number) {
  if (min === max) {
    min -= 1
    max += 1
  }
  const raw = (max - min) / 3
  const mag = 10 ** Math.floor(Math.log10(raw))
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((u) => u >= raw) ?? raw
  const lo = Math.floor(min / unit) * unit
  const hi = Math.ceil(max / unit) * unit
  const ticks: number[] = []
  for (let i = 0; i < 12 && lo + i * unit <= hi + unit / 2; i++) ticks.push(Math.round((lo + i * unit) * 100) / 100)
  return ticks
}

/**
 * 単一系列の推移グラフ。タップ/ドラッグで値を読める。
 * compact: 複数並べる用の低いグラフ / goal: 目標値の横線（範囲から大きく外れていても見えるよう縦軸に含める）
 */
export function TrendChart({ points, unit, compact = false, goal = null }: { points: Point[]; unit: string; compact?: boolean; goal?: number | null }) {
  const ref = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const H = compact ? 130 : 190

  if (points.length < 2) return <p className="empty">2回以上記録するとグラフが表示されます</p>

  const values = [...points.map((p) => p.value), ...(goal === null ? [] : [goal])]
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (points.length - 1)
  const y = (v: number) => PAD.t + ((yMax - v) * (H - PAD.t - PAD.b)) / (yMax - yMin)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ')
  const showDots = points.length <= 24

  const pointAt = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect()
    const px = ((clientX - box.left) / box.width) * W
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1))
    setActive(Math.max(0, Math.min(points.length - 1, i)))
  }

  const cur = active === null ? null : points[active]
  const tipLeft = active === null ? 0 : Math.min(Math.max((x(active) / W) * 100, 16), 84)

  return (
    <div className="chart">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`推移グラフ。最新 ${points[points.length - 1].value}${unit}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pointAt(e.clientX)
        }}
        onPointerMove={(e) => e.buttons > 0 && pointAt(e.clientX)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
              {t}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 7} className="axis">
          {fmtShort(points[0].date).split('（')[0]}
        </text>
        <text x={W - PAD.r} y={H - 7} textAnchor="end" className="axis">
          {fmtShort(points[points.length - 1].date).split('（')[0]}
        </text>
        {goal !== null && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(goal)} y2={y(goal)} className="goal-line" />
            <text x={W - PAD.r - 2} y={y(goal) - 4} textAnchor="end" className="goal-text">
              目標 {goal}
              {unit}
            </text>
          </g>
        )}
        <path d={path} className="line" />
        {showDots && points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={3.2} className="dot" />)}
        {active !== null && cur && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={PAD.t} y2={H - PAD.b} className="cross" />
            <circle cx={x(active)} cy={y(cur.value)} r={5.5} className="dot active" />
          </g>
        )}
      </svg>
      {cur && (
        <div className="chart-tip" style={{ left: `${tipLeft}%` }}>
          <b>
            {cur.value}
            {unit}
          </b>
          <span>{fmtShort(cur.date)}</span>
        </div>
      )}
    </div>
  )
}
