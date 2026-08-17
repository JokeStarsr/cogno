import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { nodeById } from '../../data/dsAlgoGraph'
import type { ConceptNode } from '../../types'

export interface TextHandle {
  el: HTMLDivElement | null
  /** 当前可见文本（用于代理上下文与概念检测） */
  visibleText: () => string
}

interface Props {
  text: string
  onScroll?: (deltaPx: number) => void
  /** 滚动即时上报虚拟页位置（替代 3s 轮询，翻页速率与停留统计更准） */
  onVirtualScroll?: (scrollTop: number, viewportH: number) => void
  onConceptSeen?: (conceptId: string) => void
  /** 续读恢复：渲染后滚到的位置 */
  initialScrollTop?: number
}

// ── 概念匹配器：标签按长度降序做正则交替，一次 matchAll 扫全文本，天然最长优先 ──
// 修掉旧实现 O(词元×概念) 双重循环 + "复杂度"误标为"时间复杂度"的错标问题。
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\·]/g, '\\$&')
}

const LABELS: { re: RegExp; hit: (label: string) => string | null } = (() => {
  const byLabel = new Map<string, string>()
  for (const n of nodeById.values()) {
    const exist = byLabel.get(n.label)
    if (!exist || n.id.length < exist.length) byLabel.set(n.label, n.id)
  }
  const sortedEntries = [...byLabel.entries()].sort((a, b) => b[0].length - a[0].length)
  const re = new RegExp(sortedEntries.map(([l]) => escapeRe(l)).join('|'), 'g')
  const idByLabel = new Map(sortedEntries)
  return { re, hit: (label: string) => idByLabel.get(label) ?? null }
})()

export const ALL_CONCEPTS: ConceptNode[] = [...nodeById.values()]

/** 把正文按"概念标签命中"切分渲染；同时收集命中的概念 id（供掌握度识别，零额外扫描） */
function renderTokens(text: string): { nodes: React.ReactNode[]; matched: Set<string> } {
  const out: React.ReactNode[] = []
  const matched = new Set<string>()
  let last = 0
  let key = 0
  LABELS.re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LABELS.re.exec(text))) {
    const [label] = m
    if (label.length === 0) {
      LABELS.re.lastIndex++
      continue
    }
    if (m.index > last) out.push(text.slice(last, m.index))
    const id = LABELS.hit(label)
    const node = id ? nodeById.get(id) : undefined
    if (id && node) {
      matched.add(id)
      out.push(
        <mark
          key={key++}
          className="concept"
          data-concept={id}
          data-desc={node.description}
          onClick={() => conceptPopup(id)}
        >
          {label}
        </mark>
      )
    } else {
      out.push(label)
    }
    last = m.index + label.length
  }
  if (last < text.length) out.push(text.slice(last))
  return { nodes: out, matched }
}

/** 概念浮层：全局单例，点击概念弹出（描述 + 前置），避免引入工具库
 *  window 级监听，ReaderPage/抽屉都能复用 */
let popupEl: HTMLDivElement | null = null
function ensurePopup(): HTMLDivElement {
  if (popupEl) return popupEl
  const el = document.createElement('div')
  el.className = 'concept-popup'
  document.body.appendChild(el)
  popupEl = el
  window.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement
    if (!el.contains(t)) hidePopup()
  })
  return el
}
export function hidePopup() {
  if (popupEl) popupEl.style.display = 'none'
}
function conceptPopup(id: string) {
  const node = nodeById.get(id)
  if (!node) return
  const el = ensurePopup()
  const prereq = node.dependencies.length
    ? node.dependencies.map((d) => nodeById.get(d)?.label ?? d).join(' · ')
    : '无（基础概念）'
  el.innerHTML = ''
  const title = document.createElement('b')
  title.textContent = node.label
  const desc = document.createElement('p')
  desc.textContent = node.description
  const pr = document.createElement('div')
  pr.className = 'concept-popup-prereq'
  pr.textContent = `前置：${prereq}`
  el.append(title, desc, pr)
  el.style.display = 'block'
}

export const TextViewer = memo(
  forwardRef<TextHandle, Props>(function TextViewer({ text, onScroll, onVirtualScroll, onConceptSeen, initialScrollTop }, ref) {
    const elRef = useRef<HTMLDivElement>(null)
    const paraRefs = useRef<(HTMLParagraphElement | null)[]>([])
    const prevTop = useRef(0)
    const firedRef = useRef<Set<string>>(new Set())

    const paragraphs = useMemo(() => (text ? text.split(/\n{2,}/).filter((p) => p.trim()) : []), [text])
    const { nodes, matched } = useMemo(() => {
      // render 期同步建立 ref 骨架，commit 阶段回调再逐个填入
      paraRefs.current = new Array(paragraphs.length).fill(null)
      const all: React.ReactNode[] = []
      const ids = new Set<string>()
      for (let i = 0; i < paragraphs.length; i++) {
        const r = renderTokens(paragraphs[i].trim())
        r.matched.forEach((id) => ids.add(id))
        all.push(
          <p key={i} className="tv-para" ref={(el) => (paraRefs.current[i] = el)}>
            {r.nodes}
          </p>
        )
      }
      return { nodes: all, matched: ids }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text])

    useEffect(() => {
      firedRef.current.clear()
    }, [text])

    // 概念识别：渲染通道已天然给出匹配结果，不再需要 MutationObserver + innerText 全量扫描
    useEffect(() => {
      if (!onConceptSeen) return
      for (const id of matched) {
        if (firedRef.current.has(id)) continue
        firedRef.current.add(id)
        onConceptSeen(id)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matched, text])

    useEffect(() => {
      firedRef.current.clear()
    }, [text])

    // 续读恢复：文档渲染完成后滚动到上次位置（initialScrollTop 仅新文档生效）
    useEffect(() => {
      const el = elRef.current
      if (el && initialScrollTop) {
        el.scrollTop = Math.min(initialScrollTop, el.scrollHeight - el.clientHeight)
        onVirtualScroll?.(el.scrollTop, el.clientHeight)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text])

    useImperativeHandle(ref, () => ({
      el: elRef.current,
      visibleText() {
        const el = elRef.current
        if (!el || !paraRefs.current.length) return text
        const center = el.scrollTop + el.clientHeight / 2
        let best = 0
        let bestDist = Infinity
        paraRefs.current.forEach((p, i) => {
          if (!p) return
          const mid = p.offsetTop + p.offsetHeight / 2
          const d = Math.abs(mid - center)
          if (d < bestDist) {
            bestDist = d
            best = i
          }
        })
        return [best - 1, best, best + 1]
          .filter((i) => i >= 0 && i < paragraphs.length && paraRefs.current[i])
          .map((i) => paraRefs.current[i]!.innerText)
          .join('\n')
      },
    }))

    return (
      <div
        ref={elRef}
        className="text-viewer"
        onScroll={(e) => {
          const el = e.currentTarget
          const delta = el.scrollTop - prevTop.current
          prevTop.current = el.scrollTop
          if (delta && onScroll) onScroll(delta)
          onVirtualScroll?.(el.scrollTop, el.clientHeight)
        }}
      >
        <div className="tv-inner">
          {nodes}
          <p className="tv-tail">—— 阅读结束 ——</p>
        </div>
      </div>
    )
  })
)