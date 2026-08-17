/**
 * 学科图谱注册表（Phase 4.1 收尾）：
 * 每个学科一个 key，节点集合可异步加载（Vite 按需分包，非当前学科不进主包）。
 * 非 DSA 学科的概念 id 统一加 `key:` 前缀作命名空间，避免跨学科 id 冲突
 * （如 dsa 的 `stack` 与 ml 的 `stack` 不会互相干扰）。
 */
import type { ConceptNode } from '../types'
import { DS_ALGO_GRAPH } from '../data/dsAlgoGraph'

export type DisciplineKey = 'dsa' | 'ml'

export interface DisciplineInfo {
  key: DisciplineKey
  name: string
  description: string
}

export const DISCIPLINES: DisciplineInfo[] = [
  { key: 'dsa', name: '数据结构与算法', description: '内置核心学科，离线可用' },
  { key: 'ml', name: '机器学习', description: 'LLM 生成（2026-08-18，39 概念）' },
]

export function disciplineName(key: DisciplineKey): string {
  return DISCIPLINES.find((d) => d.key === key)?.name ?? key
}

/** 异步加载某学科的完整节点集合（含 id 命名空间化）。dsa 为静态同步源 */
export async function loadDisciplineNodes(key: DisciplineKey): Promise<ConceptNode[]> {
  if (key === 'dsa') return DS_ALGO_GRAPH
  if (key === 'ml') {
    const mod = await import('../data/machineLearning')
    const prefix = `${key}:`
    return mod.MACHINE_LEARNING_GRAPH.map((c) => ({
      ...c,
      id: `${prefix}${c.id}`,
      dependencies: c.dependencies.map((d) => `${prefix}${d}`),
    }))
  }
  return DS_ALGO_GRAPH
}