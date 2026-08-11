/** 全局共享类型 */

export type AgentId = 'clarifier' | 'challenger' | 'connector' | 'expander'

export interface CognitiveState {
  /** 理解深度 0-100 */
  understanding: number
  /** 注意力 0-100 */
  attention: number
  /** 疲劳度 0-100 */
  fatigue: number
  /** 思维发散度 0-100 */
  divergence: number
  /** 心流状态 */
  flow: boolean
}

export interface CognitiveSample extends CognitiveState {
  ts: number
}

export interface GazePoint {
  x: number
  y: number
  ts: number
}

/** 掌握程度：0 未学习 / 1 学习中 / 2 基本掌握 / 3 深度掌握 */
export type Mastery = 0 | 1 | 2 | 3

export interface ConceptNode {
  id: string
  label: string
  domain: string
  description: string
  /** 依赖的前置概念 id 列表 */
  dependencies: string[]
  difficulty: 1 | 2 | 3
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AgentIntervention {
  agentId: AgentId
  ts: number
  /** 触发原因（可解释性） */
  reason: string
  /** 阅读上下文片段 */
  context?: string
}

export interface AgentConfig {
  id: AgentId
  name: string
  en: string
  color: string
  /** 一句话定位 */
  tagline: string
  /** 典型话术前缀 */
  style: string
  systemPrompt: string
}

export interface LLMConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ReadingSession {
  id?: number
  title: string
  sourceType: 'pdf' | 'url' | 'text' | 'sample'
  startedAt: number
  endedAt?: number
  durationSec: number
  /** 学习过程中点亮的节点 id 集合 */
  conceptsTouched: string[]
  agentInterventions: number
}

export interface ReviewItem {
  conceptId: string
  mastery: Mastery
  reviewCount: number
  lastReviewedAt: number
  nextReviewAt: number
  /** 历史掌握度，用于画曲线 */
  history: { at: number; mastery: Mastery }[]
}

export type ViewId = 'dashboard' | 'reader' | 'settings'
