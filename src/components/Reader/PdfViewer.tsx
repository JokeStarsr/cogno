import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

interface Props {
  file: File
  onScroll?: (deltaPx: number) => void
}

/** 一页 PDF：由 React 管理 canvas 元素本身，内容在 effect 里绘制 */
function PdfPage({
  page,
  scale,
  onRendered,
}: {
  page: pdfjsLib.PDFPageProxy
  scale: number
  onRendered: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<pdfjsLib.PDFPageProxy['render']> | null = null
    const render = async () => {
      const canvas = canvasRef.current
      if (!canvas || cancelled) return
      const viewport = page.getViewport({ scale })
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      task = page.render({ canvasContext: ctx, viewport })
      await task.promise
      if (!cancelled) onRendered()
    }
    render().catch((e: unknown) => {
      // 组件卸载/StrictMode 双挂载时 task.cancel() 会 reject,属预期,丢弃
      if (!(e instanceof Error && e.name === 'RenderingCancelledException')) {
        console.error('PDF 页面渲染失败', e)
      }
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [page, scale, onRendered])

  return <canvas ref={canvasRef} />
}

export function PdfViewer({ file, onScroll }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ loading: boolean; error: string; pages: number }>({
    loading: true,
    error: '',
    pages: 0,
  })
  const [scale, setScale] = useState(1.4)
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageProxies, setPageProxies] = useState<pdfjsLib.PDFPageProxy[]>([])
  const onRendered = useCallback(() => {}, [])

  // 加载文档（幂等，重载时先摧毁旧文档）
  useEffect(() => {
    let alive = true
    let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
    setState({ loading: true, error: '', pages: 0 })
    setPageProxies([])
    const load = async () => {
      try {
        const buf = await file.arrayBuffer()
        task = pdfjsLib.getDocument({ data: buf })
        const d = await task.promise
        if (!alive) return
        setDoc(d)
        const pages: pdfjsLib.PDFPageProxy[] = []
        for (let i = 1; i <= d.numPages; i++) {
          const p = await d.getPage(i)
          if (!alive) return
          pages.push(p)
        }
        setPageProxies(pages)
        if (alive) setState((s) => ({ ...s, loading: false, pages: pages.length }))
      } catch (e) {
        if (alive) setState({ loading: false, error: (e as Error).message, pages: 0 })
      }
    }
    void load()
    return () => {
      alive = false
      task?.destroy()
      doc?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      if (onScroll && el.dataset.prevTop) {
        const delta = el.scrollTop - Number(el.dataset.prevTop)
        if (!isNaN(delta) && delta) onScroll(delta)
      }
      el.dataset.prevTop = String(el.scrollTop)
    },
    [onScroll]
  )

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <span>{file.name}</span>
        <div>
          <button className="btn-ghost" onClick={() => setScale((s) => Math.max(0.8, s - 0.2))}>
            −
          </button>
          <span className="pdf-scale">{Math.round(scale * 100)}%</span>
          <button className="btn-ghost" onClick={() => setScale((s) => Math.min(2.5, s + 0.2))}>
            +
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="pdf-canvas" onScroll={handleScroll}>
        {state.loading && <div className="pdf-hint">正在加载 PDF…</div>}
        {state.error && <div className="pdf-hint error">PDF 解析失败：{state.error}</div>}
        {pageProxies.map((p) => (
          <PdfPage key={p.pageNumber} page={p} scale={scale} onRendered={onRendered} />
        ))}
      </div>
    </div>
  )
}