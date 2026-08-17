import { describe, it, expect, beforeEach } from 'vitest'
import {
  canUseFeature,
  canAgentIntervene,
  FREE_DAILY_AGENT_LIMIT,
  getAgentUsage,
  incrementAgentUsage,
  readCloudPlan,
} from '../billing'

beforeEach(() => {
  localStorage.clear()
})

describe('canUseFeature 权限表', () => {
  it('免费档可用基础功能但不可云同步/全学科', () => {
    expect(canUseFeature('free', 'ai-agents')).toBe(true)
    expect(canUseFeature('free', 'cloud-sync')).toBe(false)
    expect(canUseFeature('free', 'all-disciplines')).toBe(false)
    expect(canUseFeature('free', 'admin')).toBe(false)
  })

  it('Pro 覆盖免费档并解锁云同步/全学科', () => {
    expect(canUseFeature('pro', 'ai-agents')).toBe(true)
    expect(canUseFeature('pro', 'cloud-sync')).toBe(true)
    expect(canUseFeature('pro', 'all-disciplines')).toBe(true)
    expect(canUseFeature('pro', 'admin')).toBe(false)
  })

  it('企业覆盖全部', () => {
    expect(canUseFeature('enterprise', 'admin')).toBe(true)
    expect(canUseFeature('enterprise', 'cloud-sync')).toBe(true)
  })
})

describe('免费档 AI 介入额度', () => {
  it('每日计数按天重置', () => {
    const first = incrementAgentUsage()
    expect(first).toBe(1)
    expect(getAgentUsage().count).toBe(1)
    // 强制把日期拨到昨天验证重置逻辑
    const yesterday = new Date(Date.now() - 86400_000)
    const m = String(yesterday.getMonth() + 1).padStart(2, '0')
    const day = String(yesterday.getDate()).padStart(2, '0')
    localStorage.setItem(
      'cogno.agentUsage',
      JSON.stringify({ date: `${yesterday.getFullYear()}-${m}-${day}`, count: 99 })
    )
    expect(incrementAgentUsage()).toBe(1)
    expect(getAgentUsage().count).toBe(1)
  })

  it('免费档达到上限后禁止介入，Pro 无限制', () => {
    for (let i = 0; i < FREE_DAILY_AGENT_LIMIT; i++) incrementAgentUsage()
    expect(canAgentIntervene('free', getAgentUsage())).toBe(false)
    expect(canAgentIntervene('pro', getAgentUsage())).toBe(true)
  })
})

describe('readCloudPlan', () => {
  it('云端返回合法方案；异常/空回退 free', async () => {
    const ok = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: [{ plan: 'pro' }] }),
        }),
      }),
    }
    expect(await readCloudPlan(ok as never, 'u1')).toBe('pro')

    const bad = {
      from: () => ({
        select: () => ({ eq: async () => ({ data: [] }) }),
      }),
    }
    expect(await readCloudPlan(bad as never, 'u1')).toBe('free')

    const thrower = {
      from: () => ({ select: () => ({ eq: async () => { throw new Error('网络') } }) }),
    }
    expect(await readCloudPlan(thrower as never, 'u1')).toBe('free')
  })
})