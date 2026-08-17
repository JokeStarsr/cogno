import type { ChatMessage, LLMConfig } from '../types'

export interface ChatOptions {
  maxTokens?: number
  /** 携带阅读上下文片段 */
  context?: string
  /** 用户概念背景（让连接者能做类比） */
  masteredLabels?: string[]
}

/** 失败类别：用于给出可操作的中文提示（余额不足/限流时不做无谓重试） */
export type LLMFailureKind = 'network' | 'auth' | 'balance' | 'quota' | 'rate' | 'server' | 'empty' | 'unknown'

export class LLMError extends Error {
  kind: LLMFailureKind

  constructor(kind: LLMFailureKind, message: string) {
    super(message)
    this.kind = kind
    this.name = 'LLMError'
  }
}

const BALANCE_HINTS = [
  'insufficient_balance',
  'insufficient balance', // sub2api/上游返回空格变体
  'insufficient_quota',
  'no available accounts',
  '余额不足',
  '无可用账户',
  'no available',
  'account balance',
]
const QUOTA_HINTS = ['quota', '超出配额', 'token 用尽', 'token用完', 'limit reached', 'exceed']
const RATE_HINTS = ['rate', 'tpm', 'rpm', '限流', 'too many request', 'frequency']

/**
 * 调用 Anthropic Messages API（兼容 sub2api / DeepSeek anthropic 端点）。
 * baseUrl 例如 http://localhost:8180 或 https://api.deepseek.com/anthropic
 */
export async function chatCompletion(
  cfg: LLMConfig,
  system: string,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string> {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const url = `${base}/v1/messages`

  const body: Record<string, unknown> = {
    model: cfg.model || 'claude-sonnet-4-5-20250929',
    // 思考型模型会把输出额度先花在 thinking 上，小额很容易被吃光导致正文为空
    max_tokens: opts.maxTokens ?? 1024,
    system,
    messages,
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new LLMError('network', `网络错误：无法连接 ${cfg.baseUrl}（${(e as Error).message}）`)
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j?.error?.message || j?.message || detail
    } catch {
      /* 保留默认 */
    }
    throw new LLMError(classifyFailure(res.status, detail), `AI 请求失败：${detail}`)
  }

  const data = await res.json()
  const content: unknown[] = data?.content ?? []
  const text = content
    .filter((b) => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .join('')
    .trim()
  // 思考模型的 thinking 占满 max_tokens 时 text 可能为空 → 用思考内容兜底，避免对话中断
  const thinking = content
    .filter((b) => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'thinking')
    .map((b) => (b as { thinking?: string }).thinking ?? '')
    .join('')
    .trim()
  const final = text || thinking
  if (!final) throw new LLMError('empty', 'AI 返回为空（可能是思考模型 max_tokens 被 thinking 占满，请调大）')
  return final
}

/** 依据状态码 + 错误文本分类失败原因，决定要不要重试、给用户什么提示 */
export function classifyFailure(status: number, detail: string): LLMFailureKind {
  const lower = detail.toLowerCase()
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'balance'
  if (status === 429) return 'rate'
  if (status >= 500) return 'server'
  if (BALANCE_HINTS.some((h) => lower.includes(h))) return 'balance'
  if (QUOTA_HINTS.some((h) => lower.includes(h))) return 'quota'
  if (RATE_HINTS.some((h) => lower.includes(h))) return 'rate'
  return 'unknown'
}

/** 面向用户的可操作提示：余额/限流给出明确指引，而不是甩一段原始错误 */
export function friendlyFailure(kind: LLMFailureKind, detail: string): string {
  switch (kind) {
    case 'balance':
      return 'AI 账户余额/配额不足（或当前时刻没有可用账户）。本对话已自动切入本地问答模式，核心概念仍可答疑。'
    case 'quota':
      return 'AI 配额已用尽。本对话已自动切入本地问答模式。'
    case 'rate':
      return 'AI 端点触发限流（请求太频繁）。已自动切入本地问答模式，等一下再试 AI 对话。'
    case 'auth':
      return 'API Key 无效或端点拒绝访问，请检查「设置」里的 Base URL 与 Key。'
    case 'network':
      return detail
    case 'server':
      return 'AI 端点暂时不可用（服务端错误），已自动切入本地问答模式。'
    default:
      return detail
  }
}

/** 简单检测配置是否有效 */
export function isLLMConfigured(cfg: LLMConfig): boolean {
  return !!(cfg.baseUrl && cfg.apiKey && cfg.model)
}

// ── Token 预算：多轮历史按"字符预算"裁剪，优先保留最近的对话 ──

/** 把该代理的历史对话压到预算字符内（中文约 1 字符 ≈ 0.7 token，留裕量） */
export function trimHistory<T extends { role: string; content: string }>(
  turns: T[],
  agentId: string,
  budgetChars = 1600
): T[] {
  const mine = turns.filter((t) => (t as { agentId?: string }).agentId === agentId)
  const out: T[] = []
  let size = 0
  for (let i = mine.length - 1; i >= 0; i--) {
    const t = mine[i]
    // 每条对话头部近似 cost = 40 固定开销（role/结构），正文按字符计
    const cost = 40 + t.content.length
    if (out.length && size + cost > budgetChars) break
    out.unshift(t)
    size += cost
  }
  return out
}

/** 阅读上下文预算裁剪：保留开头（主题句）与结尾（最贴近当前阅读位置），中间省略 */
export function trimContext(context: string, budgetChars = 500): string {
  if (!context) return ''
  if (context.length <= budgetChars) return context
  const head = context.slice(0, Math.floor(budgetChars * 0.35))
  const tail = context.slice(-Math.ceil(budgetChars * 0.6))
  return `${head}\n…（中间省略）…\n${tail}`
}