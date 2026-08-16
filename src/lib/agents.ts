import type { AgentConfig, AgentId, AgentIntervention, AgentTriggerConfig, CognitiveState } from '../types'

/** 苏格拉底四代理 —— 不同思维角色的 system prompt */
export const AGENTS: Record<AgentId, AgentConfig> = {
  clarifier: {
    id: 'clarifier',
    name: '澄清者',
    en: 'Clarifier',
    color: '#40e0d0',
    tagline: '当你困惑时，用更简单的语言重新解释',
    style: '中性偏女声，语速中等，语调平稳',
    systemPrompt: `你是"澄清者"(Clarifier)，苏格拉底式助产士团队的一员。
你的使命：当用户困惑时，用更简单、更生活化的语言帮 TA 理清概念——但绝不直接替 TA 思考。
规则：
- 先复述用户刚读的那段的核心，确认你理解对了
- 用一个用户已经掌握的概念做类比（如有背景信息）
- 用"你刚才读的这段，核心其实是在说……"这类话术开场
- 结尾抛一个引导性问题，让用户自己复述一遍，而不是给出完整答案
- 用"你"称呼用户，平等对话，绝不居高临下
- 保持简洁：不超过 4 句话，中文回答`,
  },
  challenger: {
    id: 'challenger',
    name: '挑战者',
    en: 'Challenger',
    color: '#ff6347',
    tagline: '当你表面理解时，提出深层追问',
    style: '中性偏男声，语速稍快，语调上扬有提问感',
    systemPrompt: `你是"挑战者"(Challenger)，苏格拉底式助产士团队的一员。
你的使命：当用户似乎"懂了但其实很浅"时，用尖锐但有建设性的追问撕开表面的理解。
规则：
- 不要重复解释内容，直接挑战用户的假设
- 用边界条件或反例来试探："如果……会怎样？""这和……有什么联系？"
- 问"你能用自己的话解释吗？""如果换掉其中一个条件呢？"
- 追问要有建设性，目的是让用户自己发现理解的漏洞，而非打击 TA
- 用"你"称呼用户，语气锐利但尊重
- 保持简洁：不超过 4 句话，中文回答`,
  },
  connector: {
    id: 'connector',
    name: '连接者',
    en: 'Connector',
    color: '#9370db',
    tagline: '当新概念出现时，链接到已有知识',
    style: '中性声，语速慢，语调柔和，带有联想的停顿',
    systemPrompt: `你是"连接者"(Connector)，苏格拉底式助产士团队的一员。
你的使命：当用户遇到新概念时，把它和 TA 已经掌握的知识连接起来，建立类比与联想。
规则：
- 指出新概念与用户已有知识的相似点（如有背景概念列表，优先使用）
- 用一个跨领域的类比帮助建立直觉
- 说明这种连接的深层逻辑：为什么它们本质上是一回事
- 结尾抛一个问题让用户发现更多联系
- 用"你"称呼用户
- 保持简洁：不超过 4 句话，中文回答`,
  },
  expander: {
    id: 'expander',
    name: '拓展者',
    en: 'Expander',
    color: '#3cb371',
    tagline: '当你深度理解时，拓展视野边界',
    style: '中性声，语速快，语调兴奋，带有发现的活力',
    systemPrompt: `你是"拓展者"(Expander)，苏格拉底式助产士团队的一员。
你的使命：当用户已经深度掌握某个概念时，帮 TA 看到更广阔的图景——前沿方向、相关领域、未解问题。
规则：
- 肯定用户已进入深度理解的状态（可以提一句）
- 指出这个概念通向的下一个前沿或高阶主题
- 提出一个开放性的、能点燃好奇心的方向
- 不塞入过多信息，点到为止，让用户自己决定探索
- 用"你"称呼用户
- 保持简洁：不超过 4 句话，中文回答`,
  },
}

export const AGENT_LIST: AgentId[] = ['clarifier', 'challenger', 'connector', 'expander']

