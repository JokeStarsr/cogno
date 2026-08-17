import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentTrigger, DEFAULT_TRIGGER_CONFIG } from '../agents'
import type { AgentIntervention, CognitiveState } from '../../types'

/** 构造最小的合法 TriggerInput（默认中性值，测试里按需覆盖） */
function baseInput(state: Partial<CognitiveState> = {}): Parameters<AgentTrigger['evaluate']>[0] {
  return {
    state: { understanding: 50, attention: 55, fatigue: 20, divergence: 30, flow: false, ...state },
    pageDwellSec: 0,
    pageRereads: 0,
    pageRatePerMin: 0,
    baselineRate: null,
    isCalm: true,
    masteredLabels: [],
  }
}

describe('AgentTrigger.evaluate', () => {
  let trigger: AgentTrigger
  beforeEach(() => {
    trigger = new AgentTrigger()
    vi.useFakeTimers()
  })

  it('心流状态下绝不自动介入（最高优先级）', () => {
    const input = { ...baseInput({ flow: true }), pageDwellSec: 999, pageRereads: 9 }
    expect(trigger.evaluate(input)).toBeNull()
  })

  it('澄清者：同页停留够久且反复回读 → 触发', () => {
    const cfg = { ...DEFAULT_TRIGGER_CONFIG, clarifyDwellSec: 90, clarifyPageReread: 2 }
    const input = { ...baseInput(), pageDwellSec: 91, pageRereads: 2 }
    const r = trigger.evaluate(input, cfg)
    expect(r?.agentId).toBe('clarifier')
  })

  it('澄清者：回读不足不触发（避免翻页抖动误报）', () => {
    const input = { ...baseInput(), pageDwellSec: 999, pageRereads: 1 }
    expect(trigger.evaluate(input)).toBeNull()
  })

  it('冷静期内任何自动介入都被拦截', () => {
    const input = { ...baseInput(), pageDwellSec: 999, pageRereads: 9, isCalm: false }
    expect(trigger.evaluate(input)).toBeNull()
  })

  it('挑战者：翻页速率超基线×2 且无回读 → 触发', () => {
    const cfg = { ...DEFAULT_TRIGGER_CONFIG, challengerRateMult: 2, challengerFallbackRate: 6 }
    const input = { ...baseInput(), pageRatePerMin: 13, pageRereads: 0 }
    expect(trigger.evaluate(input, cfg)?.agentId).toBe('challenger')
  })

  it('挑战者：有回读时视为深入阅读，不判定浅扫', () => {
    const input = { ...baseInput(), pageRatePerMin: 20, pageRereads: 1 }
    expect(trigger.evaluate(input)).not.toBe('challenger')
  })

  it('连接者：遇到未掌握新概念 → 触发', () => {
    const input = { ...baseInput(), newConceptId: 'hash-table', masteredLabels: ['数组'] }
    expect(trigger.evaluate(input)?.agentId).toBe('connector')
  })

  it('拓展者：同页沉浸且无回读 → 触发', () => {
    const cfg = { ...DEFAULT_TRIGGER_CONFIG, expanderDwellSec: 180 }
    const input = { ...baseInput(), pageDwellSec: 185, pageRereads: 0 }
    expect(trigger.evaluate(input, cfg)?.agentId).toBe('expander')
  })

  it('灵敏度乘数：sensitivity=2 阈值减半，停留一半时长即可触发', () => {
    const cfg = { ...DEFAULT_TRIGGER_CONFIG, clarifyDwellSec: 90, clarifyPageReread: 2 }
    const input = { ...baseInput(), pageDwellSec: 45, pageRereads: 1 }
    // 90/2=45、2/2=1 → 命中
    expect(trigger.evaluate(input, cfg, 2)?.agentId).toBe('clarifier')
    // 灵敏度 1 时不命中
    expect(trigger.evaluate(input, cfg, 1)).toBeNull()
  })

  it('冷却期：同一代理触发后 cooldownSec 内不再触发', () => {
    const cfg = { ...DEFAULT_TRIGGER_CONFIG, cooldownSec: 360, clarifyDwellSec: 90, clarifyPageReread: 2 }
    const input = { ...baseInput(), pageDwellSec: 91, pageRereads: 2 }
    expect(trigger.evaluate(input, cfg)?.agentId).toBe('clarifier')

    // 冷却期内：即便条件继续满足也拦截
    vi.setSystemTime(Date.now() + 60_000)
    expect(trigger.evaluate(input, cfg)).toBeNull()

    // 冷却期过后可再次触发
    vi.setSystemTime(Date.now() + 301_000)
    expect(trigger.evaluate(input, cfg)?.agentId).toBe('clarifier')
  })

  it('被禁用的代理不触发', () => {
    const cfg = { ...DEFAULT_TRIGGER_CONFIG, enabled: { clarifier: false, challenger: true, connector: true, expander: true } }
    const input = { ...baseInput(), pageDwellSec: 999, pageRereads: 9 }
    expect(trigger.evaluate(input, cfg)).toBeNull()
  })

  it('触发结果携带原因说明', () => {
    const input = { ...baseInput(), pageDwellSec: 91, pageRereads: 2 }
    const r: AgentIntervention | null = trigger.evaluate(input)
    expect(r?.reason).toContain('回看')
  })
})