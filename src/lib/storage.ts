import Dexie, { type Table } from 'dexie'
import type { ReadingSession, ReviewItem, CognitiveSample } from '../types'

/** 隐私优先：全部数据仅存浏览器本地 IndexedDB，不上传云端 */
class CognoDB extends Dexie {
  settings!: Table<{ key: string; value: unknown }, string>
  concepts!: Table<ReviewItem, string>
  sessions!: Table<ReadingSession, number>
  cognitiveLogs!: Table<CognitiveSample, number>

  constructor() {
    super('cogno')
    this.version(1).stores({
      settings: 'key',
      concepts: 'conceptId, nextReviewAt, mastery',
      sessions: '++id, startedAt',
      cognitiveLogs: '++id, ts',
    })
  }
}

export const db = new CognoDB()

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return (row?.value as T) ?? fallback
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value })
}

/** 认知日志只保留最近 6 小时，避免无限膨胀 */
const COGNITIVE_LOG_TTL = 6 * 3600 * 1000
export async function appendCognitiveLog(sample: CognitiveSample): Promise<void> {
  await db.cognitiveLogs.add(sample)
  const cutoff = Date.now() - COGNITIVE_LOG_TTL
  await db.cognitiveLogs.where('ts').below(cutoff).delete()
}

export async function recentCognitiveLogs(limit = 200): Promise<CognitiveSample[]> {
  return db.cognitiveLogs.orderBy('ts').reverse().limit(limit).toArray()
}
