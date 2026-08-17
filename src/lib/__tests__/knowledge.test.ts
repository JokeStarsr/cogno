import { describe, it, expect } from 'vitest'
import { allPrerequisites, blockageScore, directPrerequisites, findGaps, findLearningPath } from '../knowledge'

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