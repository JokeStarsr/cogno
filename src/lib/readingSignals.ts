/** 按页语义的阅读信号层：翻页事件、每页停留/回读、翻页速率、冷静期。
 *  页的定义：PDF = 物理页索引；文本 = 视口中的虚拟页(以视口中线落点为当前页，
 *  与 PdfViewer.getCurrentPage 一致，天然抗边界抖动)。
 *  所有信号都按"页"计算 —— 页内滚动/抖动不再产生回读或滚动量，解决
 *  旧版 5 分钟绝对计数器把正常读误判成扫读/卡住的结构性问题。 */

interface PageVisit {
  dwellMs: number
  rereads: number
}

const TICK_MS = 2000
const TRANSITION_KEEP_MS = 5 * 60_000

export class ReadingEventTracker {
  private currentIdx = 0
  private entered = false
  private dwellMs = 0
  private visits = new Map<number, PageVisit>()
  private transitions: number[] = []
  private totalTransitions = 0
  private lastActionAt = Date.now()
  private visible = true

  reset() {
    this.currentIdx = 0
    this.entered = false
    this.dwellMs = 0
    this.visits.clear()
    this.transitions = []
    this.totalTransitions = 0
    this.lastActionAt = Date.now()
  }

  setPageVisible(v: boolean) {
    this.visible = v
  }

  /** 页切换/翻页事件（PDF onPageChange、文本虚拟页检测都会调）；首次进入不计数 */
  reportPage(idx: number) {
    const now = Date.now()
    if (idx < 0 || (this.entered && idx === this.currentIdx)) return
    if (this.entered) {
      // 离开旧页：结算停留
      const old = this.visits.get(this.currentIdx) ?? { dwellMs: 0, rereads: 0 }
      old.dwellMs += this.dwellMs
      // 再次进入访问过的页 = 回读（页内抖动已被页判定天然过滤）
      const re = this.visits.get(idx)
      if (re) re.rereads++
      this.transitions.push(now)
      this.totalTransitions++
    } else {
      this.entered = true
    }
    const v = this.visits.get(idx) ?? { dwellMs: 0, rereads: 0 }
    this.visits.set(idx, v)
    this.currentIdx = idx
    this.dwellMs = 0
    this.lastActionAt = now
    const cutoff = now - TRANSITION_KEEP_MS
    while (this.transitions.length && this.transitions[0] < cutoff) this.transitions.shift()
  }

  /** 滚动事件（任何滚动刷新冷静期；ReaderPage 的 onScroll 上报） */
  reportScroll() {
    this.lastActionAt = Date.now()
  }

  /** 文本模式虚拟页检测：scrollTop + 视口高 → 中线落页，跨页时触发 reportPage */
  setTextScroll(scrollTop: number, viewportH: number) {
    if (viewportH <= 0) return
    const idx = Math.floor((scrollTop + viewportH / 2) / viewportH)
    if (idx !== this.currentIdx) this.reportPage(idx)
  }

  /** 每 ~2s 由 ReaderPage 调用：页面可见时才累计当前页停留 */
  tick() {
    if (this.visible && this.entered) this.dwellMs += TICK_MS
  }

  currentPage(): number {
    return this.currentIdx
  }

  /** 当前页停留秒数 */
  pageDwellSec(): number {
    return Math.round(this.dwellMs / 1000)
  }

  /** 当前页回读次数（离开后再次进入这一页的累计） */
  pageRereads(): number {
    return this.visits.get(this.currentIdx)?.rereads ?? 0
  }

  /** 近 windowMs 内翻页速率（页/分钟） */
  pageRatePerMin(windowMs: number): number {
    const cutoff = Date.now() - windowMs
    const n = this.transitions.filter((t) => t >= cutoff).length
    return n / (windowMs / 60_000)
  }

  lastActionSec(): number {
    return Math.round((Date.now() - this.lastActionAt) / 1000)
  }

  /** 冷静期判定：最近一次翻页/滚动距今超过 calmSec */
  isCalm(calmSec: number): boolean {
    return Date.now() - this.lastActionAt > calmSec * 1000
  }

  /** 会话内总翻页数（基线用） */
  totalPagesTurned(): number {
    return this.totalTransitions
  }
}

// ── 个人阅读基线（localStorage）：最近 3 篇文档的翻页速率习惯 ──

const BASE_KEY = 'cogno.readingBaseline'
const BASE_MAX = 3

interface BaselineEntry {
  title: string
  rate: number
  ts: number
}

function loadList(): BaselineEntry[] {
  try {
    const raw = localStorage.getItem(BASE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as BaselineEntry[]
    return Array.isArray(arr) ? arr.filter((e) => typeof e?.rate === 'number') : []
  } catch {
    return []
  }
}

/** 会话结束时记录一篇文档的翻页速率；时长过短(可疑)或速率为 0 的样本丢弃 */
export function recordBaseline(title: string, rate: number, durationSec: number): void {
  if (!title || !Number.isFinite(rate) || rate <= 0 || durationSec < 120) return
  try {
    const list = [...loadList().filter((e) => e.title !== title), { title, rate, ts: Date.now() }]
    localStorage.setItem(BASE_KEY, JSON.stringify(list.slice(-BASE_MAX)))
  } catch {
    /* localStorage 不可用(隐私模式等)时静默跳过 */
  }
}

/** 个人基线：≥2 篇样本才启用，取最近样本平均（页/分） */
export function loadBaselineRate(): number | null {
  const list = loadList()
  if (list.length < 2) return null
  const sum = list.reduce((a, e) => a + e.rate, 0)
  return sum / list.length
}

/** 设置页展示用：当前基线值与样本数 */
export function baselineStatus(): { rate: number | null; n: number } {
  const list = loadList()
  return { rate: loadBaselineRate(), n: list.length }
}