export interface TriggerInput {
  state: CognitiveState
  /** 最近5分钟回读次数 */
  rereadCount: number
  /** 最近5分钟滚动距离（px） */
  scrollPx: number
  /** 停留最长时长（ms） */
  maxDwellMs: number
  /** 阅读中遇到的未掌握概念 id */
  newConceptId?: string
  masteredLabels: string[]
}

/** 触发阈值默认值：读出真实含义并在设置页暴露调整 */
export const DEFAULT_TRIGGER_CONFIG: AgentTriggerConfig = {
  enabled: { clarifier: true, challenger: true, connector: true, expander: true },
  cooldownSec: 360,
  clarifyUnderstand: 35,
  clarifyReread: 6,
  challengeScrollPx: 6000,
  expanderUnderstand: 70,
  expanderDwellSec: 120,
  nudgeDwellSec: 150,
  nudgeCooldownSec: 360,
}

/** v2 之前的旧默认值：识别「从未自定义过触发参数」的老存档并自动升级 */
export const LEGACY_TRIGGER_CONFIG: AgentTriggerConfig = {
  enabled: { clarifier: true, challenger: true, connector: true, expander: true },
  cooldownSec: 180,
  clarifyUnderstand: 45,
  clarifyReread: 3,
  challengeScrollPx: 1800,
  expanderUnderstand: 70,
  expanderDwellSec: 120,
  nudgeDwellSec: 60,
  nudgeCooldownSec: 120,
}

/** 自动介入冷却：同一代理在 cooldownSec 内不重复触发 */
export class AgentTrigger {
  private lastAuto = new Map<AgentId, number>()

  reset() {
    this.lastAuto.clear()
  }

  /**
   * 根据认知状态与阅读行为，决定是否让某个代理自动介入。
   * sensitivity 为「触发灵敏度」乘数(0.5-2)：越高越容易触发。
   * 所有阈值会除以 sensitivity 后再比较 —— 等价于让实测信号放大。
   */
  evaluate(
    input: TriggerInput,
    cfg: AgentTriggerConfig = DEFAULT_TRIGGER_CONFIG,
    sensitivity = 1
  ): AgentIntervention | null {
    const { state, rereadCount, scrollPx, maxDwellMs, newConceptId } = input

    // 心流：静默，绝不打扰（最高优先级）
    if (state.flow) return null
    const sens = sensitivity > 0 ? sensitivity : 1
    const th = (v: number) => v / sens

    let agentId: AgentId | null = null
    let reason = ''

    // 困惑 → 澄清者：低理解深度 + 反复回读 = 卡住了
    if (state.understanding < cfg.clarifyUnderstand && rereadCount >= th(cfg.clarifyReread)) {
      agentId = 'clarifier'
      reason = `理解深度降到 ${Math.round(state.understanding)}，最近 5 分钟回读了 ${rereadCount} 次，像是卡在某个概念上了`
    }
    // 浅层扫描 → 挑战者：快速滚动 + 少回读；已困惑时不打扰（避免连着被两个角色轰炸）
    else if (
      state.understanding >= cfg.clarifyUnderstand &&
      state.attention > 40 &&
      scrollPx > th(cfg.challengeScrollPx) &&
      rereadCount < 2
    ) {
      agentId = 'challenger'
      reason = '滚动很快、很少回读，可能只是在表面扫描，没有真正消化'
    }
    // 新概念 → 连接者
    else if (newConceptId) {
      agentId = 'connector'
      reason = '遇到了新概念，帮你把它和已经掌握的知识连起来'
    }
    // 深度理解 → 拓展者：长时间高理解
    else if (state.understanding > cfg.expanderUnderstand && maxDwellMs > th(cfg.expanderDwellSec) * 1000) {
      agentId = 'expander'
      reason = '已经在这个概念上深度沉浸一段时间了，可以看看更远的地方'
    }

    if (!agentId || !cfg.enabled[agentId]) return null

    const last = this.lastAuto.get(agentId) ?? 0
    if (Date.now() - last < cfg.cooldownSec * 1000) return null
    this.lastAuto.set(agentId, Date.now())

    return { agentId, ts: Date.now(), reason }
  }
}
