/**
 * 同步引擎（Phase 1.2 核心）：本地优先 + 后台队列推云端。
 *
 * 同步范围（MVP）：
 *   - review_items：掌握度复习记录（唯一键 user_id+concept_id，按概念 upsert，last-write-wins）
 *   - cognitive_logs：认知日志按 30s 聚合后同步（原始 2s 采样只留本地，避免流量与表膨胀）
 * sessions/documents（含 PDF 二进制）不在 MVP 范围，二期走 Supabase Storage 再接入。
 *
 * 设计要点：
 *   - 队列持久化在 localStorage（cogno.syncQueue），上限 500 条，超出丢最旧
 *   - 未配置云端 / 未登录 / 网络不可用：入队照常（数据不丢），flush 静默跳过
 *   - settings 表（含 AI API Key）永不入队；一切云上行携带 user session，RLS 兜底
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase as defaultClient } from './supabase'
import { setWriteHook } from './storage'
import { db as defaultDb } from './storage'
import type { Mastery } from '../types'

export type SyncAction = 'insert' | 'update' | 'delete'
export type SyncTable = 'review_items' | 'cognitive_logs'

export interface SyncOp {
  id: string
  table: SyncTable
  action: SyncAction
  /** 行数据（review_items 含 conceptId；cognitive_logs 为聚合样本） */
  data: Record<string, unknown>
  ts: number
}

/** 云端对应的本地主键提取（review_items 用概念 id 做 upsert 键） */
function cloudKey(table: SyncTable, data: Record<string, unknown>): string {
  return table === 'review_items' ? `concept:${String(data.conceptId ?? data.concept_id)}` : `log:${data.ts}`
}

const QUEUE_KEY = 'cogno.syncQueue'
const MAX_QUEUE = 500
/** 单条推送超时：国内→新加坡线路抖动时，挂死请求会占住浏览器连接，
 *  配合 flush 互斥锁与失败退避，从根上杜绝 ERR_INSUFFICIENT_RESOURCES */
const PUSH_TIMEOUT_MS = 10_000

