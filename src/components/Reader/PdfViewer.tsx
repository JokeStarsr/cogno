import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export interface PdfHandle {
  /** 视口中部所在页及其前后页的抽取文本（供代理取上下文） */
  getVisibleText: () => string
  getCurrentPage: () => number
}

interface Props {
  file: File
  onScroll?: (deltaPx: number) => void
  /** PDF 逐页文本抽取完成（代理上下文 + 概念检测用） */
  onTextReady?: (pages: string[]) => void
  /** 滚动跨越页面时上报当前页索引（0-based） */
  onPageChange?: (pageIndex: number) => void
  /** 续读恢复：加载完成后跳转到的页索引（0-based），默认 0 */
  initialPage?: number
}

/** 视口外缓冲页数：渲染范围 = 当前页 ±CHUNK */
const CHUNK = 2

/**
 * 一页 PDF：仅当进入视口缓冲范围才渲染 canvas；
 * 离开范围即清空位图释放 GPU 内存 —— 数百页的 PDF 也不会渲染几百张画布。
 * wrapper 高度用 viewport 预计算（render 之前就可知），清空画布后布局不塌陷。
 */
function PdfPage({ page, scale, visible }: { page: pdfjsLib.PDFPageProxy; scale: number; visible: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderedScaleRef = useRef(0)
  const vp = page.getViewport({ scale })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!visible) {
      // 离开视口缓冲：释放位图
      if (renderedScaleRef.current) {
        canvas.width = 0
        canvas.height = 0
        renderedScaleRef.current = 0
      }
      return
    }
    if (renderedScaleRef.current === scale) return
    let cancelled = false
    const render = async () => {
      const viewport = page.getViewport({ scale })
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const task = page.render({ canvasContext: ctx, viewport })
      await task.promise
      if (!cancelled) renderedScaleRef.current = scale
    }
    render().catch((e: unknown) => {
      // 组件卸载/StrictMode 双挂载时 task.cancel() 会 reject,属预期,丢弃
      if (!(e instanceof Error && e.name === 'RenderingCancelledException')) {
        console.error('PDF 页面渲染失败', e)
      }
    })
    return () => {
      cancelled = true
    }
  }, [page, scale, visible])

  return (
    <div className="pdf-page-wrap" style={{ minHeight: vp.height }}>
      <canvas ref={canvasRef} />
    </div>
  )
}

