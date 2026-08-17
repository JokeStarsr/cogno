import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextInterval, isDue, review, getReviewItem } from '../spacedRepetition'
import { db } from '../storage'
import type { Mastery } from '../../types'

afterEach(async () => {
  // 清理 fake-indexeddb，避免用例间串数据
  await db.delete()
  await db.open()
})

describe('间隔重复', () => {
  it('nextInterval 按复习次数给出递增间隔（封顶 60 天）', () => {
    expect(nextInterval(0)).toBe(1)
    expect(nextInterval(1)).toBe(2)
    expect(nextInterval(2)).toBe(4)
    expect(nextInterval(5)).toBe(30)
    expect(nextInterval(999)).toBe(60)
  })

  it('isDue 按 nextReviewAt 判定到期', () => {
    const makeItem = (nextReviewAt: number) => ({
      conceptId: 'x',
      mastery: 0 as Mastery,
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt,
      history: [] as { at: number; mastery: Mastery }[],
    })
    expect(isDue(makeItem(Date.now() - 1), Date.now())).toBe(true)
    expect(isDue(makeItem(Date.now() + 1000), Date.now())).toBe(false)
  })

  it('复习（grade 2+）提升掌握度，上限 3', async () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const r1 = await review('binary-tree', 2)
    expect(r1.mastery).toBe(1)
    expect(r1.nextReviewAt).toBe(now + nextInterval(1) * 86400_000)
    vi.setSystemTime(now + 10_000)
    const r2 = await review('binary-tree', 3)
    expect(r2.mastery).toBe(3)
    expect(r2.history.length).toBe(2)
  })

  it('遗忘（grade 0）降级，最低 0', async () => {
    const now = Date.now()
    vi.setSystemTime(now)
    await review('stack', 3)
    await review('stack', 2)
    vi.setSystemTime(now + 20_000)
    const degraded = await review('stack', 0)
    expect(degraded.mastery).toBe(2)
    vi.setSystemTime(now + 30_000)
    await review('stack', 0)
    const floor = await review('stack', 0)
    expect(floor.mastery).toBe(0)
  })

  it('历史记录保留最近 40 条', async () => {
    for (let i = 0; i < 50; i++) {
      vi.setSystemTime(Date.now() + i * 1000)
      await review('array', 2)
    }
    const item = await getReviewItem('array')
    expect(item.history.length).toBeLessThanOrEqual(40)
    expect(item.reviewCount).toBe(50)
  })
})