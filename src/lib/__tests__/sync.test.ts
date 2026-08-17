import { describe, it, expect, vi, afterEach } from 'vitest'
import { SyncEngine } from '../sync'
import { db } from '../storage'
import { review } from '../spacedRepetition'

/** 构造 mock Supabase client（记录调用、可编程失败） */
function mockClient(opts: { failUpsert?: boolean; failInsert?: boolean; haveSession?: boolean; remoteReviews?: unknown[]; remoteLogs?: unknown[] } = {}) {
  const calls: { method: string; arg?: unknown }[] = []
  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: opts.haveSession === false ? null : { user: { id: 'u1' } } },
        error: null,
      })),
    },
    from: (table: string) => {
    const base = {
      upsert: vi.fn(async (data: unknown) => {
        calls.push({ method: `upsert:${table}`, arg: data })
        return { error: opts.failUpsert ? { message: 'fail' } : null, data: null }
      }),
      insert: vi.fn(async (data: unknown) => {
        calls.push({ method: `insert:${table}`, arg: data })
        return { error: opts.failInsert ? { message: 'fail' } : null, data: null }
      }),
    }
    if (table === 'cognitive_logs') {
      return {
        ...base,
        select: vi.fn(() => ({
          gte: vi.fn(() => ({
            order: vi.fn(async () => ({ data: opts.remoteLogs ?? [], error: null })),
          })),
        })),
      }
    }
    return {
      ...base,
      select: vi.fn(async () => ({ data: opts.remoteReviews ?? [], error: null })),
    }
    },
  }
  return { client: client as never, calls }
}

afterEach(() => {
  localStorage.clear()
})

describe('SyncEngine 队列', () => {
  it('入队并持久化到 localStorage；队列上限 500 丢最旧', () => {
    const { client } = mockClient()
    const s = new SyncEngine(client as never, db)
    for (let i = 0; i < 510; i++) {
      s.enqueue('review_items', 'update', { conceptId: `c${i}` })
    }
    expect(s.pendingCount()).toBe(500)
    // 最旧的 10 条被丢弃
    expect(JSON.parse(localStorage.getItem('cogno.syncQueue')!).length).toBe(500)
  })

  it('认知日志按 30s 窗口去重（只保留 30s 一条）', () => {
    const { client } = mockClient()
    const s = new SyncEngine(client as never, db)
    s.enqueue('cognitive_logs', 'insert', { ts: 1 })
    s.enqueue('cognitive_logs', 'insert', { ts: 2 }) // 同窗口内 → 跳过
    expect(s.pendingCount()).toBe(1)
  })
})

describe('SyncEngine flush', () => {
  it('未登录时不清空队列', async () => {
    const { client } = mockClient({ haveSession: false })
    const s = new SyncEngine(client as never, db)
    s.enqueue('review_items', 'update', { conceptId: 'c1' })
    const r = await s.flush()
    expect(r.pushed).toBe(0)
    expect(r.remaining).toBe(1)
  })

  it('推送成功移除队列；失败保留待重试', async () => {
    const { client } = mockClient({ failUpsert: true })
    const s = new SyncEngine(client as never, db)
    s.enqueue('review_items', 'update', { conceptId: 'c1' })
    const r1 = await s.flush()
    expect(r1.pushed).toBe(0)
    expect(r1.remaining).toBe(1)

    // 换成功客户端继续推 → 清空
    const { client: ok } = mockClient()
    const s2 = new SyncEngine(ok as never, db)
    const r2 = await s2.flush()
    expect(r2.pushed).toBe(1)
    expect(r2.remaining).toBe(0)
  })

  it('review_items 使用 upsert 全字段映射（last-write-wins 语义）', async () => {
    const { client, calls } = mockClient()
    const s = new SyncEngine(client as never, db)
    s.enqueue('review_items', 'update', {
      conceptId: 'hash-table',
      mastery: 2,
      reviewCount: 3,
      lastReviewedAt: 1000,
      nextReviewAt: 2000,
      history: [{ at: 1000, mastery: 2 }],
    })
    await s.flush()
    const upsert = calls.find((c) => c.method === 'upsert:review_items')
    expect(upsert).toBeTruthy()
    const arg = upsert!.arg as Record<string, unknown>
    expect(arg.concept_id).toBe('hash-table')
    expect(arg.mastery).toBe(2)
    expect(arg.review_count).toBe(3)
  })
})

describe('SyncEngine pullUserData', () => {
  it('云端更近的复习记录覆盖本地（last-write-wins）', async () => {
    // 本地先有一次旧复习
    vi.setSystemTime(1_000_000)
    await review('linked-list', 2) // local lastReviewedAt = 1000000
    const { client } = mockClient({
      remoteReviews: [
        {
          concept_id: 'linked-list',
          mastery: 3,
          review_count: 2,
          last_reviewed_at: new Date(2_000_000).toISOString(),
          next_review_at: new Date(5_000_000).toISOString(),
          history: [{ at: 2000000, mastery: 3 }],
        },
      ],
    })
    const s = new SyncEngine(client as never, db)
    const r = await s.pullUserData()
    expect(r.reviews).toBe(1)
    const local = await db.concepts.get('linked-list')
    expect(local?.mastery).toBe(3)
    expect(local?.reviewCount).toBe(2)
  })

  it('云端比本地旧时不覆盖（本地优先）', async () => {
    vi.setSystemTime(5_000_000)
    await review('stack', 2) // local lastReviewedAt = 5000000, mastery=1
    const { client } = mockClient({
      remoteReviews: [
        {
          concept_id: 'stack',
          mastery: 0,
          review_count: 0,
          last_reviewed_at: new Date(1_000_000).toISOString(),
          next_review_at: new Date(1_000_000).toISOString(),
          history: [],
        },
      ],
    })
    const s = new SyncEngine(client as never, db)
    await s.pullUserData()
    const local = await db.concepts.get('stack')
    expect(local?.mastery).toBe(1) // 保留本地
  })

  it('云端日志按 ts 去重写入本地', async () => {
    const { client } = mockClient({
      remoteLogs: [
        { understanding: 60, attention: 70, fatigue: 10, divergence: 20, flow: true, ts: '2026-08-01T00:00:00Z' },
        { understanding: 50, attention: 55, fatigue: 15, divergence: 25, flow: false, ts: '2026-08-01T00:00:30Z' },
      ],
    })
    const s = new SyncEngine(client as never, db)
    const r = await s.pullUserData()
    expect(r.logs).toBe(2)
    const count = await db.cognitiveLogs.count()
    expect(count).toBe(2)
  })
})