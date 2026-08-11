import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

interface Props {
  file: File
  onScroll?: (deltaPx: number) => void
}

export function PdfViewer({ file, onScroll }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ loading: boolean; error: string; pages: number }>({
    loading: true,
    error: '',
    pages: 0,
  })
  const [scale, setScale] = useState(1.4)

  useEffect(() => {
    let alive = true
    let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
    setState({ loading: true, error: '', pages: 0 })
    const render = async () => {
      try {
        const buf = await file.arrayBuffer()
        task = pdfjsLib.getDocument({ data: buf })
        const doc = await task.promise
        if (!alive) return
        const box = boxRef.current
        if (!box) return
        box.innerHTML = ''
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          const ctx = canvas.getContext('2d')
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise
          }
          box.appendChild(canvas)
        }
        if (alive) setState({ loading: false, error: '', pages: doc.numPages })
      } catch (e) {
        if (alive) setState({ loading: false, error: (e as Error).message, pages: 0 })
      }
    }
    render()
    return () => {
      alive = false
      task?.destroy()
    }
  }, [file, scale])

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
      <div
        ref={boxRef}
        className="pdf-canvas"
        onScroll={(e) => {
          const el = e.currentTarget
          if (onScroll && el.dataset.prevTop) {
            const delta = el.scrollTop - Number(el.dataset.prevTop)
            if (!isNaN(delta) && delta) onScroll(delta)
          }
          el.dataset.prevTop = String(el.scrollTop)
        }}
      >
        {state.loading && <div className="pdf-hint">正在加载 PDF…</div>}
        {state.error && <div className="pdf-hint error">PDF 解析失败：{state.error}</div>}
      </div>
    </div>
  )
}
