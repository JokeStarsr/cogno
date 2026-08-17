/**
 * 知识图谱自动生成脚本（Phase 4.1）。
 * 用法（Node ≥22，--experimental-strip-types）：
 *   SUB2API_KEY=sk-xxx node scripts/generate-graph.ts --discipline "机器学习" \
 *     --chapters "监督学习,无监督学习,深度学习"
 * 选项：
 *   --model    默认 qwen3.7-max（阿里 token-plan 非思维链稳定模型，见项目记忆）
 *   --base-url 默认 http://localhost:8180/v1/chat/completions（sub2api OpenAI 格式）
 *   --out      输出文件（默认 src/data/{slug}.ts）
 * 校验失败（非 DAG/缺字段/重复）不落盘，退出码非 0。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { extractGraphJson, validateGraph, conceptsToTsSource, repairIds } from '../src/lib/graphGen.ts'
import type { GenConcept } from '../src/lib/graphGen.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const discipline = arg('discipline')
if (!discipline) {
  console.error('缺 --discipline（例如 --discipline "机器学习"）')
  process.exit(2)
}
const chaptersArg = arg('chapters')
const chapters = (chaptersArg ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const model = arg('model') ?? 'qwen3.7-max'
const baseUrl = (arg('base-url') ?? 'http://localhost:8180/v1/chat/completions').replace(/\/+$/, '')
const apiKey = process.env.SUB2API_KEY ?? arg('key') ?? ''
if (!apiKey) {
  console.error('需要 API key：环境变量 SUB2API_KEY 或 --key')
  process.exit(2)
}

const slug = discipline
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s-]/gu, '')
  .trim()
  .replace(/[\s]+/g, '-')
const varName = slug.replace(/-/g, '_').toUpperCase() + '_GRAPH'
const outPath = arg('out') ?? resolve('src/data', `${slug}.ts`)

const prompt =
  `你是课程设计专家。请为「${discipline}」学科设计知识图谱。` +
  (chapters.length ? `章节包括：${chapters.join('、')}。\n` : '\n') +
  `要求：
  1. 提取 20-40 个核心概念，每个概念字段：id（英文 snake_case 小写，如 "supervised-learning"）、label（中文，如 "监督学习"）、description（一句话，30 字内）、dependencies（前置概念 id 列表）、difficulty（1=入门 2=进阶 3=高级）
  2. 依赖关系必须形成有向无环图（DAG），基础概念 dependencies 为空
  3. 输出纯 JSON 数组，不要 markdown 包裹，不要任何解释文字`

console.log(`[1/3] 调用 ${model} 生成「${discipline}」图谱…`)
const res = await fetch(baseUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model,
    messages: [
      { role: 'system', content: '你是知识工程助手，只输出符合要求的 JSON。' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 4096,
    temperature: 0.3,
  }),
})
if (!res.ok) {
  const detail = (await res.text()).slice(0, 400)
  console.error(`[错误] HTTP ${res.status}: ${detail}`)
  process.exit(1)
}
let text = ''
const body = await res.json() as { choices?: { message?: { content?: string } }[] }
text = body.choices?.[0]?.message?.content ?? ''
const concepts = extractGraphJson(text) as GenConcept[] | null
if (!concepts) {
  console.error('[错误] 未能从 LLM 回复解析出 JSON 数组，原文前 500 字：')
  console.error(text.slice(0, 500))
  process.exit(1)
}
// 模型偶发把 id 生成成中文/重复：先修复再校验，修复数 ≤ 3 可继续
const repaired = repairIds(concepts)
const renamed = repaired.filter((c, i) => concepts[i]?.id !== c.id).length
if (renamed) console.warn(`[修复] ${renamed} 个概念的 id 已被规范化为 concept-N 形式`)
const report = validateGraph(repaired)
for (const w of report.warnings) console.warn('[警告]', w)
if (!report.ok) {
  console.error('[校验失败，不落盘]')
  for (const e of report.errors) console.error('  -', e)
  process.exit(1)
}
console.log(`[2/3] 校验通过：${concepts.length} 个概念，DAG 无环`)

mkdirSync(dirname(outPath), { recursive: true })
const source = `// 由 scripts/generate-graph.ts 自动生成（${new Date().toISOString()}）\n` +
  `// 学科：${discipline}${chapters.length ? `，章节：${chapters.join('、')}` : ''}\n` +
  conceptsToTsSource(concepts, varName)
writeFileSync(outPath, source, 'utf8')
console.log(`[3/3] 已写入 ${outPath}（导出 ${varName}）`)
console.log(`      检查用：npx tsc -b 或 npx vitest run src/lib/__tests__/graphGen.test.ts`)
console.log(`      接入应用：在 graphRegistry 中注册后用 KnowledgeGrid 按需加载（见 docs/cloud-integration.md 同款流程）`)