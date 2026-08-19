/**
 * 扫描件 PDF 的浏览器端 OCR（tesseract.js，资源自托管在 public/ocr/）。
 * 同源加载 worker + wasm 核心 + chi_sim/eng 语言包，国内网络不依赖 CDN。
 * 库本体动态 import，OCR 首次触发才加载，不影响主包体积。
 */
import type { PDFPageProxy } from 'pdfjs-dist/types/src/pdf'
import { chatCompletionVision } from './llm'
import type { LLMConfig } from '../types'

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

// ── AI 视觉识别（qwen3.7-plus 经 sub2api，中文书页识别效果远好于 tesseract）──

/** 视觉模型名：sub2api(服务器)→阿里 token-plan 的 qwen3.7-plus 直通名（白名单外模型会 404/拒收） */
export const VISION_MODEL = 'qwen3.7-plus'

/** 识别提示词：要求只输出正文、保留段落、忽略页眉页脚页码 */
export const VISION_PROMPT =
  '这是一本书的扫描页图片。请完整识别图中全部正文文字，保留段落换行；不要页眉页脚和页码；只输出识别到的原文，不要任何解释或补充。'

/** 视觉输入长边上限：超过则等比缩小（一页 1280 长边足以识别印刷体，且控制 token 成本） */
export const VISION_CAP = 1280

/** canvas → JPEG data URL（超过长边上限先等比缩小） */
export async function canvasToJpegDataUrl(
  canvas: HTMLCanvasElement,
  cap = VISION_CAP
): Promise<string> {
  const long = Math.max(canvas.width, canvas.height)
  if (long > cap) {
    const scale = cap / long
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(canvas.width * scale))
    out.height = Math.max(1, Math.round(canvas.height * scale))
    const ctx = out.getContext('2d')
    if (!ctx) throw new Error('无法创建 2D canvas，AI 视觉识别不可用')
    ctx.drawImage(canvas, 0, 0, out.width, out.height)
    return out.toDataURL('image/jpeg', 0.8)
  }
  return canvas.toDataURL('image/jpeg', 0.8)
}

/** 用视觉模型识别一页（失败抛 LLMError，由调用方决定降级 tesseract 或暂停） */
export async function recognizePageVision(
  canvas: HTMLCanvasElement,
  cfg: LLMConfig,
  model = VISION_MODEL
): Promise<string> {
  const dataUrl = await canvasToJpegDataUrl(canvas)
  const text = await chatCompletionVision(cfg, VISION_PROMPT, dataUrl, { model })
  return text.trim()
}