/**
 * 行为信号层（Phase 3.1 多信号融合的一部分）：
 * 在眼动(注视点)之外，跟踪非摄像头信号——文本选中、复制、页面可见性、
 * 窗口失焦、鼠标在阅读区的停留占比。无摄像头/手机/平板上这些信号是
 * 认知推断的主要来源（配合 readingSignals 的页事件流）。
 *
 * 线程模型：事件监听回调只写计数，getSnapshot() 由 ReaderPage 的
 * 2s 认知循环拉取，不额外起定时器。
 */

export interface BehavioralSnapshot {
  /** 窗口内文本选中次数（选中长度 ≥ 2 字符才计数，点按清空不算） */
  selectionCount: number
  /** 窗口内选中字符总量 */
  selectionChars: number
  /** 窗口内复制次数（深度阅读强信号） */
  copyCount: number
  /** 窗口内窗口失焦次数（切走 = 走神） */
  blurCount: number
  /** 窗口内页面隐藏毫秒（切标签累计） */
  pageHiddenMs: number
  /** 鼠标采样中落在阅读区内的占比 0-1；无数据时为 null */
  mouseInAreaRatio: number | null
}

interface WindowedCounter {
  events: number[]
  chars: number
}

const RESET_MS = 12_000 // 与 cognitive 分析窗口一致

export class BehavioralSignalTracker {
  private selections: WindowedCounter = { events: [], chars: 0 }
  private copies: WindowedCounter = { events: [], chars: 0 }
  private blurs: WindowedCounter = { events: [], chars: 0 }
  private hiddenStartAt: number | null = null
  private hiddenMsAccum = 0
  private mouseIn = 0
  private mouseTotal = 0
  private readingEl: HTMLElement | null = null
  private lastSelectionLen = 0
  private attached = false

  /** 绑定阅读区容器（鼠标占比以它为界）；切换文档时重绑 */
  attachReadingArea(el: HTMLElement | null) {
    this.readingEl = el
    this.mouseIn = 0
    this.mouseTotal = 0
  }

  /** 启动事件监听（ReaderPage mount 时调用一次） */
  attach() {
    if (this.attached) return
    this.attached = true
    document.addEventListener('selectionchange', this.onSelection)
    document.addEventListener('copy', this.onCopy)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('mousemove', this.onMouseMove)
  }

  detach() {
    if (!this.attached) return
    this.attached = false
    document.removeEventListener('selectionchange', this.onSelection)
    document.removeEventListener('copy', this.onCopy)
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('mousemove', this.onMouseMove)
    this.readingEl = null
  }

  /** 拉取当前窗口快照（每次调用后重置累计值，供 2s 循环消费） */
  getSnapshot(): BehavioralSnapshot {
    const now = Date.now()
    const cutoff = now - RESET_MS
    const trim = (c: WindowedCounter) => {
      c.events = c.events.filter((t) => t > cutoff)
    }
    trim(this.selections)
    trim(this.copies)
    trim(this.blurs)

    // 页面当前隐藏时段并入累计
    if (this.hiddenStartAt !== null) {
      this.hiddenMsAccum += now - this.hiddenStartAt
      this.hiddenStartAt = now
    }

    // 消费语义：取完即清，下一次拉取是全新的窗口（避免同事件被 2s 循环重复累计）
    const snap: BehavioralSnapshot = {
      selectionCount: this.selections.events.length,
      selectionChars: this.selections.chars,
      copyCount: this.copies.events.length,
      blurCount: this.blurs.events.length,
      pageHiddenMs: this.hiddenMsAccum,
      mouseInAreaRatio:
        this.mouseTotal > 10 ? this.mouseIn / this.mouseTotal : null, // <10 次采样视为无数据
    }
    this.selections = { events: [], chars: 0 }
    this.copies = { events: [], chars: 0 }
    this.blurs = { events: [], chars: 0 }
    this.hiddenMsAccum = 0
    this.mouseIn = 0
    this.mouseTotal = 0
    return snap
  }

  // ── 事件回调 ──

  private onSelection = () => {
    const sel = window.getSelection()
    const len = sel ? sel.toString().trim().length : 0
    if (len < 2) return // 点按/方向键触发的空选择不计
    this.selections.events.push(Date.now())
    this.selections.chars += len
    this.lastSelectionLen = len
  }

  private onCopy = () => {
    this.copies.events.push(Date.now())
    this.copies.chars += this.lastSelectionLen
  }

  private onVisibility = () => {
    if (document.hidden) {
      this.hiddenStartAt = Date.now()
    } else if (this.hiddenStartAt !== null) {
      this.hiddenMsAccum += Date.now() - this.hiddenStartAt
      this.hiddenStartAt = null
    }
  }

  private onBlur = () => {
    this.blurs.events.push(Date.now())
  }

  private onMouseMove = (e: MouseEvent) => {
    this.mouseTotal++
    if (!this.readingEl) return
    const r = this.readingEl.getBoundingClientRect()
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      this.mouseIn++
    }
  }
}