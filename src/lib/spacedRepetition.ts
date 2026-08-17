import type { Mastery, ReviewItem } from '../types'
import { db, writeHook } from './storage'

/** 艾宾浩斯间隔重复间隔（天） */
const INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60]

export function nextInterval(reviewCount: number): number {
  const idx = Math.min(reviewCount, INTERVALS_DAYS.length - 1)
  return INTERVALS_DAYS[idx]
}

export function isDue(item: ReviewItem, now = Date.now()): boolean {
  return item.nextReviewAt <= now
}

export async function getReviewItem(conceptId: string): Promise<ReviewItem> {
  const existing = await db.concepts.get(conceptId)
  if (existing) return existing
  return {
    conceptId,
    mastery: 0,
    reviewCount: 0,
    lastReviewedAt: 0,
    nextReviewAt: 0,
    history: [],
  }
}

/**
 * 复习并更新掌握度。
 * @param grade 0=忘了 1=模糊 2=记住了 3=能应用
 */
export async function review(conceptId: string, grade: 0 | 1 | 2 | 3): Promise<ReviewItem> {
  const item = await getReviewItem(conceptId)
  const now = Date.now()

  // 掌握度演进：grade 影响 mastery；遗忘则降级
  let mastery = item.mastery as Mastery
  if (grade >= 2) {
    mastery = Math.min(3, mastery + grade - 1) as Mastery
  } else if (grade <= 0) {
    mastery = Math.max(0, mastery - 1) as Mastery
  }

  const reviewCount = item.reviewCount + 1
  const nextReviewAt = now + nextInterval(reviewCount) * 86400_000

  const next: ReviewItem = {
    ...item,
    mastery,
    reviewCount,
    lastReviewedAt: now,
    nextReviewAt,
    history: [...item.history, { at: now, mastery }].slice(-40),
  }
  await db.concepts.put(next)
  // 云端同步入队（Phase 1.2）：掌握度变化跨设备可见；settings 类敏感数据不在此列
  writeHook?.('concepts', 'update', next)
  return next
}

export async function listDue(now = Date.now()): Promise<ReviewItem[]> {
  return db.concepts.where('nextReviewAt').belowOrEqual(now).toArray()
}

export async function listConcepts(): Promise<ReviewItem[]> {
  return db.concepts.toArray()
}
