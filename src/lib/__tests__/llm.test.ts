import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  classifyFailure,
  friendlyFailure,
  trimContext,
  trimHistory,
  chatCompletionVision,
  LLMError,
} from '../llm'
import type { LLMConfig } from '../../types'

const cfg: LLMConfig = { baseUrl: 'http://localhost:8180', apiKey: 'k-test', model: 'x' }

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chatCompletionVision', () => {
  it('请求体含图片 base64 块与提示词，模型默认 qwen3.7-plus，走 /v1/messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ content: [{ type: 'text', text: '识别结果' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const dataUrl = 'data:image/png;base64,QUJDREU='
    const out = await chatCompletionVision(cfg, '识别这些字', dataUrl)
    expect(out).toBe('识别结果')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8180/v1/messages')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('qwen3.7-plus')
    expect(body.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'QUJDREU=' },
    })
    expect(body.messages[0].content[1]).toEqual({ type: 'text', text: '识别这些字' })
  })

  it('响应含 thinking 块时只取 text 块（视觉模型会先输出思考过程）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonOk({
          content: [
            { type: 'thinking', thinking: '这是思考过程，不应出现在正文' },
            { type: 'text', text: '数据结构与算法导论' },
          ],
        }),
      ),
    )
    const out = await chatCompletionVision(cfg, 'p', 'data:image/jpeg;base64,AA==')
    expect(out).toBe('数据结构与算法导论')
    expect(out).not.toContain('思考')
  })

  it('自定义模型名透传（本地 sub2api 缺 qwen3.7-plus 映射时可由调用方指定）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await chatCompletionVision(cfg, 'p', 'data:image/png;base64,AA==', { model: 'my-vision' })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('my-vision')
  })

  it('上游拒绝（如模型不支持图片）→ LLMError 且分类正常', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'insufficient balance' } }), { status: 400 })),
    )
    const err = await chatCompletionVision(cfg, 'p', 'data:image/png;base64,AA==').catch((e) => e)
    expect(err).toBeInstanceOf(LLMError)
    expect((err as LLMError).kind).toBe('balance')
  })
})

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