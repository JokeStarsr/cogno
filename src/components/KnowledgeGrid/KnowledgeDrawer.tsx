import { useMemo, useState } from 'react'
import { getAllNodes, getConcept, findGaps, findLearningPath, blockageScore } from '../../lib/knowledge'
import type { Mastery } from '../../types'
import { GridCanvas } from './GridCanvas'
import './KnowledgeDrawer.css'

interface Props {
  open: boolean
  mastery: Map<string, Mastery>
  onClose: () => void
  onGoReview: () => void
}

type Tab = 'grid' | 'gap'

export function KnowledgeDrawer({ open, mastery, onClose, onGoReview }: Props) {
  const [tab, setTab] = useState<Tab>('grid')
  const [focusId, setFocusId] = useState<string | null>(null)
  const [gapTarget, setGapTarget] = useState<string>('dp-basics')
  const [path, setPath] = useState<string[]>([])

  const masteredIds = useMemo(() => {
    const s = new Set<string>()
    mastery.forEach((m, id) => {
      if (m >= 2) s.add(id)
    })
    return s
  }, [mastery])

  const gaps = useMemo(
    () => (tab === 'gap' ? findGaps(gapTarget, masteredIds) : []),
    [tab, gapTarget, masteredIds]
  )

  const focusNode = focusId ? getConcept(focusId) : null

  const handleFocus = (id: string) => {
    setFocusId(id)
    setTab('grid')
    setPath([])
  }

  const computePath = () => {
    const target = gapTarget
    const p = findLearningPath(target, masteredIds)
    setPath(p)
    setFocusId(target)
  }

  if (!open) return null

  return (
    <div className="kdrawer panel">
      <div className="kdrawer-header">
        <div className="kdrawer-tabs">
          <button className={tab === 'grid' ? 'active' : ''} onClick={() => setTab('grid')}>
            理解网格
          </button>
          <button className={tab === 'gap' ? 'active' : ''} onClick={() => setTab('gap')}>
            知识缺口
          </button>
        </div>
        <button className="kdrawer-close" onClick={onClose}>
          ×
        </button>
      </div>

      {tab === 'grid' && (
        <>
          <div className="kdrawer-search">
            <input
              className="input"
              placeholder="搜索概念…"
              list="concept-list"
              onChange={(e) => {
                const v = e.target.value.trim()
                if (v) {
                  const hit = getAllNodes().find((n) => n.label.includes(v) || n.id === v)
                  if (hit) handleFocus(hit.id)
                }
              }}
            />
            <datalist id="concept-list">
              {getAllNodes().map((n) => (
                <option key={n.id} value={n.label} />
              ))}
            </datalist>
          </div>
          <div className="kdrawer-canvas">
            <GridCanvas
              mastery={mastery}
              focusId={focusId}
              path={path}
              onSelect={handleFocus}
            />
          </div>
          {focusNode && (
            <div className="node-detail">
              <div className="node-detail-title" style={{ color: '#40e0d0' }}>
                {focusNode.label}
                <span className="node-domain">{focusNode.domain}</span>
              </div>
              <p className="node-desc">{focusNode.description}</p>
              <div className="node-prereq">
                前置：
                {focusNode.dependencies.length
                  ? focusNode.dependencies.map((d) => getConcept(d).label).join(' · ')
                  : '无'}
              </div>
              <div className="node-actions">
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setGapTarget(focusNode.id)
                    setTab('gap')
                  }}
                >
                  查缺口
                </button>
                <button className="btn-ghost" onClick={() => setPath(findLearningPath(focusNode.id, masteredIds))}>
                  学习路径
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'gap' && (
        <div className="kdrawer-gap">
          <div className="gap-target">
            <label>目标概念</label>
            <select className="input" value={gapTarget} onChange={(e) => setGapTarget(e.target.value)}>
              {getAllNodes().map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
            <button className="btn-primary" onClick={computePath}>
              生成修复路径
            </button>
          </div>

          {gaps.length ? (
            <>
              <p className="gap-hint">
                要理解「{getConcept(gapTarget).label}」，你还需要掌握 {gaps.length} 个前置概念：
              </p>
              <ul className="gap-list">
                {gaps.map((id) => {
                  const n = getConcept(id)
                  return (
                    <li key={id}>
                      <div className="gap-name">{n.label}</div>
                      <div className="gap-meta">
                        难度 {n.difficulty} · 阻塞 {blockageScore(id)} 个概念
                      </div>
                      <button className="btn-ghost" onClick={() => handleFocus(id)}>
                        定位
                      </button>
                    </li>
                  )
                })}
              </ul>
              {path.length > 0 && (
                <div className="gap-path">
                  修复路径：{path.map((p) => getConcept(p).label).join(' → ')}
                </div>
              )}
            </>
          ) : (
            <div className="gap-clear">
              <span className="gap-ok">✓</span>
              「{getConcept(gapTarget).label}」的全部前置概念你已掌握，可以开始了。
            </div>
          )}

          <div className="kdrawer-footer">
            <button className="btn-ghost" onClick={onGoReview}>
              去间隔回顾
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
