import { nodeById } from '../data/dsAlgoGraph'
import { AGENTS } from './agents'
import type { AgentId, ConceptNode } from '../types'

/**
 * 本地降级问答引擎：AI 端点不可用 / 余额不足 / 未配置时，四代理退化为
 * 基于知识图谱的苏格拉底式话术 —— 产品在 token 用尽时依然能答疑与对话，
 * 对话流程不断裂。命中知识图谱概念即返回本地答复。
 */

/** 中文相邻 2-gram（如"动态规划" → 动态/态规/规划） */
function cjk2grams(s: string): Set<string> {
  const out = new Set<string>()
  const run = s.match(/[一-龥]+/g)
  if (!run) return out
  for (const r of run) {
    for (let i = 0; i + 1 < r.length; i++) out.add(r.slice(i, i + 2))
  }
  return out
}

/** 英文/数字词元（如 KMP、DP、O(log n) 中的 KMP） */
function words(s: string): Set<string> {
  return new Set(s.match(/[a-zA-Z0-9]+/g) ?? [])
}

/**
 * 从用户问题里找命中的概念：2-gram 重叠评分。
 * 完整标签命中（如"哈希表"）得高分；"动态规划到底怎么用" 这类口语
 * 通过"动态、规划"gram 撞上"动态规划基础"，避免"动态规划"问而不得。
 */
function matchConcept(text: string): ConceptNode | null {
  const textWords = words(text)
  let best: ConceptNode | null = null
  let bestScore = 0
  for (const n of nodeById.values()) {
    let score = 0
    if (text.includes(n.label)) {
      score = n.label.length * 4
    } else {
      const grams = cjk2grams(n.label)
      for (let i = 0; i + 1 < text.length; i++) {
        if (grams.has(text.slice(i, i + 2))) score += 2
      }
      for (const w of words(n.label)) {
        if (textWords.has(w) && w.length >= 2) score += 2
      }
    }
    if (score > bestScore) {
      bestScore = score
      best = n
    }
  }
  return bestScore >= 2 ? best : null
}

function prereqLabels(n: ConceptNode): string {
  const deps = n.dependencies.map((d) => nodeById.get(d)?.label).filter(Boolean)
  return deps.length ? deps.join('、') : '无（它是最基础的概念）'
}

/** 顶级后继（直接依赖它的概念），供"往哪走"使用 */
function nextLabels(n: ConceptNode): string {
  const next: string[] = []
  for (const m of nodeById.values()) {
    if (m.dependencies.includes(n.id) && nodeById.get(m.id)) next.push(m.label)
  }
  return next.length ? next.join('、') : '（它是当前分支的顶端）'
}

/** 同一领域内的相关概念，做类比用（共享前置） */
function siblingLabels(n: ConceptNode): string {
  const seen = new Set(n.dependencies)
  const out: string[] = []
  for (const m of nodeById.values()) {
    if (m.id === n.id) continue
    if (m.dependencies.some((d) => seen.has(d))) out.push(m.label)
  }
  return out.slice(0, 3).join('、')
}

const REPLIES: Record<AgentId, (n: ConceptNode) => string> = {
  clarifier: (n) =>
    `（本地苏格拉底）把「${n.label}」换一种说法：${n.description}\n` +
    `打个比方——它和「${siblingLabels(n) || prereqLabels(n)}」是同一套思维的花样。\n` +
    `你能不能在纸上用一句话写下它的关键步骤，讲给我听？`,
  challenger: (n) =>
    `（本地苏格拉底）好，来硬的：「${n.label}」——如果输入数据变成 1 个元素，算法还成立吗？\n` +
    `换个角度：把其中一步的条件反过来，会发生什么？它依赖的前置「${prereqLabels(n)}」里，哪一环其实还可以被替代？\n` +
    `别急着回答，把"边界情况"在心里过一遍。`,
  connector: (n) =>
    `（本地苏格拉底）注意看：「${n.label}」和你已经熟悉的「${siblingLabels(n) || prereqLabels(n)}」共享同一套前置思维。\n` +
    `它们的共同土壤是「${prereqLabels(n)}」——这说明了这类问题共有的底层结构。\n` +
    `你能再举一个现实里长得完全不像、本质却一样的例子吗？`,
  expander: (n) =>
    `（本地苏格拉底）你已经吃透了「${n.label}」。往上看，它通向「${nextLabels(n)}」——\n` +
    `更难的版本通常是给约束加码，或者把它和别的技巧缝合。\n` +
    `如果现在让你设计一道用它做核心的竞赛题，你会卡住怎样的人？（暗示：卡在它的边界条件上的人）`,
}

// 每个代理每次会话最多回两轮本地话术，避免模板复读令人厌烦
const replyBudget = new Map<AgentId, number>()

export function resetLocalBudget() {
  replyBudget.clear()
}

export function localAgentReply(agentId: AgentId, userText: string): string | null {
  const hit = matchConcept(userText)
  if (!hit) return null
  const used = replyBudget.get(agentId) ?? 0
  if (used >= 2) return null
  replyBudget.set(agentId, used + 1)
  const reply = REPLIES[agentId](hit)
  const tag = AGENTS[agentId].name
  return `${tag}：${reply}\n\n（当前为本地离线应答，未消耗 AI 额度，保持思考不停）`
}