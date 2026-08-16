import type { CognitiveState, GazePoint } from '../types'

/** 用眼动 + 阅读行为推断认知状态，规则引擎 + 指数平滑 */
const SAMPLE_WINDOW = 12000 // 分析窗口 ms
const SMOOTHING = 0.3
const MAX_DELTA = 12 // 每次状态变化上限，避免"抖动"

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

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
  /** 阅读容器内点占比 */
  private inArea = 0.85
  private readingBounds: { left: number; right: number; top: number; bottom: number } | null = null
  /** 页面是否可见(切标签/失焦 = 走神信号) */
  private pageVisible = true
  /** 5 分钟窗口的触发统计（触发判定已按页语义重构，见 readingSignals.ts） */
  private regressions5m: number[] = []
  private scrollHistory: { px: number; ts: number }[] = []
  private lastScrollDelta = 0

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

  /** 每 ~2s 调用一次，重算状态 */
  recompute(): CognitiveState {
    const now = Date.now()
    const win = this.samples.filter((s) => now - s.ts < SAMPLE_WINDOW)
    const n = win.length

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

    if (n >= 4) {
      // ── 注视集中度 / 发散度 ──
      let inAreaC = 0
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const g of win) {
        if (this.inReadingArea(g)) inAreaC++
        minX = Math.min(minX, g.x); maxX = Math.max(maxX, g.x)
        minY = Math.min(minY, g.y); maxY = Math.max(maxY, g.y)
      }
      inArea = inAreaC / n
      this.inArea = inArea
      const spread = Math.min(100, ((maxX - minX) * (maxY - minY)) / 250000 * 100)
      divergence = clamp(35 + spread * 1.4)

      // ── 回读与眼跳回归：理解深度的核心信号 ──
      let regressions = 0
      for (let i = 1; i < win.length; i++) {
        // 阅读流自上而下，y 突然减小 = 回看上文
        if (win[i].y < win[i - 1].y - 30) {
          regressions++
          this.regressions5m.push(now)
        }
      }
      gazeRegressionRate = regressions / n
      this.regressions5m = this.regressions5m.filter((t) => t > fiveMin)

      // 停留稳定性：注视 y 的波动
      const meanY = win.reduce((a, s) => a + s.y, 0) / n
      const varY = win.reduce((a, s) => a + (s.y - meanY) ** 2, 0) / n
      stable = clamp(100 - Math.sqrt(varY) * 1.6)
    }

    // ── 理解深度 ──
    // 适度回读 = 认真理解；过度滚动 = 浅层扫描
    // 无注视时以正常阅读为基线，滚动回滚次数推高理解度
    const rereadFactor =
      n >= 4 ? clamp(gazeRegressionRate * 340 + scrollReg * 8) : clamp(10 + scrollReg * 8)
    const scrollPenalty = clamp(scrollRate / 900 * 100)
    understanding = clamp(
      45 + (rereadFactor - 10) * 1.1 + (stable - 55) * 0.55 - scrollPenalty * 0.5
    )

    // ── 注意力：注视区占比 + 稳定性 + 页面是否可见 ──
    // 页面隐藏(切标签/失焦) = 走神，attention 大幅下压
    const areaFocus = inArea * 100
    attention = clamp(areaFocus * 0.65 + stable * 0.3 + (1 - divergence / 100) * 10 - (this.pageVisible ? 0 : 30))

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
