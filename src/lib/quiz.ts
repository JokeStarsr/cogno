/**
 * 概念测评（Phase 2.1）：阅读前/后测各 3 道选择题。
 * LLM 生成优先，解析失败/未配置端点时回退本地模板（可离线，不打断阅读）。
 */
import type { ChatMessage, LLMConfig } from '../types'
import { chatCompletion, LLMError } from './llm'
import { getConcept } from './knowledge'

export interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

/** 一次测评记录：前测得分 → 后测得分（0-3 题正确数） */
export interface QuizRecord {
  conceptId: string
  pretest: number
  posttest: number
  createdAt: number
}

const QUIZ_STORAGE_KEY = 'cogno.quizzes'
const QUIZ_MAX_RECORDS = 50

/** 视角切换：前测/后测题目必须不同，用 seed 让 LLM 出两套题 */
export type QuizPhase = 'pretest' | 'posttest'

/** 从概念定义取一句话描述（无定义时的回退文案） */
function conceptDescription(conceptId: string): string {
  try {
    const c = getConcept(conceptId)
    if (!c?.description) return c?.label ?? conceptId
    return c.description
  } catch {
    return conceptId
  }
}

/**
 * 生成一套（3 题）概念选择题。
 * LLM 输出解析失败或网络异常时抛错，由调用方回退本地模板。
 */
export async function generateQuiz(
  conceptId: string,
  cfg: LLMConfig,
  phase: QuizPhase,
  opts: { fastModel?: string } = {}
): Promise<QuizQuestion[]> {
  const label = getConcept(conceptId)?.label ?? conceptId
  const desc = conceptDescription(conceptId)
  const phaseZh = phase === 'pretest' ? '前测（阅读前）' : '后测（阅读后）'
  const system =
    '你是课程测评出题专家。只输出 JSON，不输出任何其他文字。JSON 数组格式：' +
    '[{"question":"题干","options":["选项A","选项B","选项C","选项D"],"correctIndex":0,' +
    '"explanation":"为什么正确答案是对的，一句话"}]'

  const prompt =
    `请围绕概念「${label}」生成 3 道 4 选项单选题，用于${phaseZh}。\n` +
    `概念描述：${desc}\n` +
    `要求：\n` +
    `1. 考察理解深度而非记忆（给情境/变体，不给定义复述）\n` +
    `2. 选项至少两个看起来合理，trueIndex 用 0-3 数字表示正确选项下标\n` +
    `3. 题目不要与之前的版本重复（${phase} 用全新的情境）\n`

  const text = await chatCompletion(
    { ...cfg, model: opts.fastModel ?? cfg.model },
    system,
    [{ role: 'user', content: prompt }] satisfies ChatMessage[],
    { maxTokens: 1200 }
  )
  const parsed = parseQuizResponse(text)
  if (parsed.length < 3) throw new LLMError('unknown', '测评题生成数量不足，使用内置题库')
  return parsed.slice(0, 3)
}

/** 解析 LLM 返回的 JSON 数组（容忍代码块包裹与前后杂质）。纯函数便于单测 */
export function parseQuizResponse(raw: string): QuizQuestion[] {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr: unknown = JSON.parse(m[0])
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (q): q is Record<string, unknown> =>
          !!q &&
          typeof q === 'object' &&
          typeof (q as { question?: unknown }).question === 'string' &&
          Array.isArray((q as { options?: unknown }).options) &&
          (q as { options: unknown[] }).options.length >= 2 &&
          typeof (q as { explanation?: unknown }).explanation === 'string'
      )
      .map((q) => {
        // correctIndex: 接受 trueIndex/correctIndex/answer 几种字段名，数字归一
        const rawIdx =
          q.correctIndex ?? q.trueIndex ?? q.answer ?? (Array.isArray(q['answerIndex']) ? undefined : q['answerIndex'])
        const idx = Number(typeof rawIdx === 'string' ? parseInt(rawIdx, 10) : rawIdx)
        const options = (q as { options: unknown[] }).options.map((o) => String(o).trim())
        return {
          question: String(q.question).trim(),
          options,
          correctIndex: Number.isFinite(idx) ? Math.max(0, Math.min(options.length - 1, idx)) : 0,
          explanation: String(q.explanation).trim(),
        }
      })
  } catch {
    return []
  }
}

/** 本地模板兜底：无 LLM 也能测评（考察概念定义与典型反例） */
export function localFallbackQuiz(conceptId: string): QuizQuestion[] {
  let label = conceptId
  try {
    label = getConcept(conceptId)?.label ?? conceptId
  } catch {
    /* 未知概念：用 id 本身 */
  }
  const desc = conceptDescription(conceptId)
  const short = desc.length > 60 ? `${desc.slice(0, 60)}…` : desc
  return [
    {
      question: `下列关于「${label}」的描述，最准确的一项是？`,
      options: [short, `与「${label}」名称相近但不相关的内容`, '凭感觉猜测的描述', '错误的定义'],
      correctIndex: 0,
      explanation: '这与你正在学习的概念定义一致。',
    },
    {
      question: `下面哪种情况最能检验你是否真正理解了「${label}」？`,
      options: [
        '能用自己的话解释并举例',
        '记住定义原文',
        '认识这个概念的名字',
        '完成相关章节的阅读',
      ],
      correctIndex: 0,
      explanation: '费曼式检验：能解释+举例 = 理解；只会背 = 知道名字。',
    },
    {
      question: `如果让你向同学讲解「${label}」，你会优先讲什么？`,
      options: [
        '核心思想与其解决的实际问题',
        '背诵术语表',
        '罗列所有相关名词',
        '跳过，直接不讲解',
      ],
      correctIndex: 0,
      explanation: '讲核心思想和实际用途，是深度理解的起点。',
    },
  ]
}

export function loadQuizRecords(): QuizRecord[] {
  try {
    const raw = localStorage.getItem(QUIZ_STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as QuizRecord[]) : []
  } catch {
    return []
  }
}

export function saveQuizRecord(rec: QuizRecord): QuizRecord[] {
  const all = [rec, ...loadQuizRecords().filter((r) => r.conceptId !== rec.conceptId)].slice(0, QUIZ_MAX_RECORDS)
  try {
    localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* 存储满/隐私模式：静默丢弃，不影响阅读 */
  }
  return all
}

/** 最近一次该概念的测评（用于后测对比） */
export function lastQuizOf(conceptId: string, records: QuizRecord[]): QuizRecord | undefined {
  return records.find((r) => r.conceptId === conceptId && r.posttest >= 0)
}