import { useEffect, useState } from 'react'

const POINTS = [0, 1, 2, 3, 4, 5, 6, 7] as const

interface Props {
  onDone: () => void
  onCancel: () => void
}

/** WebGazer 校准：点击屏幕上的点，库会自动采集训练样本 */
export function CalibrationOverlay({ onDone, onCancel }: Props) {
  const [clicked, setClicked] = useState<Set<number>>(new Set())
  const [step, setStep] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const positions = [
    { left: '12%', top: '14%' },
    { left: '50%', top: '8%' },
    { left: '88%', top: '14%' },
    { left: '10%', top: '50%' },
    { left: '90%', top: '50%' },
    { left: '12%', top: '86%' },
    { left: '50%', top: '92%' },
    { left: '88%', top: '86%' },
  ]

  const handleClick = (i: number) => {
    const next = new Set(clicked)
    next.add(i)
    setClicked(next)
    setStep(next.size)
    if (next.size >= POINTS.length) {
      setTimeout(onDone, 400)
    }
  }

  return (
    <div className="cal-overlay">
      <div className="cal-card panel">
        <h3>眼动追踪校准</h3>
        <p>请保持头部不动，依次点击屏幕上出现的 {POINTS.length} 个光点（按 Esc 可跳过，使用鼠标代理）。</p>
        {/* Phase 1.5：明确告知摄像头数据处理方式 */}
        <p style={{ fontSize: 12, opacity: 0.75 }}>
          摄像头画面仅在浏览器本地实时处理，不会录制或上传；校准数据也可在此状态下随时关闭眼动。
        </p>
        <div className="cal-progress">
          <div className="cal-bar" style={{ width: `${(step / POINTS.length) * 100}%` }} />
        </div>
        <button className="btn-ghost" onClick={onDone}>
          跳过校准
        </button>
      </div>
      {positions.map((p, i) => (
        <button
          key={i}
          className={`cal-dot ${clicked.has(i) ? 'done' : ''}`}
          style={p}
          onClick={() => handleClick(i)}
          aria-label={`校准点 ${i + 1}`}
        />
      ))}
    </div>
  )
}
