import Dexie, { type Table } from 'dexie'
import type { ReadingSession, ReviewItem, CognitiveSample, ReadingDoc } from '../types'

/** 隐私优先：全部数据仅存浏览器本地 IndexedDB，不上传云端 */
class CognoDB extends Dexie {
  settings!: Table<{ key: string; value: unknown }, string>
  concepts!: Table<ReviewItem, string>
  sessions!: Table<ReadingSession, number>
  cognitiveLogs!: Table<CognitiveSample, number>
  docs!: Table<ReadingDoc, number>

  constructor() {
    super('cogno')
    this.version(1).stores({
      settings: 'key',
      concepts: 'conceptId, nextReviewAt, mastery',
      sessions: '++id, startedAt',
      cognitiveLogs: '++id, ts',
    })
    // v2: 新增 docs 表，保存文档内容（PDF 二进制 + 抽取文本）
    this.version(2).stores({
      docs: '++id, createdAt',
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
/** 日志每 2s 写一条，清理改为 60s 一次批量执行，避免每 2s 都触发一次带全表扫描的删除事务 */
let lastLogCleanup = 0
export async function appendCognitiveLog(sample: CognitiveSample): Promise<void> {
  await db.cognitiveLogs.add(sample)
  const now = Date.now()
  if (now - lastLogCleanup < 60_000) return
  lastLogCleanup = now
  const cutoff = now - COGNITIVE_LOG_TTL
  await db.cognitiveLogs.where('ts').below(cutoff).delete()
}

export async function recentCognitiveLogs(limit = 200): Promise<CognitiveSample[]> {
  return db.cognitiveLogs.orderBy('ts').reverse().limit(limit).toArray()
}

export async function saveDoc(doc: ReadingDoc): Promise<number> {
  return db.docs.add(doc)
}

export async function getDoc(id: number): Promise<ReadingDoc | undefined> {
  return db.docs.get(id)
}
