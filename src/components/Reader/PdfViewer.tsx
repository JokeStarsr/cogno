import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { renderPageToCanvas, recognizePage, recognizePageVision, VISION_MODEL } from '../../lib/ocr'
import type { LLMConfig } from '../../types'
import { nearbyNonEmptyText } from '../../lib/pdfText'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export interface PdfHandle {
  /** 视口中部所在页及其前后页的抽取文本（供代理取上下文） */
  getVisibleText: () => string
  getCurrentPage: () => number
}

interface Props {
  file: File
  onScroll?: (deltaPx: number) => void
  /** PDF 逐页文本就绪/更新（代理上下文 + 概念检测 + OCR 逐页回填都用它） */
  onTextReady?: (pages: string[]) => void
  /** 滚动跨越页面时上报当前页索引（0-based） */
  onPageChange?: (pageIndex: number) => void
  /** 续读恢复：加载完成后跳转到的页索引（0-based），默认 0 */
  initialPage?: number
  /** 续读恢复：已保存的逐页文本（含上次 OCR 结果），跳过重复识别 */
  initialTexts?: string[]
  /** 已配置的 AI 端点（有值时扫描件 OCR 优先走 qwen 视觉模型，失败自动降级本地 tesseract） */
  visionCfg?: LLMConfig | null
}

