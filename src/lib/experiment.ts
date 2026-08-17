/**
 * 本地 A/B 实验框架（Phase 2.2）：
 * 基于设备 ID 的稳定分桶（50/50），同一设备永远落在同一组。
 * 对照组的四代理只保留手动对话，不自动介入——用于衡量"自动介入"的真实增量价值。
 * 实验配置存 localStorage（cogno.experiment），删除数据时一并清除。
 */

export type Bucket = 'control' | 'treatment'

const EXP_KEY = 'cogno.experiment'
const DEVICE_KEY = 'cogno.deviceId'

/** 获取（或惰性生成）稳定设备 ID：随机 UUID，跟随浏览器存储 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (id) return id
  id = crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`
  localStorage.setItem(DEVICE_KEY, id)
  return id
}

/** FNV-1a 32 位哈希 → [0,1)，不同 deviceId 近似均匀分布 */
function hashRatio(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x100000000
}

/** 分桶：首次调用时分配并持久化，此后恒定 */
export function assignBucket(userId: string): Bucket {
  const existing = localStorage.getItem(EXP_KEY)
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as { bucket?: Bucket }
      if (parsed.bucket === 'control' || parsed.bucket === 'treatment') return parsed.bucket
    } catch {
      /* 损坏则重新分配 */
    }
  }
  const bucket: Bucket = hashRatio(userId) < 0.5 ? 'control' : 'treatment'
  localStorage.setItem(EXP_KEY, JSON.stringify({ bucket, assignedAt: Date.now() }))
  return bucket
}

/** 当前设备是否实验组 */
export function isTreatmentGroup(userId: string): boolean {
  return assignBucket(userId) === 'treatment'
}