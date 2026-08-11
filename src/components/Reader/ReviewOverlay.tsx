import { useEffect, useState } from 'react'
import { getConcept } from '../../lib/knowledge'
import { listDue, review } from '../../lib/spacedRepetition'
import type { ReviewItem } from '../../types'

interface Props {
  onClose: () => void
  onReviewed: () => void
}

/** 间隔回顾：艾宾浩斯遗忘曲线的卡片式自评 */
export function ReviewOverlay({ onClose, onReviewed }: Props) {
  const [due, setDue] = useState<ReviewItem[]>([])
  const [done, setDone] = useState(0)

  useEffect(() => {
    let alive = true
    listDue().then((d) => {
      if (alive) setDue(d)
    })
    return () => {
      alive = false
    }
  }, [])

  const grade = async (item: ReviewItem, g: 0 | 1 | 2 | 3) => {
    await review(item.conceptId, g)
    setDone((d) => d + 1)
    setDue((arr) => arr.filter((x) => x.conceptId !== item.conceptId))
    onReviewed()
  }

  const current = due[0]

  return (
    <div className="review-overlay">
      <div className="review-card panel">
        <div className="review-header">
          <h3>间隔回顾</h3>
          <button className="kdrawer-close" onClick={onClose}>
            ×
          </button>
        </div>

        {due.length === 0 ? (
          <div className="review-done">
            <div className="review-done-num">✓ 完成 {done} 项</div>
            <p>当前没有更多待复习概念。</p>
            <button className="btn-primary" onClick={onClose}>
              完成
            </button>
          </div>
        ) : (
          <>
            <div className="review-progress">
              剩余 {due.length} 项
            </div>
            <div className="review-concept">
              <div className="review-label">{getConcept(current.conceptId).label}</div>
              <p className="review-desc">{getConcept(current.conceptId).description}</p>
            </div>
            <div className="review-grades">
              <button className="grade g0" onClick={() => grade(current, 0)}>
                忘了
              </button>
              <button className="grade g1" onClick={() => grade(current, 1)}>
                模糊
              </button>
              <button className="grade g2" onClick={() => grade(current, 2)}>
                记住了
              </button>
              <button className="grade g3" onClick={() => grade(current, 3)}>
                能应用
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
