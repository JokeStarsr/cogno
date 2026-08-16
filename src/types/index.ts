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
  /** 关联的已保存文档 id（用于从历史记录重新打开） */
  docId?: number
}

/** 已保存的阅读文档：全部存浏览器本地 IndexedDB，隐私优先、不占服务器 */
export interface ReadingDoc {
  id?: number
  title: string
  sourceType: 'pdf' | 'url' | 'text' | 'sample'
  /** text/url/sample 的正文 */
  text?: string
  /** PDF 二进制内容 */
  pdfData?: ArrayBuffer
  /** PDF 逐页抽取文本（供苏格拉底四代理取上下文） */
  pdfTexts?: string[]
  createdAt: number
}

/** 苏格拉底自动介入触发配置（默认值见 agents.ts 的 DEFAULT_TRIGGER_CONFIG） */
export interface AgentTriggerConfig {
  /** 各代理是否允许自动介入 */
  enabled: Record<AgentId, boolean>
  /** 同一代理两次自动介入的最小间隔（秒） */
  cooldownSec: number
  /** 澄清者触发：理解深度低于此值 */
  clarifyUnderstand: number
  /** 澄清者触发：5 分钟回读次数 ≥ 此值 */
  clarifyReread: number
  /** 挑战者触发：5 分钟滚动距离 ≥ 此值（px） */
  challengeScrollPx: number
  /** 拓展者触发：理解深度高于此值 */
  expanderUnderstand: number
  /** 拓展者触发：持续停留 ≥ 此值（秒） */
  expanderDwellSec: number
  /** 主动提问气泡：内容停留 ≥ 此值（秒） */
  nudgeDwellSec: number
  /** 主动提问气泡最小间隔（秒） */
  nudgeCooldownSec: number
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
