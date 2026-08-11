import { useEffect, useRef } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { getAllNodes } from '../../lib/knowledge'
import type { Mastery } from '../../types'

export const MASTERY_COLOR: Record<Mastery, string> = {
  0: '#6b7684', // 未学习
  1: '#ffb347', // 学习中
  2: '#e0f7fa', // 基本掌握
  3: '#ffd700', // 深度掌握
}

interface Props {
  mastery: Map<string, Mastery>
  focusId: string | null
  path: string[]
  onSelect: (id: string) => void
}

export function GridCanvas({ mastery, focusId, path, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // 初始化
  useEffect(() => {
    const el = containerRef.current
    if (!el || cyRef.current) return
    const nodes = getAllNodes()
    const cy = cytoscape({
      container: el,
      elements: [
        ...nodes.map((n) => ({
          data: { id: n.id, label: n.label, domain: n.domain, desc: n.description },
        })),
        ...nodes.flatMap((n) =>
          n.dependencies.map((d) => ({ data: { id: `${d}->${n.id}`, source: d, target: n.id } }))
        ),
      ],
      layout: {
        name: 'cose',
        animate: false,
        padding: 24,
        nodeRepulsion: () => 4200,
        idealEdgeLength: () => 70,
        gravity: 0.25,
      },
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#6b7684',
            label: 'data(label)',
            color: '#c9d2e0',
            'font-size': 11,
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'width': 22,
            'height': 22,
            'border-width': 1,
            'border-color': 'rgba(255,255,255,0.15)',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.2,
            'line-color': 'rgba(128,128,128,0.32)',
            'curve-style': 'bezier',
          },
        },
        { selector: '.focus', style: { 'border-width': 3, 'border-color': '#40e0d0' } },
        { selector: '.path', style: { 'line-color': '#40e0d0', 'width': 2.5, 'target-arrow-color': '#40e0d0' } },
        { selector: '.path-node', style: { 'border-width': 2, 'border-color': '#40e0d0' } },
      ],
    })
    cyRef.current = cy
    cy.on('tap', 'node', (evt) => {
      onSelectRef.current(evt.target.id())
    })
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  // 掌握度 / 焦点 / 路径更新
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.nodes().forEach((nd) => {
        const m = mastery.get(nd.id()) ?? 0
        nd.style('background-color', MASTERY_COLOR[m])
        nd.removeClass('focus path-node')
      })
      cy.edges().removeClass('path')
      if (focusId) {
        const f = cy.getElementById(focusId)
        f.addClass('focus')
        // 高亮与焦点直接相连的边
        f.connectedEdges().addClass('path')
      }
      if (path.length) {
        for (let i = 0; i + 1 < path.length; i++) {
          const e = cy.getElementById(`${path[i]}->${path[i + 1]}`)
          e.addClass('path')
          cy.getElementById(path[i]).addClass('path-node')
          cy.getElementById(path[i + 1]).addClass('path-node')
        }
      }
    })
  }, [mastery, focusId, path])

  return <div ref={containerRef} className="grid-canvas" />
}
