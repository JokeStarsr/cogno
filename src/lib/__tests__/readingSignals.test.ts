import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReadingEventTracker, loadBaselineRate, recordBaseline } from '../readingSignals'

describe('ReadingEventTracker 页信号', () => {
  let t: ReadingEventTracker
  beforeEach(() => {
    t = new ReadingEventTracker()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => vi.useRealTimers())

  it('首次进入不产生翻页计数', () => {
    t.reportPage(5)
    expect(t.totalPagesTurned()).toBe(0)
    expect(t.currentPage()).toBe(5)
  })

  it('翻页结算停留，重入同一页累计回读', () => {
    t.reportPage(5)
    vi.setSystemTime(1_000_000 + 60_000)
    t.tick() // +2s
    t.reportPage(6)
    expect(t.pageRatePerMin(60_000)).toBeGreaterThan(0)
    t.reportPage(5) // 回到第 5 页 → 回读
    expect(t.pageRereads()).toBe(1)
  })

  it('页面不可见时停留不累计', () => {
    t.reportPage(3)
    vi.setSystemTime(1_000_000 + 60_000)
    t.setPageVisible(false)
    t.tick()
    t.tick()
    expect(t.pageDwellSec()).toBe(0)
    t.setPageVisible(true)
    t.tick()
    expect(t.pageDwellSec()).toBe(2)
  })

  it('翻页速率按窗口计算（页/分）', () => {
    t.reportPage(1)
    vi.setSystemTime(1_000_000 + 30_000)
    t.reportPage(2)
    vi.setSystemTime(1_000_000 + 60_000)
    t.reportPage(3)
    expect(t.pageRatePerMin(60_000)).toBe(2) // 30s 内 2 次跨页 = 4/分？按窗口 60s 计 2 次 → 2 页/分
  })

  it('冷静期：翻页/滚动后 calmSec 内不冷静', () => {
    t.reportPage(1)
    expect(t.isCalm(90)).toBe(false)
    vi.setSystemTime(1_000_000 + 95_000)
    expect(t.isCalm(90)).toBe(true)
    t.reportScroll()
    expect(t.isCalm(90)).toBe(false)
  })
})

describe('个人阅读基线', () => {
  beforeEach(() => localStorage.clear())

  it('不足 2 篇样本不启用基线', () => {
    recordBaseline('文档A', 3, 300)
    expect(loadBaselineRate()).toBeNull()
  })

  it('≥2 篇时取平均；重复篇目去重', () => {
    recordBaseline('文档A', 4, 300)
    recordBaseline('文档B', 8, 300)
    expect(loadBaselineRate()).toBe(6)
    recordBaseline('文档A', 2, 300) // 更新 A 并去重
    expect(loadBaselineRate()).toBe(5)
  })

  it('时长过短或速率为 0 的样本丢弃', () => {
    recordBaseline('短文档', 3, 30)
    recordBaseline('空速', 0, 300)
    recordBaseline('文档C', 6, 300)
    expect(loadBaselineRate()).toBeNull() // 只有 1 篇有效
  })
})