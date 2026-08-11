import { useMemo } from 'react'
import type { CognitiveState } from '../../types'
import './CognitiveStateRing.css'

/** 理解深度颜色插值：#4A4A4A → #FFB347 → #E0F7FA */
function understandingColor(v: number): string {
  const t = v / 100
  if (t < 0.5) {
    const k = t * 2
    return lerpColor('#4a4a4a', '#ffb347', k)
  }
  return lerpColor('#ffb347', '#e0f7fa', (t - 0.5) * 2)
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = hexToRgb(a)
  const pb = hexToRgb(b)
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t)
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t)
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t)
  return `rgb(${r},${g},${bl})`
}

function hexToRgb(h: string): [number, number, number] {
  const n = h.replace('#', '')
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

const R = 42
const CIRC = 2 * Math.PI * R

export function CognitiveStateRing({ state }: { state: CognitiveState }) {
  const uColor = useMemo(() => understandingColor(state.understanding), [state.understanding])

  return (
    <div className={`ring-shell ${state.flow ? 'is-flow' : ''}`} title="认知状态环">
      <svg className="state-ring" viewBox="0 0 100 100" width="64" height="64">
        {/* 外环：理解深度 */}
        <circle className="ring-track" cx="50" cy="50" r={R} />
        <circle
          className="ring-arc"
          cx="50"
          cy="50"
          r={R}
          stroke={uColor}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - state.understanding / 100)}
          style={{
            filter: `drop-shadow(0 0 4px ${uColor})`,
          }}
        />
        {/* 中环：注意力（亮度） */}
        <circle
          className="ring-arc attention"
          cx="50"
          cy="50"
          r="31"
          stroke="#ffffff"
          strokeWidth="1.6"
          opacity={0.18 + (state.attention / 100) * 0.75}
          strokeDasharray={CIRC * 0.73}
          strokeDashoffset={CIRC * 0.73 * (1 - state.attention / 100)}
          transform="rotate(-90 50 50)"
        />
        {/* 内环：疲劳（淡紫） */}
        <circle
          className="ring-arc fatigue"
          cx="50"
          cy="50"
          r="22"
          stroke="#d8bfd8"
          strokeWidth="2"
          strokeDasharray={CIRC * 0.52}
          strokeDashoffset={CIRC * 0.52 * (1 - state.fatigue / 100)}
          opacity={state.fatigue > 25 ? 0.5 + (state.fatigue / 100) * 0.5 : 0}
          transform="rotate(120 50 50)"
        />
        {/* 中心：心流 */}
        <circle className="flow-core" cx="50" cy="50" r="8" fill="#ffd700" />
      </svg>
      <div className="ring-legend">
        <div className="legend-item">
          <span className="dot" style={{ background: uColor }} />
          理解 {Math.round(state.understanding)}
        </div>
        <div className="legend-item">
          <span className="dot" style={{ background: '#ffffff' }} />
          注意 {Math.round(state.attention)}
        </div>
        <div className="legend-item">
          <span className="dot" style={{ background: '#d8bfd8' }} />
          疲劳 {Math.round(state.fatigue)}
        </div>
        {state.flow && <div className="flow-badge">心流 · 请勿打扰</div>}
      </div>
    </div>
  )
}
