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
 * 从已掌握集合出发，求到目标的学习路径。
 * 返回按学习顺序排列的节点 id 序列（含目标），满足闭包性：
 * 路径中每个节点的未掌握前置都出现在它之前（拓扑序），因此按序学即可。
 * 若目标已被掌握，直接返回 [target]。
 */
export function findLearningPath(targetId: string, masteredIds: Set<string>): string[] {
  if (masteredIds.has(targetId)) return [targetId]

  // 1) 收集"尚需学习"的闭包：目标的全部未掌握前置（含间接）
  const needed = new Map<string, Set<string>>() // 节点 id → 其未掌握的直接前置
  const visited = new Set<string>([targetId])
  const queue = [targetId]
  while (queue.length) {
    const cur = queue.shift()!
    const unmastered = getConcept(cur).dependencies.filter((d) => !masteredIds.has(d))
    needed.set(cur, new Set(unmastered))
    for (const d of unmastered) {
      if (!visited.has(d)) {
        visited.add(d)
        queue.push(d)
      }
    }
  }

  // 2) 按依赖先行拓扑排序（图是 DAG，done 集合防重复访问）
  const order: string[] = []
  const done = new Set<string>()
  const visit = (id: string) => {
    if (done.has(id)) return
    done.add(id)
    for (const dep of needed.get(id) ?? []) visit(dep)
    order.push(id)
  }
  visit(targetId)
  return order
}

/** 阻塞度：缺失该概念会阻碍多少个后继概念学习 */
export function blockageScore(id: string): number {
  return allDependents(id).size
}
