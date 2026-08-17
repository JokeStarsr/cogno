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
  /** 续读恢复：PDF 上次读到第几页（0 基） */
  lastPage?: number
  /** 续读恢复：文本模式上次滚动位置 */
  lastScrollTop?: number
  createdAt: number
}

/** 苏格拉底自动介入触发配置（默认值见 agents.ts 的 DEFAULT_TRIGGER_CONFIG） */
export interface AgentTriggerConfig {
  /** 各代理是否允许自动介入 */
  enabled: Record<AgentId, boolean>
  /** 同一代理两次自动介入的最小间隔（秒） */
  cooldownSec: number
  /** 冷静期：最近翻页/滚动 N 秒内不自动介入（专用思考时间） */
  calmSec: number
  /** 澄清者触发：当前页停留 ≥ N 秒 */
  clarifyDwellSec: number
  /** 澄清者触发：且该页回读（离开后重进入）≥ N 次 */
  clarifyPageReread: number
  /** 挑战者触发：翻页速率(页/分)超过个人基线 ×N */
  challengerRateMult: number
  /** 挑战者触发：无个人基线(样本不足)时速率直接超过此值(页/分) */
  challengerFallbackRate: number
  /** 挑战者触发：速率统计窗口（分钟） */
  challengerWindowMin: number
  /** 拓展者触发：当前页停留 ≥ N 秒 且该页无回读 */
  expanderDwellSec: number
  /** 主动提问气泡：当前页停留 ≥ N 秒 */
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
