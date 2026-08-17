/**
 * 扫描件 PDF 的浏览器端 OCR（tesseract.js，资源自托管在 public/ocr/）。
 * 同源加载 worker + wasm 核心 + chi_sim/eng 语言包，国内网络不依赖 CDN。
 * 库本体动态 import，OCR 首次触发才加载，不影响主包体积。
 */
import type { PDFPageProxy } from 'pdfjs-dist/types/src/pdf'

const OCR_BASE = `${import.meta.env.BASE_URL}ocr/`
/** 中文书籍为主，混合加载中英文 */
export const OCR_LANGS = 'chi_sim+eng'
/** tesseract PSM.AUTO 恒为 3（分页模式自动判断，书籍单栏/双栏均适用） */
const PSM_AUTO = 3

type OcrLogger = (m: { status: string; progress?: number }) => void
type WorkerLike = {
  setParameters: (p: Record<string, unknown>) => Promise<void>
  recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>
}

/** 单页识别进度回调（模块级单听者：OCR 任务串行执行，不会并发抢占） */
let progListener: ((p: number) => void) | null = null

let workerPromise: Promise<WorkerLike> | null = null

/** 幂等创建全局 OCR worker（首次创建加载 ~13MB 本地资源，之后复用） */
export function getOcrWorker(): Promise<WorkerLike> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(async ({ createWorker }) => {
      const logger: OcrLogger = (m) => {
        if (m.status === 'recognizing text' && progListener) progListener(m.progress ?? 0)
      }
      const w = await createWorker(OCR_LANGS, 1, {
        workerPath: `${OCR_BASE}worker.min.js`,
        corePath: OCR_BASE,
        langPath: OCR_BASE,
        logger,
      })
      // Worker 类型定义较大，此处只需 setParameters + recognize 两个调用面
      return w as unknown as WorkerLike
    }).catch((e) => {
      workerPromise = null // 失败可重试（下次调用重新创建）
      throw e
    })
  }
  return workerPromise
}

/** 页码范围渲染函数的最小接口（pdfjs PDFPageProxy 子集） */
export type OcrPageLike = Pick<PDFPageProxy, 'getViewport' | 'render'>

/** 把 PDF 页渲染成离屏 canvas（OCR 输入） */
export async function renderPageToCanvas(page: OcrPageLike, scale = 2): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器无法创建 2D canvas，OCR 不可用')
  await page.render({ canvasContext: ctx, viewport })
  return canvas
}

/**
 * 识别一页 canvas 上的文字。
 * @param onProgress 该页识别进度 0..1（可选）
 */
export async function recognizePage(
  canvas: HTMLCanvasElement,
  onProgress?: (p: number) => void
): Promise<string> {
  const worker = await getOcrWorker()
  await worker.setParameters({ tessedit_pageseg_mode: PSM_AUTO })
  progListener = onProgress ?? null
  try {
    const { data } = await worker.recognize(canvas)
    return data.text.trim()
  } finally {
    progListener = null
  }
}