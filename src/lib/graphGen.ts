/**
 * LLM 知识图谱生成的数据校验层（Phase 4.1）。
 * 纯函数，供 scripts/generate-graph.ts 调用，也在单测覆盖。
 * 独立于图谱文件格式（dsAlgoGraph.ts 的 ConceptNode 结构一致）。
 */

export interface GenConcept {
  id: string
  label: string
  description: string
  dependencies: string[]
  difficulty: 1 | 2 | 3
  /** 领域分组（dsAlgoGraph.ts 的 ConceptNode 必需字段，缺省归入「通用」） */
  domain?: string
}

/** 从 LLM 回复中提取 JSON 数组并解析（容忍代码块与前后杂质） */
export function extractGraphJson(raw: string): GenConcept[] | null {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return null
  try {
    const arr = JSON.parse(m[0])
    return Array.isArray(arr) ? (arr as GenConcept[]) : null
  } catch {
    return null
  }
}

/** 环检测（DAG 校验）：沿 dependencies 深搜，发现回边即时报环 */
export function hasCycle(concepts: GenConcept[]): boolean {
  const ids = new Set(concepts.map((c) => c.id))
  const state = new Map<string, 0 | 1 | 2>() // 0=未访问 1=访问中 2=已完成
  const visit = (id: string): boolean => {
    const s = state.get(id) ?? 0
    if (s === 1) return true // 回边 → 环
    if (s === 2) return false
    state.set(id, 1)
    const node = concepts.find((c) => c.id === id)
    if (node) {
      for (const dep of node.dependencies) {
        // 只沿图内概念走；外部依赖（图谱外）不构成环
        if (ids.has(dep) && visit(dep)) return true
      }
    }
    state.set(id, 2)
    return false
  }
  for (const c of concepts) if (visit(c.id)) return true
  return false
}

export interface GraphGenReport {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** 校验图谱：格式、重复、悬空依赖、孤立节点、环；通过才算合格 */
export function validateGraph(concepts: GenConcept[]): GraphGenReport {
  const errors: string[] = []
  const warnings: string[] = []
  if (!Array.isArray(concepts) || concepts.length < 3) {
    return { ok: false, errors: ['概念数量不足（至少 3 个）'], warnings }
  }
  const ids = new Set<string>()
  for (const c of concepts) {
    // id 允许任意语言字母/数字/连字符（中文 id 也可作内部索引，宽松兼容模型输出）
    if (!c || typeof c.id !== 'string' || !/^[\p{L}\p{N}-]+$/u.test(c.id)) {
      errors.push(`概念缺 id 或 id 含非法字符：${c?.label ?? c?.id ?? '(无)'}`)
      continue
    }
    if (ids.has(c.id)) {
      errors.push(`重复 id：${c.id}`)
      continue
    }
    ids.add(c.id)
    if (!c.label || typeof c.label !== 'string') errors.push(`概念 ${c.id} 缺 label`)
    if (!c.description || typeof c.description !== 'string') errors.push(`概念 ${c.id} 缺 description`)
    if (!Array.isArray(c.dependencies)) {
      errors.push(`概念 ${c.id} 的 dependencies 不是数组`)
      continue
    }
    if (![1, 2, 3].includes(c.difficulty)) warnings.push(`概念 ${c.id} 的难度不在 1-3，已忽略`)
    for (const d of c.dependencies) {
      if (typeof d !== 'string') errors.push(`概念 ${c.id} 的依赖项不是字符串`)
    }
  }
  if (errors.length) return { ok: false, errors, warnings }
  // 悬空依赖：仅对图内概念提示（允许引用知识库外概念）
  for (const c of concepts) {
    for (const d of c.dependencies) {
      if (!ids.has(d) && !['complexity', 'array', 'linked-list'].includes(d)) {
        warnings.push(`概念 ${c.id} 依赖了图谱外的概念 ${d}（如确需可保留）`)
      }
    }
  }
  if (hasCycle(concepts)) errors.push('依赖关系存在环（非 DAG）')
  // 孤立节点：无依赖也无入边（自称完全独立，模型易出错）
  const dependents = new Set<string>()
  for (const c of concepts) for (const d of c.dependencies) dependents.add(d)
  for (const c of concepts) {
    if (c.dependencies.length === 0 && !dependents.has(c.id)) {
      warnings.push(`概念 ${c.id} 无依赖也无被依赖，确认是否为孤立节点`)
    }
  }
  return { ok: errors.length === 0, errors, warnings }
}

/** 输出为 dsAlgoGraph.ts 同构的 TS 数组字面量文本 */
export function conceptsToTsSource(concepts: GenConcept[], varName: string): string {
  const lines = concepts.map(
    (c) =>
      `  { id: '${c.id}', label: '${c.label.replace(/'/g, "\\'")}', description: '${c.description.replace(/'/g, "\\'")}', domain: '${c.domain ?? '通用'}', dependencies: [${c.dependencies
        .map((d) => `'${d}'`)
        .join(', ')}], difficulty: ${c.difficulty} },`
  )
  return `import type { ConceptNode } from '../types'\n\nexport const ${varName}: ConceptNode[] = [\n${lines.join('\n')}\n]\n`
}

/**
 * 模型偶发把 id 生成为中文/空值：统一修复为 concept-N（N 自增），
 * 并同步修正全图对改名概念的依赖引用。纯函数，改造后可继续校验。
 */
export function repairIds(concepts: GenConcept[]): GenConcept[] {
  const fixed = new Map<string, string>() // 旧 id（或原始占位）→ 新 id
  let counter = 1
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[\p{L}\p{N}-]+$/u.test(id)
  const freshId = (): string => `concept-${counter++}`
  const used = new Set<string>()
  const out = concepts.map((c): GenConcept => {
    if (!c) return { id: freshId(), label: '(未命名)', description: '', dependencies: [], difficulty: 1 }
    if (validId(c.id) && !used.has(c.id)) {
      used.add(c.id)
      return { ...c, dependencies: Array.isArray(c.dependencies) ? c.dependencies : [] }
    }
    // 非法/重复：换新 id，并记录旧 id → 新 id 供依赖引用重指
    const fresh = freshId()
    used.add(fresh)
    if (typeof c.id === 'string' && c.id) fixed.set(c.id, fresh)
    return {
      ...c,
      id: fresh,
      dependencies: Array.isArray(c.dependencies) ? c.dependencies : [],
      difficulty: (c.difficulty as number) >= 1 && (c.difficulty as number) <= 3 ? (c.difficulty as 1 | 2 | 3) : 1,
    }
  })
  for (const c of out) {
    c.dependencies = c.dependencies.map((d) => fixed.get(d) ?? d)
  }
  return out
}

/** 文件名/变量名 slug：原样保留中文，仅清洗空白与符号 */
export function slugify(discipline: string): string {
  return discipline.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/[\s]+/g, '-')
}