import { nodeById } from '../data/dsAlgoGraph'

/** 扫描文本中命中的知识图谱概念；去重由调用方的 seen 集合负责 */
export function scanConceptsInText(text: string, onHit: (conceptId: string) => void, seen: Set<string>): void {
  for (const n of nodeById.values()) {
    if (seen.has(n.id)) continue
    if (text.includes(n.label)) {
      seen.add(n.id)
      onHit(n.id)
    }
  }
}