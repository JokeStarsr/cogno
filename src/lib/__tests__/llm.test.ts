import { describe, it, expect } from 'vitest'
import { classifyFailure, friendlyFailure, trimContext, trimHistory } from '../llm'

describe('classifyFailure', () => {
  it('按状态码分类', () => {
    expect(classifyFailure(401, 'unauthorized')).toBe('auth')
    expect(classifyFailure(402, 'payment required')).toBe('balance')
    expect(classifyFailure(429, 'too many')).toBe('rate')
    expect(classifyFailure(502, 'bad gateway')).toBe('server')
  })

  it('按错误文本提示词分类（sub2api 常见文案）', () => {
    expect(classifyFailure(400, 'Insufficient Balance')).toBe('balance')
    expect(classifyFailure(400, 'no available accounts')).toBe('balance')
    expect(classifyFailure(200, '超出配额')).toBe('quota')
    expect(classifyFailure(200, 'exceed limit')).toBe('quota')
    expect(classifyFailure(200, 'TPM rate limit')).toBe('rate')
  })

  it('未知错误归类 unknown', () => {
    expect(classifyFailure(400, 'something weird')).toBe('unknown')
  })

  it('friendlyFailure 对余额不足给出本地降级指引', () => {
    expect(friendlyFailure('balance', '')).toContain('本地问答模式')
  })
})

describe('trimHistory', () => {
  const turns = [
    { agentId: 'clarifier', role: 'user' as const, content: '第1轮提问' },
    { agentId: 'clarifier', role: 'agent' as const, content: '第1轮回答' },
    { agentId: 'challenger', role: 'user' as const, content: '别的代理的对话' },
    { agentId: 'clarifier', role: 'user' as const, content: '最新提问'.repeat(20) },
  ]

  it('只保留指定代理的历史', () => {
    const out = trimHistory(turns, 'clarifier', 100_000)
    expect(out.every((t) => (t as { agentId?: string }).agentId === 'clarifier')).toBe(true)
  })

  it('超预算时优先保留最近的对话', () => {
    const out = trimHistory(turns, 'clarifier', 30)
    expect(out.length).toBeLessThan(turns.filter((t) => (t as { agentId?: string }).agentId === 'clarifier').length)
    expect(out[out.length - 1].content).toContain('最新提问')
  })
})

describe('trimContext', () => {
  it('短文本原样返回', () => {
    expect(trimContext('短', 100)).toBe('短')
  })

  it('超预算时保留开头与结尾并标注省略', () => {
    const long = 'a'.repeat(1000)
    const out = trimContext(long, 100)
    expect(out.length).toBeLessThanOrEqual(100 + 20)
    expect(out).toContain('中间省略')
    expect(out.startsWith('a'.repeat(35))).toBe(true)
    expect(out.endsWith('a'.repeat(60))).toBe(true)
  })

  it('空输入返回空串', () => {
    expect(trimContext('')).toBe('')
  })
})