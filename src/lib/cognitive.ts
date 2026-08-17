import type { CognitiveState, GazePoint } from '../types'
import type { BehavioralSnapshot } from './behavioralSignals'

/**
 * 认知引擎（Phase 3.1 多信号融合）：
 * 把三类信号按权重混合推断认知状态——
 *   gaze(眼动注视) / mouse(鼠标阅读区占比) / behavioral(选中/复制/走神/停留)
 * 任一信号源不可用时，权重自动按比例再分配（无摄像头 → gaze 份额分给 mouse+behavioral），
 * 保证手机/平板/纯键盘场景也能得到合理推断。规则引擎 + 指数平滑。
 */
const SAMPLE_WINDOW = 12000 // 分析窗口 ms
const SMOOTHING = 0.3
const MAX_DELTA = 12 // 每次状态变化上限，避免"抖动"

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

/** 三类信号源的默认权重（和为 1）。对外暴露，设置页未来可调 */
export const DEFAULT_SIGNAL_WEIGHTS = { gaze: 0.5, mouse: 0.25, behavioral: 0.25 }

export type AvailableSignals = { gaze: boolean; mouse: boolean; behavioral: boolean }

export class CognitiveEngine {
  private samples: GazePoint[] = []
  private state: CognitiveState = {
    understanding: 45,
    attention: 55,
    fatigue: 12,
    divergence: 30,
    flow: false,
  }
  private flowSustainedMs = 0
  private lowAttentionSince = 0
  private scrollPx = 0
  /** 阅读容器内点占比（gaze 判定） */
  private inArea = 0.85
  private readingBounds: { left: number; right: number; top: number; bottom: number } | null = null
  /** 页面是否可见(切标签/失焦 = 走神信号) */
  private pageVisible = true
  /** 5 分钟窗口的触发统计（触发判定已按页语义重构，见 readingSignals.ts） */
  private regressions5m: number[] = []
  private scrollHistory: { px: number; ts: number }[] = []
  private lastScrollDelta = 0
  /** 最近一次 BehavioralSnapshot（2s 循环推进） */
  private behavioral: BehavioralSnapshot | null = null
  private weights = { ...DEFAULT_SIGNAL_WEIGHTS }
  private signalOpts: AvailableSignals = { gaze: true, mouse: true, behavioral: true }

  setReadingBounds(b: { left: number; right: number; top: number; bottom: number } | null) {
    this.readingBounds = b
  }

  pushGaze(g: GazePoint) {
    this.samples.push(g)
    const cutoff = g.ts - SAMPLE_WINDOW
    while (this.samples.length && this.samples[0].ts < cutoff) this.samples.shift()
  }

  setPageVisible(v: boolean) {
    this.pageVisible = v
  }

  /** 推送行为信号快照（ReaderPage 认知循环每 2s 调一次；null 表示无行为数据源） */
  pushBehavioralSignals(signals: BehavioralSnapshot | null) {
    this.behavioral = signals
  }

  /** 手动声明信号源可用性（如相机授权被拒时由 UI 关闭 gaze）；自动失效仍按样本数兜底 */
  setAvailableSignals(avail: AvailableSignals) {
    this.signalOpts = avail
  }

  pushScroll(deltaPx: number) {
    this.scrollPx += Math.abs(deltaPx)
    this.scrollHistory.push({ px: Math.abs(deltaPx), ts: Date.now() })
    // 滚动方向反转 = 回看上文(回滚信号,文档中"困惑=100%"的信号)
    if (deltaPx * this.lastScrollDelta < 0) {
      this.regressions5m.push(Date.now())
    }
    this.lastScrollDelta = deltaPx
    const fiveMin = Date.now() - 5 * 60_000
    this.scrollHistory = this.scrollHistory.filter((s) => s.ts > fiveMin)
    this.regressions5m = this.regressions5m.filter((t) => t > fiveMin)
  }

  private inReadingArea(g: GazePoint): boolean {
    const b = this.readingBounds
    if (!b) return true
    return g.x >= b.left && g.x <= b.right && g.y >= b.top && g.y <= b.bottom
  }

  /**
   * 实际生效的信号权重：样本不足(<4)视为 gaze 不可用、
   * 无鼠标采样视为 mouse 不可用；不可用信号的份额按剩余信号比例再分配。
   */
  private effectiveWeights(n: number): { gaze: number; mouse: number; behavioral: number } {
    const gazeOk = this.signalOpts.gaze && n >= 4
    const b = this.behavioral
    const mouseOk = this.signalOpts.mouse && b != null && b.mouseInAreaRatio != null
    const behOk = this.signalOpts.behavioral && b != null
    let w = { ...this.weights }
    if (!gazeOk) w.gaze = 0
    if (!mouseOk) w.mouse = 0
    if (!behOk) w.behavioral = 0
    const total = w.gaze + w.mouse + w.behavioral
    if (total <= 0) {
      // 所有信号都不可用：退回无信号基线（纯滚动规则）
      return { gaze: 0, mouse: 0.5, behavioral: 0.5 }
    }
    if (total < 1) {
      w.gaze /= total
      w.mouse /= total
      w.behavioral /= total
    }
    return w
  }