/** 视口外缓冲页数：渲染范围 = 当前页 ±CHUNK */
const CHUNK = 2
/** OCR 渲染放大倍数（扫描件清晰度不足时识别更稳） */
const OCR_SCALE = 2

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
  forwardRef<PdfHandle, Props>(function PdfViewer(
    { file, onScroll, onTextReady, onPageChange, initialPage = 0, initialTexts, visionCfg },
    ref
  ) {
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
    /** 整本缺文本层（扫描件）时的 OCR 进度；idle = 未开始 */
    const [ocr, setOcr] = useState<{
      running: boolean
      done: number
      total: number
      pageProgress: number
      error: string
      /** 识别完成后仍未出文字的页数（排版/清晰度原因），供完成提示 */
      remainingEmpty: number
      /** 当前引擎：ai = qwen 视觉模型，local = tesseract（AI 失败自动降级） */
      engine: 'ai' | 'local'
    }>({ running: false, done: 0, total: 0, pageProgress: 0, error: '', remainingEmpty: 0, engine: 'local' })
    const pageTextsRef = useRef<string[]>([])
    const lastPageRef = useRef(-1)
    /** OCR 回填的页文本（与抽取文本合并后的全量数组） */
    const ocrSessionCacheRef = useRef<string[] | null>(null)
    /** OCR 循环取消令牌：换文件/卸载/跳过后 +1 使循环中止 */
    const ocrTokenRef = useRef(0)
    /** 当前 OCR 引擎（ai 失败自动降级 local；ref 供循环内同步判断） */
    const engineRef = useRef<'ai' | 'local'>('local')
    /** 页偏移缓存：滚动每秒触发数十次，读 offsetTop 会强制同步重排（layout thrashing）
     *  是 PDF 滚动卡顿的主因之一——页顶相对容器不变，按子元素数量失效即可 */
    const topsCacheRef = useRef<number[] | null>(null)

    // 各页相对滚动容器顶部的偏移（依赖 .pdf-page-wrap 的 minHeight）。
    // 只统计页 wrapper：加载提示/OCR 进度这些 .pdf-hint 也是容器子元素，
    // 混入会让页定位整体错位（此前 OCR 进行中"看不到正文"的根因之一）
    const getPageTops = useCallback((): number[] => {
      const sc = scrollRef.current
      if (!sc) return []
      const wraps = Array.from(sc.querySelectorAll('.pdf-page-wrap'))
      const n = wraps.length
      const cached = topsCacheRef.current
      if (cached && cached.length === n) return cached
      const tops = wraps.map((el) => (el as HTMLElement).offsetTop)
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

    /** 当前页附近「已识别」的正文（抽取未完成/OCR 排队时自动回退到最近非空页） */
    const getVisibleText = useCallback((): string => {
      const t = pageTextsRef.current
      const near = nearbyNonEmptyText(t, getCurrentPage(), 3)
      return near?.text ?? ''
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

    /** 扫描件 OCR 起跑：把"缺文本"的页逐页识别后回填 */
    const startOcr = useCallback(
      (d: pdfjsLib.PDFDocumentProxy, pages: string[]) => {
        const missing: number[] = []
        for (let i = 0; i < pages.length; i++) if (!pages[i]) missing.push(i)
        if (!missing.length) return
        // 读者附近的页优先识别：OCR 排队时先出"当前正在读的内容"，再补全书
        const currentIdx = getCurrentPage()
        missing.sort((a, b) => Math.abs(a - currentIdx) - Math.abs(b - currentIdx))
        const token = ++ocrTokenRef.current
        engineRef.current = visionCfg ? 'ai' : 'local'
        setOcr({
          running: true,
          done: 0,
          total: missing.length,
          pageProgress: 0,
          error: '',
          remainingEmpty: 0,
          engine: engineRef.current,
        })
        void (async () => {
          let done = 0
          /** 连续识别为空的页（模型对特殊版式会整页白给），连续 3 页即暂停，不空转 */
          let emptyStreak = 0
          /** AI 视觉连续失败次数：≥2 即整体降级 tesseract，避免每页白跑一次视觉请求 */
          let visionFails = 0
          for (const idx of missing) {
            if (ocrTokenRef.current !== token) return
            try {
              const p = await d.getPage(idx + 1)
              const canvas = await renderPageToCanvas(p, OCR_SCALE)
              const setProg = (prog: number) => {
                if (ocrTokenRef.current === token) setOcr((o) => ({ ...o, pageProgress: prog }))
              }
              let text = ''
              if (engineRef.current === 'ai' && visionCfg) {
                try {
                  text = await recognizePageVision(canvas, visionCfg, VISION_MODEL)
                } catch (e) {
                  visionFails++
                  console.warn('AI 视觉识别第', idx + 1, '页失败，尝试本地识别', e)
                  if (visionFails >= 2) {
                    engineRef.current = 'local'
                    setOcr((o) => ({ ...o, engine: 'local' }))
                  }
                }
              }
              if (!text) {
                // AI 未配置/失败/空结果 → 本页退回 tesseract（每页渲染一次,双引擎共用）
                text = await recognizePage(canvas, setProg)
              }
              const next = [...pages]
              next[idx] = text
              pages = next
              pageTextsRef.current = next
              ocrSessionCacheRef.current = next
              // 逐页回填：概念扫描与代理解说立刻能看到新识别内容
              onTextReady?.(next)
              if (!text) {
                emptyStreak++
                done++
                setOcr((o) => ({ ...o, done, pageProgress: 0 }))
                if (emptyStreak >= 3) {
                  setOcr((o) => ({
                    ...o,
                    running: false,
                    error: `连续 ${emptyStreak} 页识别结果为空（书页排版或清晰度原因），已暂停。`,
                  }))
                  return
                }
                continue
              }
              emptyStreak = 0
              done++
              setOcr((o) => ({ ...o, done, pageProgress: 0 }))
            } catch (e) {
              console.error('OCR 第', idx + 1, '页失败', e)
              setOcr((o) => ({
                ...o,
                error: e instanceof Error ? e.message : 'OCR 识别失败',
                running: false,
              }))
              return
            }
          }
          // 自然完成：统计仍未识别的页数，供完成提示使用
          const remainingEmpty = pages.filter((t, i) => !t && missing.includes(i)).length
          setOcr((o) => ({ ...o, running: false, remainingEmpty }))
        })()
      },
      [getCurrentPage, onTextReady]
    )

    // 加载文档（幂等，重载时先摧毁旧文档）
    useEffect(() => {
      let alive = true
      let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
      setState({ loading: true, error: '', pages: 0 })
      setOcr({
        running: false,
        done: 0,
        total: 0,
        pageProgress: 0,
        error: '',
        remainingEmpty: 0,
        engine: 'local',
      })
      setPageProxies([])
      setRange([0, CHUNK])
      ocrTokenRef.current++ // 中断上一份文档的 OCR 循环
      // 续读恢复：先用已保存文本（含上次 OCR 结果）填充，新抽取/OCR 只补缺页。
      // 立即生效：加载与抽取完成前，代理上下文也能立刻读到已存正文
      const seeded: string[] = initialTexts?.length ? [...initialTexts] : []
      pageTextsRef.current = seeded
      ocrSessionCacheRef.current = seeded.length ? seeded : null
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
            for (let i = 0; i < d.numPages && alive; i++) {
              try {
                const p = await d.getPage(i + 1)
                const tc = await p.getTextContent()
                texts.push(tc.items.map((it) => ((it as { str?: string }).str ?? '')).join(''))
              } catch {
                texts.push('')
              }
            }
            if (!alive) return
            // 合并续读存的旧文本：只保留文本层未能提供的那部分页
            const merged = seeded.map((t, i) => texts[i] ?? t)
            // 缺失页补 seeded（新文档则整数组为抽取结果）
            const pagesMerged = texts.length > 0 ? merged : seeded
            pagesMerged.length = d.numPages
            pageTextsRef.current = pagesMerged
            ocrSessionCacheRef.current = pagesMerged
            onTextReady?.(pagesMerged)
            const missingCount = pagesMerged.filter((t) => !t).length
            const allEmpty = missingCount === pagesMerged.length
            if (allEmpty) {
              // 整本无文本层：启动 OCR（扫描件也能读）
              startOcr(d, pagesMerged)
            } else if (missingCount > 0) {
              // 混排文档：文本层缺页也 OCR 补上
              startOcr(d, pagesMerged)
            }
          })()
        } catch (e) {
          if (alive) setState({ loading: false, error: (e as Error).message, pages: 0 })
        }
      }
      void load()
      return () => {
        alive = false
        ocrTokenRef.current++
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
          {ocr.running && (
            <div className="pdf-hint ocr">
              <span>
                {ocr.total > 0
                  ? ocr.engine === 'ai'
                    ? `扫描件 AI 视觉识别中：${ocr.done}/${ocr.total} 页完成，本页识别中`
                    : `扫描件本地识别中：${ocr.done}/${ocr.total} 页完成，本页 ${Math.round(ocr.pageProgress * 100)}%`
                  : '准备 OCR…'}
              </span>
              <span className="ocr-sub">
                {ocr.engine === 'ai'
                  ? 'AI 视觉识别效果最佳，按页计费；结果自动保存，下次打开即时可用'
                  : '本地 tesseract 识别（免费）；结果自动保存，下次打开即时可用'}
              </span>
              <button
                className="btn-ghost"
                onClick={() => {
                  ocrTokenRef.current++
                  setOcr((o) => ({ ...o, running: false }))
                }}
              >
                跳过
              </button>
            </div>
          )}
          {ocr.error && !ocr.running && (
            <div className="pdf-hint error">
              扫描件 OCR 已暂停：{ocr.error}。可换文字版 PDF，或复制正文粘贴到文本模式。
            </div>
          )}
          {!ocr.running && !ocr.error && ocr.remainingEmpty > 0 && (
            <div className="pdf-hint warn">
              全书识别完成，仍有 {ocr.remainingEmpty} 页未能识别出文字（书页排版或清晰度原因）。
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