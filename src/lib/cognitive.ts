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
  /** 5 分钟窗口的触发统计 */
  private regressions5m: number[] = []
  private scrollHistory: { px: number; ts: number }[] = []
  private dwellRunMs = 0
  private maxDwellMs = 0

  /** 供代理触发读取的近期阅读统计 */
  getStats() {
    const now = Date.now()
    const fiveMin = now - 5 * 60_000
    return {
      rereadCount: this.regressions5m.filter((t) => t > fiveMin).length,
      scrollPx: this.scrollHistory.filter((s) => s.ts > fiveMin).reduce((a, s) => a + s.px, 0),
      maxDwellMs: this.maxDwellMs,
    }
  }

  setReadingBounds(b: { left: number; right: number; top: number; bottom: number } | null) {
    this.readingBounds = b
  }

  pushGaze(g: GazePoint) {
    this.samples.push(g)
    const cutoff = g.ts - SAMPLE_WINDOW
    while (this.samples.length && this.samples[0].ts < cutoff) this.samples.shift()
  }

  pushScroll(deltaPx: number) {
    this.scrollPx += Math.abs(deltaPx)
    this.scrollHistory.push({ px: Math.abs(deltaPx), ts: Date.now() })
    const fiveMin = Date.now() - 5 * 60_000
    this.scrollHistory = this.scrollHistory.filter((s) => s.ts > fiveMin)
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

    if (n >= 4) {
      // ── 注视集中度 / 发散度 ──
      let inArea = 0
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const g of win) {
        if (this.inReadingArea(g)) inArea++
        minX = Math.min(minX, g.x); maxX = Math.max(maxX, g.x)
        minY = Math.min(minY, g.y); maxY = Math.max(maxY, g.y)
      }
      this.inArea = inArea / n
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
      const regressionRate = regressions / n
      const fiveMin = now - 5 * 60_000
      this.regressions5m = this.regressions5m.filter((t) => t > fiveMin)

      // 注视是否持续稳定在阅读区 → 最长沉浸时长
      if (this.inArea > 0.78) {
        this.dwellRunMs += 2000
        if (this.dwellRunMs > this.maxDwellMs) this.maxDwellMs = this.dwellRunMs
      } else {
        this.dwellRunMs = 0
      }

      // 停留稳定性：注视 y 的波动
      const meanY = win.reduce((a, s) => a + s.y, 0) / n
      const varY = win.reduce((a, s) => a + (s.y - meanY) ** 2, 0) / n
      const stable = clamp(100 - Math.sqrt(varY) * 1.6)

      // 滚动速度（px / 秒）
      const scrollRate = this.scrollPx / (SAMPLE_WINDOW / 1000)
      this.scrollPx = 0

      // ── 理解深度 ──
      // 适度回读 = 认真理解；过度滚动 = 浅层扫描
      const rereadFactor = clamp(regressionRate * 340)
      const scrollPenalty = clamp(scrollRate / 900 * 100)
      understanding = clamp(
        45 + (rereadFactor - 10) * 1.1 + (stable - 55) * 0.55 - scrollPenalty * 0.5
      )

      // ── 注意力：视线是否稳定落在阅读区 ──
      const areaFocus = this.inArea * 100
      attention = clamp(areaFocus * 0.65 + stable * 0.3 + (1 - divergence / 100) * 10)

      // ── 疲劳：注意力长期低 + 注视波动大 ──
      if (attention < 45) {
        if (!this.lowAttentionSince) this.lowAttentionSince = now
      } else {
        this.lowAttentionSince = 0
      }
      if (this.lowAttentionSince && now - this.lowAttentionSince > 90_000) {
        fatigue = clamp(fatigue + 3.2 + (1 - attention / 100) * 2.5)
      } else {
        fatigue = clamp(fatigue - 0.7)
      }
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
