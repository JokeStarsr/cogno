import { DS_ALGO_GRAPH, nodeById } from '../data/dsAlgoGraph'
import type { ConceptNode } from '../types'

export function getAllNodes(): ConceptNode[] {
  return DS_ALGO_GRAPH
}

export function getConcept(id: string): ConceptNode {
  const n = nodeById.get(id)
  if (!n) throw new Error(`概念不存在: ${id}`)
  return n
}

/** 直接前置概念 */
export function directPrerequisites(id: string): ConceptNode[] {
  return getConcept(id).dependencies.map((d) => getConcept(d))
}

/** 传递闭包：目标概念的全部前置（含间接） */
export function allPrerequisites(id: string): Set<string> {
  const out = new Set<string>()
  const stack = [...getConcept(id).dependencies]
  while (stack.length) {
    const cur = stack.pop()!
    if (out.has(cur)) continue
    out.add(cur)
    for (const d of getConcept(cur).dependencies) stack.push(d)
  }
  return out
}

/** 传递闭包：依赖该概念的全部后继（含间接） */
export function allDependents(id: string): Set<string> {
  const out = new Set<string>()
  const stack = DS_ALGO_GRAPH.filter((n) => n.dependencies.includes(id)).map((n) => n.id)
  while (stack.length) {
    const cur = stack.pop()!
    if (out.has(cur)) continue
    out.add(cur)
    for (const n of DS_ALGO_GRAPH) {
      if (n.dependencies.includes(cur)) stack.push(n.id)
    }
  }
  return out
}

/** 目标概念缺失的前置概念（尚未掌握的那些） */
export function findGaps(targetId: string, masteredIds: Set<string>): string[] {
  const prereqs = allPrerequisites(targetId)
  return [...prereqs].filter((p) => !masteredIds.has(p))
}

/**
 * 从已掌握集合出发，沿依赖边求到目标的最短学习路径。
 * 返回按学习顺序排列的节点 id 序列（含目标）。
 */
export function findLearningPath(targetId: string, masteredIds: Set<string>): string[] {
  if (masteredIds.has(targetId)) return [targetId]
  // 反向边：from 依赖 to，即 from -> to 表示"要先学 to"
  // 我们希望从 mastered 走到 target，沿依赖反向传播
  const parents = new Map<string, string>()
  const visited = new Set<string>(masteredIds)
  const queue = [...masteredIds]
  while (queue.length) {
    const cur = queue.shift()!
    // 所有依赖了 cur 的节点（cur 是它们的前置）
    for (const n of DS_ALGO_GRAPH) {
      if (!n.dependencies.includes(cur)) continue
      if (visited.has(n.id)) continue
      visited.add(n.id)
      parents.set(n.id, cur)
      if (n.id === targetId) break
      queue.push(n.id)
    }
    if (parents.has(targetId)) break
  }
  if (!parents.has(targetId)) {
    // 不可达（例如缺少中间依赖数据）——退化为缺口提示
    return []
  }
  const path: string[] = []
  let cur: string | undefined = targetId
  while (cur !== undefined) {
    path.unshift(cur)
    cur = parents.get(cur)
  }
  return path
}

/** 阻塞度：缺失该概念会阻碍多少个后继概念学习 */
export function blockageScore(id: string): number {
  return allDependents(id).size
}