function loadQueue(): SyncOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as SyncOp[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveQueue(q: SyncOp[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  } catch {
    /* 隐私模式等 localStorage 不可用时静默放弃持久化 */
  }
}

export class SyncEngine {
  private client: SupabaseClient | null
  private db: typeof defaultDb
  /** 认知日志同步窗口：距上次成功入队不足 30s 的同类样本跳过（只推聚合密度 30s 一条） */
  private lastLogEnqueuedAt = 0
  private static LOG_SYNC_WINDOW_MS = 30_000
  /** flush 互斥锁：多个触发源（90s 定时/登录/手动）并发推同一批条目，
   *  会向慢速网络堆积并发请求直至浏览器资源耗尽（ERR_INSUFFICIENT_RESOURCES） */
  private flushing = false
  /** 单条失败退避：连续失败 n 次的条目本轮跳过，避免死循环重试 */
  private failCounts = new Map<string, number>()

  constructor(client: SupabaseClient | null = defaultClient, dbInstance: typeof defaultDb = defaultDb) {
    this.client = client
    this.db = dbInstance
  }

  /** 云端是否可用（已配置 + 已登录） */
  isReady(): boolean {
    return this.client != null
  }

  /** 入队（已在本地写入后的副作用调用）：表名白名单 + settings 永不入队 */
  enqueue(table: SyncTable, action: SyncAction, data: Record<string, unknown>): void {
    // 认知日志按 30s 密度同步（原始 2s 采样只留本地，云端只需趋势数据）
    if (table === 'cognitive_logs') {
      if (Date.now() - this.lastLogEnqueuedAt < SyncEngine.LOG_SYNC_WINDOW_MS) return
      this.lastLogEnqueuedAt = Date.now()
    }
    const op: SyncOp = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${cloudKey(table, data)}`,
      table,
      action,
      data,
      ts: Date.now(),
    }
    const q = loadQueue()
    q.push(op)
    // 上限 500：超限丢最旧
    if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE)
    saveQueue(q)
  }

  pendingCount(): number {
    return loadQueue().length
  }

  /** 消费队列：逐条推云端；失败保留（下次 flush 重试）；成功移除。网络异常静默不抛错。
 *  互斥：同进程并发的多次 flush 只有第一轮真正执行，其余直接返回（防连接堆积）。 */
  async flush(): Promise<{ pushed: number; remaining: number }> {
    if (this.flushing) return { pushed: 0, remaining: this.pendingCount() }
    if (!this.client) return { pushed: 0, remaining: this.pendingCount() }
    const { data: sessionData } = await this.client.auth.getSession()
    if (!sessionData.session) return { pushed: 0, remaining: this.pendingCount() }

    this.flushing = true
    try {
      const q = loadQueue()
      const kept: SyncOp[] = []
      let pushed = 0
      for (const op of q) {
        // 连续失败 ≥5 次的条目暂时跳过（退避期），防弱网下反复挂起的重试风暴
        const fails = this.failCounts.get(op.id) ?? 0
        if (fails >= 5) {
          kept.push(op)
          continue
        }
        const { error } = await this.pushOne(op)
        if (error) {
          this.failCounts.set(op.id, fails + 1)
          kept.push(op) // 失败保留，等下次 flush
        } else {
          this.failCounts.delete(op.id)
          pushed++
        }
      }
      const remaining = kept.length
      saveQueue(kept)
      return { pushed, remaining }
    } finally {
      this.flushing = false
    }
  }

  private async pushOne(op: SyncOp): Promise<{ error: unknown }> {
    // 超时保护：push 挂超 10s 按失败处理（队列保留，下次重试）
    return Promise.race([
      this.pushOneInner(op),
      new Promise<{ error: unknown }>((resolve) =>
        setTimeout(() => resolve({ error: new Error('push timeout') }), PUSH_TIMEOUT_MS)
      ),
    ])
  }

  private async pushOneInner(op: SyncOp): Promise<{ error: unknown }> {
    try {
      if (op.table === 'review_items') {
        // 唯一键 (user_id, concept_id) 由表约束保证，upsert 天然 last-write-wins
        return await this.client!.from('review_items').upsert(
          {
            concept_id: op.data.conceptId as string,
            mastery: op.data.mastery as number,
            review_count: op.data.reviewCount as number,
            last_reviewed_at: new Date((op.data.lastReviewedAt as number) ?? op.ts).toISOString(),
            next_review_at: new Date((op.data.nextReviewAt as number) ?? op.ts).toISOString(),
            history: op.data.history ?? [],
          },
          { onConflict: 'user_id,concept_id' }
        )
      }
      if (op.table === 'cognitive_logs') {
        return await this.client!.from('cognitive_logs').insert({
          understanding: op.data.understanding as number,
          attention: op.data.attention as number,
          fatigue: op.data.fatigue as number,
          divergence: op.data.divergence as number,
          flow: op.data.flow as boolean,
          ts: new Date(op.ts).toISOString(),
        })
      }
      return { error: new Error(`未知同步表: ${op.table}`) }
    } catch (e) {
      return { error: e }
    }
  }

  /**
   * 登录后全量拉取云端学习数据写入本地：
   *   - review_items → 按概念合并（取 last_reviewed_at 较新者）
   *   - cognitive_logs → 最近 7 天聚合，仅补缺失（按 ts 去重）
   */
  async pullUserData(): Promise<{ reviews: number; logs: number }> {
    if (!this.client) return { reviews: 0, logs: 0 }
    const { data: sessionData } = await this.client.auth.getSession()
    if (!sessionData.session) return { reviews: 0, logs: 0 }
    let reviews = 0
    let logs = 0

    try {
      const { data: remoteReviews } = await this.client
        .from('review_items')
        .select('concept_id, mastery, review_count, last_reviewed_at, next_review_at, history')

      if (Array.isArray(remoteReviews)) {
        for (const r of remoteReviews) {
          const local = await this.db.concepts.get(r.concept_id as string)
          const remoteTs = r.last_reviewed_at ? Date.parse(String(r.last_reviewed_at)) : 0
          // last-write-wins：云端更新则覆盖本地
          if (!local || remoteTs >= (local.lastReviewedAt ?? 0)) {
            await this.db.concepts.put({
              conceptId: r.concept_id as string,
              mastery: ((r.mastery as number) ?? 0) as Mastery,
              reviewCount: (r.review_count as number) ?? 0,
              lastReviewedAt: remoteTs,
              nextReviewAt: r.next_review_at ? Date.parse(String(r.next_review_at)) : 0,
              history: ((r.history as { at: number; mastery: number }[]) ?? []).map((h) => ({
                at: h.at,
                mastery: h.mastery as Mastery,
              })),
            })
            reviews++
          }
        }
      }
    } catch (e) {
      /* 拉取失败静默，本地优先不受影响 */
    }

    try {
      // 最近 7 天聚合日志
      const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString()
      const { data: remoteLogs } = await this.client
        .from('cognitive_logs')
        .select('understanding, attention, fatigue, divergence, flow, ts')
        .gte('ts', cutoff)
        .order('ts', { ascending: true })

      if (Array.isArray(remoteLogs)) {
        for (const l of remoteLogs) {
          const ts = Date.parse(String(l.ts))
          // 按 ts 去重：本地已有同秒样本则跳过
          const dup = await this.db.cognitiveLogs.where('ts').equals(ts).count()
          if (dup === 0) {
            await this.db.cognitiveLogs.add({
              understanding: l.understanding as number,
              attention: l.attention as number,
              fatigue: l.fatigue as number,
              divergence: l.divergence as number,
              flow: l.flow as boolean,
              ts,
            })
            logs++
          }
        }
      }
    } catch (e) {
      /* 同静默处理 */
    }
    return { reviews, logs }
  }

  /** 清空队列（登出时可选调用：不清空则下次登录继续推送本地行为） */
  clearQueue(): void {
    saveQueue([])
  }
}

/** 全局单例：storage 等模块直接引用；测试注入 mock client */
export const syncEngine = new SyncEngine()

// 注册本地写入钩子：写库成功 → 入同步队列（settings 表永不挂钩，见 storage.writeHook）
setWriteHook((table, action, data) => {
  if (table === 'concepts' && action !== 'delete') {
    syncEngine.enqueue('review_items', 'update', data as Record<string, unknown>)
  } else if (table === 'cognitiveLogs') {
    syncEngine.enqueue('cognitive_logs', 'insert', data as Record<string, unknown>)
  }
})