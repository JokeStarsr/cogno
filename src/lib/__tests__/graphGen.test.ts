import { describe, it, expect } from 'vitest'
import { extractGraphJson, validateGraph, hasCycle, conceptsToTsSource, repairIds, type GenConcept } from '../graphGen'

const VALID: GenConcept[] = [
  { id: 'math', label: '数学', description: '基础学科', dependencies: [], difficulty: 1 },
  { id: 'ml', label: '机器学习', description: '从数据学习', dependencies: ['math'], difficulty: 2 },
  { id: 'dl', label: '深度学习', description: '神经网络学习', dependencies: ['ml'], difficulty: 3 },
]

describe('extractGraphJson', () => {
  it('解析纯 JSON', () => {
    expect(extractGraphJson(JSON.stringify(VALID))?.length).toBe(3)
  })
  it('容忍代码块包裹', () => {
    expect(extractGraphJson('```json\n' + JSON.stringify(VALID) + '\n```')?.length).toBe(3)
  })
  it('非法 JSON 返回 null', () => {
    expect(extractGraphJson('')).toBeNull()
    expect(extractGraphJson('这是文本')).toBeNull()
  })
})

describe('validateGraph', () => {
  it('合法 DAG 通过', () => {
    const r = validateGraph(VALID)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('重复 id 报错', () => {
    const dup = [...VALID, { ...VALID[0] }]
    const r = validateGraph(dup)
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('重复 id')
  })

  it('环检测报错', () => {
    const cyclic: GenConcept[] = [
      { id: 'a', label: 'A', description: '描述', dependencies: ['b'], difficulty: 1 },
      { id: 'b', label: 'B', description: '描述', dependencies: ['a'], difficulty: 1 },
      { id: 'c', label: 'C', description: '描述', dependencies: [], difficulty: 1 },
    ]
    expect(hasCycle(cyclic)).toBe(true)
    expect(validateGraph(cyclic).errors.join()).toContain('环')
  })

  it('无环 DAG 通过 hasCycle', () => {
    expect(hasCycle(VALID)).toBe(false)
  })

  it('悬空依赖只警告不拒绝', () => {
    const d: GenConcept[] = [...VALID, { id: 'x', label: 'X', description: '描述', dependencies: ['外部概念'], difficulty: 1 }]
    const r = validateGraph(d)
    expect(r.ok).toBe(true)
    expect(r.warnings.join()).toContain('外部概念')
  })

  it('数量不足直接拒绝', () => {
    const r = validateGraph(VALID.slice(0, 2))
    expect(r.ok).toBe(false)
  })
})

describe('conceptsToTsSource', () => {
  it('生成可编译的 TS 字面量（含引号转义）', () => {
    const withQuote: GenConcept[] = [
      { ...VALID[0], label: "引号'测试", description: "描述'含引号" },
    ]
    const src = conceptsToTsSource(withQuote, 'TEST_GRAPH')
    expect(src).toContain("label: '引号\\'测试'")
    expect(src).toContain("描述\\'含引号")
    expect(src).toContain('export const TEST_GRAPH: ConceptNode[] = [')
    expect(src).toContain("import type { ConceptNode } from '../types'")
  })

  it('domain 缺省输出「通用」，满足 ConceptNode 类型', () => {
    const src = conceptsToTsSource(VALID, 'G')
    expect(src).toContain("domain: '通用'")
  })
})

describe('repairIds', () => {
  it('把非法 id 规范化，并重指依赖引用', () => {
    const messy: GenConcept[] = [
      { id: 'good-id', label: '好概念', description: '描述', dependencies: ['bad id'], difficulty: 1 },
      { id: 'bad id', label: '含空格', description: '描述', dependencies: [], difficulty: 1 },
      { id: '', label: '空id', description: '描述', dependencies: [], difficulty: 1 },
    ]
    const r = repairIds(messy)
    expect(r).toHaveLength(3)
    expect(r[0].id).toBe('good-id')
    // 空格/空 id 被替换为 concept-N
    expect(r).not.toContain(r[0].dependencies[0])
    // 依赖引用指向新 id
    expect(repairIds(messy)[0].dependencies[0]).toMatch(/^concept-\d+$/)
    expect(validateGraph(repairIds(messy)).errors).toEqual([])
  })

  it('重复 id 保持唯一', () => {
    const dup: GenConcept[] = [VALID[0], { ...VALID[0] }]
    const r = repairIds(dup)
    expect(new Set(r.map((c) => c.id)).size).toBe(2)
  })
})