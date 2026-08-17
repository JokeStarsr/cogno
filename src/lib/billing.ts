/**
 * 订阅与功能权限层（Phase 1.4 Stripe 集成骨架）。
 * 本地模式（未配置 Supabase）恒为 free，Pro 功能的额度判断照常工作（0 额度）；
 * 云端就绪后由 profiles.plan 驱动。纯函数 canUseFeature 可单测。
 */

export type Plan = 'free' | 'pro' | 'enterprise'

export interface PlanDef {
  key: Plan
  name: string
  price: string
  priceNote: string
  features: string[]
}

export const PLANS: PlanDef[] = [
  {
    key: 'free',
    name: '免费',
    price: '¥0',
    priceNote: '永久',
    features: ['每日 AI 代理介入 3 次', '1 个学科图谱', '本地阅读记录', '离线问答兜底'],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '¥29/月',
    priceNote: '按月订阅',
    features: ['无限 AI 代理介入', '全部学科图谱', '云端同步与多端', '间隔回顾完整版', '测评前后测与趋势'],
  },
  {
    key: 'enterprise',
    name: '企业',
    price: '¥99/人/年',
    priceNote: '按年订阅',
    features: ['Pro 全部权益', '管理后台', 'SSO 登录', '团队学习分析', '专属支持'],
  },
]

/** 功能 → 所需最低方案（enterprise 覆盖 pro 与 free 权益） */
export type FeatureName =
  | 'ai-agents' // AI 代理介入（免费档每日限 3 次）
  | 'cloud-sync'
  | 'all-disciplines'
  | 'admin'

const FEATURE_PLAN: Record<FeatureName, Plan> = {
  'ai-agents': 'free',
  'cloud-sync': 'pro',
  'all-disciplines': 'pro',
  admin: 'enterprise',
}

const PLAN_ORDER: Plan[] = ['free', 'pro', 'enterprise']

/** 纯函数：某方案能否使用该功能 */
export function canUseFeature(plan: Plan, feature: FeatureName): boolean {
  const need = FEATURE_PLAN[feature]
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(need)
}

/** 免费档每日 AI 介入额度（超出后走本地问答/引导升级） */
export const FREE_DAILY_AGENT_LIMIT = 3

/** 本地记录 AI 介入次数（localStorage，按天重置） */
const AGENT_USAGE_KEY = 'cogno.agentUsage'

export interface DailyUsage {
  date: string // YYYY-MM-DD（本地时区）
  count: number
}

function todayKey(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function getAgentUsage(): DailyUsage {
  try {
    const raw = localStorage.getItem(AGENT_USAGE_KEY)
    if (raw) {
      const u = JSON.parse(raw) as DailyUsage
      if (u.date === todayKey()) return u
    }
  } catch {
    /* 存储异常视为 0 */
  }
  return { date: todayKey(), count: 0 }
}

export function incrementAgentUsage(): number {
  const u = getAgentUsage()
  const next = { date: todayKey(), count: u.date === todayKey() ? u.count + 1 : 1 }
  try {
    localStorage.setItem(AGENT_USAGE_KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式静默 */
  }
  return next.count
}

/** 由 AI 介入计数 + 方案算出是否还能介入（免费档超限返回 false） */
export function canAgentIntervene(plan: Plan, usage: DailyUsage): boolean {
  if (plan !== 'free') return true
  return usage.count < FREE_DAILY_AGENT_LIMIT
}

/**
 * 云端模式下的当前方案读取：无 Supabase 或未登录时为 free。
 * 由 AppProvider 组装（isCloudEnabled → profiles.plan）。
 */
export async function readCloudPlan(
  client: { from: (t: string) => { select: (c: string) => { eq: (a: string, b: string) => Promise<{ data: unknown[] }> } } },
  userId: string
): Promise<Plan> {
  try {
    const { data } = await client.from('profiles').select('plan').eq('user_id', userId)
    const p = (data?.[0] as { plan?: Plan } | undefined)?.plan
    return p === 'pro' || p === 'enterprise' ? p : 'free'
  } catch {
    return 'free'
  }
}