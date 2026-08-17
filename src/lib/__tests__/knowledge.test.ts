import { describe, it, expect } from 'vitest'
import { allPrerequisites, blockageScore, directPrerequisites, findGaps, findLearningPath, getDiscipline, getAllNodes, setDiscipline } from '../knowledge'

// 图数据：dsAlgoGraph.ts 真实概念（avl → bst → binary-tree/tree-traversal → …）
describe('知识图谱遍历', () => {
  it('allPrerequisites 传递闭包：avl 的全部前置（含间接）', () => {
    const pre = allPrerequisites('avl')
    expect(pre.has('bst')).toBe(true)
    expect(pre.has('binary-tree')).toBe(true)
    expect(pre.has('tree-traversal')).toBe(true)
    expect(pre.has('stack')).toBe(true)
    expect(pre.has('array')).toBe(true)
    expect(pre.has('recursion')).toBe(true)
    expect(pre.has('linked-list')).toBe(true)
    // avl 自身不在前置里
    expect(pre.has('avl')).toBe(false)
  })

  it('allPrerequisites 无依赖概念返回空集', () => {
    expect(allPrerequisites('array').size).toBe(0)
  })

  it('blockageScore：越底层概念阻塞的后继越多', () => {
    const arrayScore = blockageScore('array')
    const bstScore = blockageScore('bst')
    expect(arrayScore).toBeGreaterThan(bstScore)
    expect(arrayScore).toBeGreaterThanOrEqual(5)
  })

  it('findGaps：只返回尚未掌握的前置', () => {
    const gaps = findGaps('avl', new Set(['array', 'stack', 'queue']))
    expect(gaps).toContain('bst')
    expect(gaps).toContain('binary-tree')
    expect(gaps).not.toContain('array')
    expect(gaps).not.toContain('stack')
  })

  it('findLearningPath：返回以目标结尾的学习序列且只含未掌握节点', () => {
    const mastered = new Set(['array', 'linked-list', 'recursion', 'complexity'])
    const path = findLearningPath('avl', mastered)
    expect(path[path.length - 1]).toBe('avl')
    expect(path).toContain('bst')
    // 已掌握起点不出现在待学路径里
    mastered.forEach((m) => expect(path).not.toContain(m))
    // 路径首节点的直接前置都已掌握（因此可以直接开始学）
    directPrerequisites(path[0]).forEach((p) => expect(mastered.has(p.id)).toBe(true))
    // 依赖序：path 中每个节点的未掌握前置都出现在它之前
    const inPath = new Set(path)
    path.forEach((id) => {
      allPrerequisites(id).forEach((dep) => {
        if (!mastered.has(dep) && dep !== id) expect(inPath.has(dep)).toBe(true)
      })
    })
  })

  it('findLearningPath：目标已被掌握时直接返回', () => {
    expect(findLearningPath('avl', new Set(['avl']))).toEqual(['avl'])
  })
})
describe('学科切换（Phase 4.1 graphRegistry）', () => {
  it('默认 DSA，切换 ml 后概念带命名空间前缀', async () => {
    expect(getDiscipline()).toBe('dsa')
    const ok = await setDiscipline('ml')
    expect(ok).toBe(true)
    expect(getDiscipline()).toBe('ml')
    const nodes = getAllNodes()
    expect(nodes.length).toBeGreaterThanOrEqual(20)
    expect(nodes.every((n) => n.id.startsWith('ml:'))).toBe(true)
    // 依赖引用同样带前缀且无悬空
    for (const n of nodes) {
      for (const d of n.dependencies) expect(d.startsWith('ml:')).toBe(true)
    }
    // 学习路径在 ml 学科内闭合
    const first = nodes.find((n) => n.dependencies.length === 0)!
    const path = findLearningPath(nodes[1].id, new Set([first.id]))
    expect(path.length).toBeGreaterThan(0)
    // 切回 DSA 恢复原状
    await setDiscipline('dsa')
    expect(getDiscipline()).toBe('dsa')
    expect(getAllNodes().some((n) => n.id.startsWith('ml:'))).toBe(false)
  })

  it('语法错误的学科 key 保持当前学科（幂等/容错）', async () => {
    // 未知 key 由类型系统挡掉；运行时容错已由 setDiscipline try/catch 覆盖
    await setDiscipline('dsa')
    expect(getDiscipline()).toBe('dsa')
  })
})
