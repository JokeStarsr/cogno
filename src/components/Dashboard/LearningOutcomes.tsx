import { useCallback, useEffect, useState } from 'react'
import { loadQuizRecords, type QuizRecord } from '../../lib/quiz'
import { getConcept } from '../../lib/knowledge'
import './LearningOutcomes.css'

/** 测评完成后由 QuizOverlay 广播，本组件收到后自动刷新（跨页面保持挂载） */
export const QUIZ_SAVED_EVENT = 'cogno:quiz-saved'
export function notifyQuizSaved(): void {
  window.dispatchEvent(new CustomEvent(QUIZ_SAVED_EVENT))
}

function conceptLabel(id: string): string {
  try {
    return getConcept(id).label
  } catch {
    return id
  }
}

interface SvgPoint {
  x: number
  y: number
}

/** 纯 SVG 折线：0-3 分轴，前后测两组；点数不足时画点 */
function ScoreLines({ records }: { records: QuizRecord[] }) {
  const w = 560
  const h = 140
  const padL = 30
  const padR = 14
  const padT = 12
  const padB = 22
  const plotW = w - padL - padR
  const plotH = h - padT - padB
  const xAt = (i: number) => padL + (records.length === 1 ? plotW / 2 : (i / (records.length - 1)) * plotW)
  const yAt = (score: number) => padT + plotH - (Math.max(0, Math.min(3, score)) / 3) * plotH

  const line = (pick: (r: QuizRecord) => number): SvgPoint[] =>
    records.map((r, i) => ({ x: xAt(i), y: yAt(pick(r)) }))

  const path = (pts: SvgPoint[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const area = (pts: SvgPoint[]) =>
    `${path(pts)} L${pts[pts.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L${pts[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`

  const pretest = line((r) => r.pretest)
  const posttest = line((r) => r.posttest)

  return (
    <svg className="lo-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="前后测得分趋势">
      {/* 分数参考网格（0/1/2/3） */}
      {[0, 1, 2, 3].map((s) => (
        <g key={s}>
          <line
            x1={padL}
            x2={w - padR}
            y1={yAt(s)}
            y2={yAt(s)}
            className="lo-grid"
          />
          <text x={4} y={yAt(s) + 4} className="lo-axis">
            {s}
          </text>
        </g>
      ))}
      <path d={area(pretest)} className="lo-area pre" />
      <path d={area(posttest)} className="lo-area post" />
      <path d={path(pretest)} className="lo-line pre" />
      <path d={path(posttest)} className="lo-line post" />
      {records.map((r, i) => (
        <g key={r.createdAt}>
          <circle cx={pretest[i].x} cy={pretest[i].y} r={3} className="lo-dot pre" />
          <circle cx={posttest[i].x} cy={posttest[i].y} r={3} className="lo-dot post" />
          {records.length <= 8 && (
            <text x={pretest[i].x} y={h - 6} className="lo-xlabel" textAnchor="middle">
              {new Date(r.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

export function LearningOutcomes() {
  const [records, setRecords] = useState<QuizRecord[]>([])

  const refresh = useCallback(() => {
    setRecords(loadQuizRecords())
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener(QUIZ_SAVED_EVENT, refresh)
    return () => window.removeEventListener(QUIZ_SAVED_EVENT, refresh)
  }, [refresh])

  if (records.length === 0) return null

  // 时间轴：最近 12 次（含同一概念多次）
  const timeline = [...records].sort((a, b) => a.createdAt - b.createdAt).slice(-12)
  // 概念对比：每概念最近一次
  const latestByConcept = [...records]
    .sort((a, b) => a.createdAt - b.createdAt)
    .reduce<Map<string, QuizRecord>>((m, r) => {
      m.set(r.conceptId, r)
      return m
    }, new Map())
  const conceptRows = [...latestByConcept.values()].sort((a, b) => (b.posttest - b.pretest) - (a.posttest - a.pretest))

  return (
    <div className="lo panel">
      <div className="lo-head">
        <h2>测评趋势</h2>
        <span className="lo-note">概念理解前测 → 后测对比（最近 {records.length} 次）</span>
      </div>
      <div className="lo-body">
        <div className="lo-chart">
          <ScoreLines records={timeline} />
          <div className="lo-legend">
            <span className="lo-key pre">前测</span>
            <span className="lo-key post">后测</span>
          </div>
        </div>
        <div className="lo-list">
          {conceptRows.slice(0, 6).map((r) => (
            <div key={r.conceptId} className="lo-row">
              <span className="lo-row-label">{conceptLabel(r.conceptId)}</span>
              <span className="lo-row-scores">
                {r.pretest} → {r.posttest}
              </span>
              <span className={`lo-row-delta ${r.posttest > r.pretest ? 'up' : r.posttest < r.pretest ? 'down' : ''}`}>
                {r.posttest > r.pretest ? `+${r.posttest - r.pretest}` : r.posttest === r.pretest ? '持平' : `${r.posttest - r.pretest}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}