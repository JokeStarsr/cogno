import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { nodeById } from '../../data/dsAlgoGraph'
import { scanConceptsInText } from '../../lib/concepts'

export interface TextHandle {
  el: HTMLDivElement | null
  /** 当前可见文本（用于代理上下文与概念检测） */
  visibleText: () => string
}

interface Props {
  text: string
  onScroll?: (deltaPx: number) => void
  onConceptSeen?: (conceptId: string) => void
}

/** 把正文包成词元序列，命中知识图谱概念时加高亮 */
function renderTokens(text: string): React.ReactNode[] {
  const re = /[一-龥]{1,8}|[a-zA-Z0-9]+/g
  const nodes = [...nodeById.values()].sort((a, b) => b.label.length - a.label.length)
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<span key={key++}>{text.slice(last, m.index)}</span>)
    const tk = m[0]
    const hit = nodes.find((n) => n.label.toLowerCase().includes(tk.toLowerCase()) && tk.length >= 2)
    if (hit) {
      out.push(
        <mark key={key++} className="concept" title={hit.label} data-concept={hit.id}>
          {tk}
        </mark>
      )
    } else {
      out.push(<span key={key++}>{tk}</span>)
    }
    last = m.index + tk.length
  }
  if (last < text.length) out.push(<span key={key++}>{text.slice(last)}</span>)
  return out
}

export const TextViewer = forwardRef<TextHandle, Props>(function TextViewer(
  { text, onScroll, onConceptSeen },
  ref
) {
  const elRef = useRef<HTMLDivElement>(null)
  const seenRef = useRef<Set<string>>(new Set())
  const prevTop = useRef(0)
  const tokens = renderTokens(text)

  useImperativeHandle(ref, () => ({
    el: elRef.current,
    visibleText() {
      return elRef.current?.innerText ?? text
    },
  }))

  useEffect(() => {
    if (!onConceptSeen) return
    const el = elRef.current
    if (!el) return
    const scan = () => scanConceptsInText(el.innerText, onConceptSeen, seenRef.current)
    const observer = new MutationObserver(scan)
    observer.observe(el, { childList: true, subtree: true, characterData: true })
    scan()
    return () => observer.disconnect()
  }, [text, onConceptSeen])

  useEffect(() => {
    seenRef.current.clear()
    prevTop.current = 0
  }, [text])

  return (
    <div
      ref={elRef}
      className="text-viewer"
      onScroll={(e) => {
        const el = e.currentTarget
        const delta = el.scrollTop - prevTop.current
        prevTop.current = el.scrollTop
        if (delta && onScroll) onScroll(delta)
      }}
    >
      <div className="tv-inner">
        {tokens}
        <p className="tv-tail">—— 阅读结束 ——</p>
      </div>
    </div>
  )
})
