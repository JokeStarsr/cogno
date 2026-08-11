import type { ChatMessage, LLMConfig } from '../types'

export interface ChatOptions {
  maxTokens?: number
  /** 携带阅读上下文片段 */
  context?: string
  /** 用户概念背景（让连接者能做类比） */
  masteredLabels?: string[]
}

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
    max_tokens: opts.maxTokens ?? 700,
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
    throw new Error(`网络错误：无法连接 ${cfg.baseUrl}（${(e as Error).message}）`)
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j?.error?.message || j?.message || detail
    } catch {
      /* 保留默认 */
    }
    throw new Error(`AI 请求失败：${detail}`)
  }

  const data = await res.json()
  const content: unknown[] = data?.content ?? []
  const text = content
    .filter((b) => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .join('')
  if (!text) throw new Error('AI 返回为空')
  return text
}

/** 简单检测配置是否有效 */
export function isLLMConfigured(cfg: LLMConfig): boolean {
  return !!(cfg.baseUrl && cfg.apiKey && cfg.model)
}
