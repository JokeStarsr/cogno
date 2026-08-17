import { describe, it, expect, beforeEach } from 'vitest'
import { parseQuizResponse, localFallbackQuiz, saveQuizRecord, loadQuizRecords } from '../quiz'

const VALID_JSON = JSON.stringify([
  { question: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: 'E1' },
  { question: 'Q2', options: ['A', 'B'], correctIndex: 0, explanation: 'E2' },
  { question: 'Q3', options: ['A', 'B', 'C'], correctIndex: 2, explanation: 'E3' },
])

beforeEach(() => {
  localStorage.clear()
})

describe('parseQuizResponse', () => {
  it('解析纯 JSON 数组', () => {
    const qs = parseQuizResponse(VALID_JSON)
    expect(qs).toHaveLength(3)
    expect(qs[0].correctIndex).toBe(1)
    expect(qs[2].correctIndex).toBe(2)
  })

  it('容忍 markdown 代码块与前后杂质文案', () => {
    const raws = [
      '好的，这是题目：\n```json\n' + VALID_JSON + '\n```\n希望有帮助',
      '回答如下：' + VALID_JSON + '（完）',
      '\n\n' + VALID_JSON + '\n',
    ]
    for (const r of raws) expect(parseQuizResponse(r)).toHaveLength(3)
  })

  it('兼容 trueIndex / answer 字段名', () => {
    const qs = parseQuizResponse(
      JSON.stringify([
        { question: 'Q', options: ['A', 'B'], trueIndex: 1, explanation: 'E' },
        { question: 'Q', options: ['A', 'B', 'C'], answer: '2', explanation: 'E' },
      ])
    )
    expect(qs[0].correctIndex).toBe(1)
    expect(qs[1].correctIndex).toBe(2)
  })

  it('correctIndex 越界时收敛到选项范围内', () => {
    const qs = parseQuizResponse(
      JSON.stringify([{ question: 'Q', options: ['A', 'B'], correctIndex: 9, explanation: 'E' }])
    )
    expect(qs[0].correctIndex).toBe(1)
  })

  it('非法输入返回空数组（不抛异常）', () => {
    expect(parseQuizResponse('')).toEqual([])
    expect(parseQuizResponse('不在方括号里')).toEqual([])
    expect(parseQuizResponse('[not json!]')).toEqual([])
    expect(parseQuizResponse(JSON.stringify({ not: 'array' }))).toEqual([])
    expect(parseQuizResponse(JSON.stringify([{ no: 'options field' }]))).toEqual([])
  })
})

describe('localFallbackQuiz', () => {
  it('真实概念返回 3 题、每题 4 选项、下标有效', () => {
    const qs = localFallbackQuiz('complexity')
    expect(qs).toHaveLength(3)
    for (const q of qs) {
      expect(q.options).toHaveLength(4)
      expect(q.correctIndex).toBeGreaterThanOrEqual(0)
      expect(q.correctIndex).toBeLessThan(q.options.length)
      expect(q.question.length).toBeGreaterThan(5)
    }
  })

  it('未知概念不抛异常，回退用 id 本身', () => {
    expect(() => localFallbackQuiz('definitely-not-a-concept-id')).not.toThrow()
    const qs = localFallbackQuiz('definitely-not-a-concept-id')
    expect(qs[0].question).toContain('definitely-not-a-concept-id')
  })
})

describe('saveQuizRecord / loadQuizRecords', () => {
  it('保存后能读回', () => {
    saveQuizRecord({ conceptId: 'complexity', pretest: 1, posttest: 3, createdAt: 1000 })
    const all = loadQuizRecords()
    expect(all).toHaveLength(1)
    expect(all[0].posttest).toBe(3)
  })

  it('同一概念新纪录覆盖旧纪录', () => {
    saveQuizRecord({ conceptId: 'complexity', pretest: 1, posttest: 2, createdAt: 1000 })
    saveQuizRecord({ conceptId: 'complexity', pretest: 2, posttest: 3, createdAt: 2000 })
    const all = loadQuizRecords()
    expect(all).toHaveLength(1)
    expect(all[0].pretest).toBe(2)
  })

  it('超出上限丢弃最旧纪录', () => {
    for (let i = 0; i < 60; i++) {
      saveQuizRecord({ conceptId: `c${i}`, pretest: 1, posttest: 1, createdAt: i })
    }
    const all = loadQuizRecords()
    expect(all).toHaveLength(50)
    // 新纪录在前：c59 最先，c10 是保留的最旧一条（c0..c9 被挤出）
    expect(all[0].conceptId).toBe('c59')
    expect(all[all.length - 1].conceptId).toBe('c10')
  })
})