  /** 每 ~2s 调用一次，重算状态（samples 已在 pushGaze 时窗口裁剪，无需再 filter） */
  recompute(): CognitiveState {
    const now = Date.now()
    const win = this.samples
    const n = win.length
    const b = this.behavioral ?? {
      selectionCount: 0,
      selectionChars: 0,
      copyCount: 0,
      blurCount: 0,
      pageHiddenMs: 0,
      mouseInAreaRatio: null,
    }
    const w = this.effectiveWeights(n)

    let understanding = this.state.understanding
    let attention = this.state.attention
    let fatigue = this.state.fatigue
    let divergence = this.state.divergence

    // ── 滚动信号(不依赖注视，始终计算 —— 手机/无相机也能工作) ──
    const scrollRate = this.scrollPx / (SAMPLE_WINDOW / 1000)
    this.scrollPx = 0
    const fiveMin = now - 5 * 60_000
    this.regressions5m = this.regressions5m.filter((t) => t > fiveMin)
    const scrollReg = this.regressions5m.filter((t) => t > now - SAMPLE_WINDOW).length

    let inArea = this.inArea
    let stable = 50
    let gazeRegressionRate = 0
    let spread = 0

    if (n >= 4) {
      let inAreaC = 0
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const g of win) {
        if (this.inReadingArea(g)) inAreaC++
        minX = Math.min(minX, g.x); maxX = Math.max(maxX, g.x)
        minY = Math.min(minY, g.y); maxY = Math.max(maxY, g.y)
      }
      inArea = inAreaC / n
      this.inArea = inArea
      spread = Math.min(100, ((maxX - minX) * (maxY - minY)) / 250000 * 100)

      let regressions = 0
      for (let i = 1; i < win.length; i++) {
        if (win[i].y < win[i - 1].y - 30) {
          regressions++
          this.regressions5m.push(now)
        }
      }
      gazeRegressionRate = regressions / n
      this.regressions5m = this.regressions5m.filter((t) => t > fiveMin)

      const meanY = win.reduce((a, s) => a + s.y, 0) / n
      const varY = win.reduce((a, s) => a + (s.y - meanY) ** 2, 0) / n
      stable = clamp(100 - Math.sqrt(varY) * 1.6)
    }

    // ── 分信号源的理解深度 ──
    // gaze 分量：适度回读 = 认真理解；过度滚动 = 浅层扫描（无注视时的基线抬高由滚动回归贡献）
    const gazeUnderstanding =
      n >= 4
        ? clamp(45 + (clamp(gazeRegressionRate * 340 + scrollReg * 8) - 10) * 1.1 + (stable - 55) * 0.55)
        : clamp(45 + scrollReg * 8)
    // mouse 分量：鼠标持续在阅读区内提示专注
    const mouseFocus = clamp((b.mouseInAreaRatio ?? 0.85) * 100)
    const mouseUnderstanding = clamp(40 + (mouseFocus - 50) * 0.6 + scrollReg * 8)
    // behavioral 分量：选中/复制 = 深度加工(正向)；失焦/页面隐藏 = 走神(负向)
    const pageHiddenSec = b.pageHiddenMs / 1000
    const behavioralUnderstanding = clamp(
      45 + b.selectionCount * 3 + b.copyCount * 6 - b.blurCount * 5 - pageHiddenSec * 0.4
    )

    const scrollPenalty = clamp(scrollRate / 900 * 100)
    understanding = clamp(
      w.gaze * gazeUnderstanding + w.mouse * mouseUnderstanding + w.behavioral * behavioralUnderstanding
        - scrollPenalty * 0.5
    )

    // ── 注意力：gaze 区域占比 / mouse 区域占比 / 可见性 加权混合 ──
    const gazeFocus = inArea * 100
    const areaFocus = w.gaze * gazeFocus + w.mouse * mouseFocus + w.behavioral * 50
    const visibility = this.pageVisible ? 0 : 30
    attention = clamp(areaFocus * 0.65 + stable * 0.3 * (w.gaze > 0 ? 1 : 0) + (1 - divergence / 100) * 5 - visibility)

    // ── 疲劳：注意力长期低 + 页面长时间隐藏 ──
    if (attention < 45 || !this.pageVisible) {
      if (!this.lowAttentionSince) this.lowAttentionSince = now
    } else {
      this.lowAttentionSince = 0
    }
    if (this.lowAttentionSince && now - this.lowAttentionSince > 90_000) {
      fatigue = clamp(fatigue + 3.2 + (1 - attention / 100) * 2.5)
    } else if (!this.pageVisible) {
      fatigue = clamp(fatigue + 1.5)
    } else {
      fatigue = clamp(fatigue - 0.7)
    }

    // ── 心流：高理解+高注意+低疲劳持续 5 分钟 ──
    if (understanding > 62 && attention > 62 && fatigue < 35) {
      this.flowSustainedMs += 2000
    } else {
      this.flowSustainedMs = Math.max(0, this.flowSustainedMs - 4000)
    }
    const flow = this.flowSustainedMs >= 300_000

    // 发散度仅由注视决定（无注视保持当前值）
    if (n >= 4) {
      divergence = clamp(35 + spread * 1.4)
    }

    // 平滑 + 限幅，避免抖动
    const next: CognitiveState = {
      understanding: this.smooth('understanding', understanding),
      attention: this.smooth('attention', attention),
      fatigue: this.smooth('fatigue', fatigue),
      divergence: this.smooth('divergence', divergence),
      flow,
    }
    this.state = next
    return { ...next }
  }

  private smooth(key: keyof CognitiveState, target: number): number {
    const cur = this.state[key] as number
    const raw = cur + (target - cur) * SMOOTHING
    const delta = Math.abs(raw - cur)
    if (delta > MAX_DELTA) {
      return clamp(raw > cur ? cur + MAX_DELTA : cur - MAX_DELTA)
    }
    return clamp(raw)
  }

  getState(): CognitiveState {
    return { ...this.state }
  }
}