export const PdfViewer = memo(
  forwardRef<PdfHandle, Props>(function PdfViewer({ file, onScroll, onTextReady, onPageChange, initialPage = 0 }, ref) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const [state, setState] = useState<{ loading: boolean; error: string; pages: number }>({
      loading: true,
      error: '',
      pages: 0,
    })
    const [scale, setScale] = useState(1.4)
    const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
    const [pageProxies, setPageProxies] = useState<pdfjsLib.PDFPageProxy[]>([])
    /** 可视缓冲范围 [start, end]（仅这些页渲染） */
    const [range, setRange] = useState<[number, number]>([0, CHUNK])
    /** 整本 PDF 都抽不出文本（图片扫描件无文本层） */
    const [noText, setNoText] = useState(false)
    const pageTextsRef = useRef<string[]>([])
    const lastPageRef = useRef(-1)
    /** 页偏移缓存：滚动每秒触发数十次，读 offsetTop 会强制同步重排（layout thrashing）
     *  是 PDF 滚动卡顿的主因之一——页顶相对容器不变，按子元素数量失效即可 */
    const topsCacheRef = useRef<number[] | null>(null)

    // 各页相对滚动容器顶部的偏移（依赖 .pdf-page-wrap 的 minHeight）
    const getPageTops = useCallback((): number[] => {
      const sc = scrollRef.current
      if (!sc) return []
      const n = sc.children.length
      const cached = topsCacheRef.current
      if (cached && cached.length === n) return cached
      const tops = Array.from(sc.children).map((el) => (el as HTMLElement).offsetTop)
      topsCacheRef.current = tops
      return tops
    }, [])

    const getCurrentPage = useCallback((): number => {
      const sc = scrollRef.current
      const tops = getPageTops()
      if (!sc || !tops.length) return 0
      const mid = sc.scrollTop + sc.clientHeight / 2
      let idx = 0
      for (let i = 0; i < tops.length; i++) {
        if (tops[i] <= mid) idx = i
        else break
      }
      return idx
    }, [getPageTops])

    const getVisibleText = useCallback((): string => {
      const t = pageTextsRef.current
      if (!t.length) return ''
      let idx = getCurrentPage()
      if (idx >= t.length) idx = t.length - 1
      return [t[idx - 1] ?? '', t[idx] ?? '', t[idx + 1] ?? '']
        .filter(Boolean)
        .join('\n')
        .trim()
    }, [getCurrentPage])

    useImperativeHandle(ref, () => ({ getVisibleText, getCurrentPage }), [getVisibleText, getCurrentPage])

    /** 根据滚动位置计算可视缓冲范围；范围没变就不触发重渲染 */
    const updateRange = useCallback(() => {
      const sc = scrollRef.current
      const tops = getPageTops()
      if (!sc || !tops.length) return
      const mid = sc.scrollTop + sc.clientHeight / 2
      let idx = 0
      for (let i = 0; i < tops.length; i++) {
        if (tops[i] <= mid) idx = i
        else break
      }
      const s = Math.max(0, idx - CHUNK)
      const e = Math.min(tops.length - 1, idx + CHUNK)
      setRange((prev) => (prev[0] === s && prev[1] === e ? prev : [s, e]))
    }, [getPageTops])

    // 加载文档（幂等，重载时先摧毁旧文档）
    useEffect(() => {
      let alive = true
      let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
      setState({ loading: true, error: '', pages: 0 })
      setNoText(false)
      setPageProxies([])
      setRange([0, CHUNK])
      pageTextsRef.current = []
      lastPageRef.current = -1
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
          topsCacheRef.current = null // 新文档 → 页偏移缓存失效
          if (alive) setState((s) => ({ ...s, loading: false, pages: pages.length }))
          // 续读恢复：渲染完成后跳到上次阅读的页
          if (alive && initialPage > 0) {
            setTimeout(() => {
              const sc = scrollRef.current
              const tops = getPageTops()
              if (sc && tops.length) {
                sc.scrollTop = tops[Math.min(initialPage, tops.length - 1)]
                updateRange()
              }
            }, 60)
          }
          // 后台抽取逐页文本（渲染先行，不阻塞首屏）
          void (async () => {
            const texts: string[] = []
            for (let i = 1; i <= d.numPages && alive; i++) {
              try {
                const p = await d.getPage(i)
                const tc = await p.getTextContent()
                texts.push(tc.items.map((it) => ((it as { str?: string }).str ?? '')).join(''))
              } catch {
                texts.push('')
              }
            }
            if (!alive) return
            pageTextsRef.current = texts
            onTextReady?.(texts)
            const scanned = texts.length > 0 && !texts.some((t) => t.length > 0)
            setNoText(scanned)
            if (scanned) console.warn('PDF 未抽取到文本（可能是扫描件）')
          })()
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

    // 范围更新/窗口尺寸变化 → 重算可视范围
    useEffect(() => {
      if (!pageProxies.length) return
      topsCacheRef.current = null // scale 变化 → 页偏移变化，缓存失效
      const raf = requestAnimationFrame(updateRange)
      return () => cancelAnimationFrame(raf)
    }, [pageProxies.length, scale, updateRange])

    useEffect(() => {
      const onResize = () => updateRange()
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [updateRange])

    const handleScroll = useCallback(
      (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget
        if (onScroll && el.dataset.prevTop) {
          const delta = el.scrollTop - Number(el.dataset.prevTop)
          if (!isNaN(delta) && delta) onScroll(delta)
        }
        el.dataset.prevTop = String(el.scrollTop)
        updateRange()
        if (onPageChange) {
          const idx = getCurrentPage()
          if (idx !== lastPageRef.current) {
            lastPageRef.current = idx
            onPageChange(idx)
          }
        }
      },
      [onScroll, onPageChange, getCurrentPage, updateRange]
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
          {noText && (
            <div className="pdf-hint">
              这是图片扫描件，PDF 中没有可抽取的文本层，AI 角色看不到内容——建议换文字版 PDF，或复制正文粘贴到文本模式阅读
            </div>
          )}
          {pageProxies.map((p, i) => (
            <PdfPage key={p.pageNumber} page={p} scale={scale} visible={i >= range[0] && i <= range[1]} />
          ))}
        </div>
      </div>
    )
  })
)