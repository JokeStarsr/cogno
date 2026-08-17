import { useCallback, useEffect, useMemo, useState } from 'react'
import { generateQuiz, localFallbackQuiz, saveQuizRecord, type QuizPhase, type QuizQuestion } from '../../lib/quiz'
import { friendlyFailure, LLMError } from '../../lib/llm'
import { notifyQuizSaved } from '../Dashboard/LearningOutcomes'
import type { LLMConfig } from '../../types'
import './QuizOverlay.css'

interface Props {
  open: boolean
  /** 可测评的概念候选（阅读时已扫到的概念，优先掌握度 < 2） */
  candidates: { id: string; label: string }[]
  cfg: LLMConfig
  /** 轻量模型（省成本）；不传则用主模型 */
  fastModel?: string
  onClose: () => void
}

type Stage = 'pick' | 'loading' | 'answering' | 'result'

const PHASE_LABEL: Record<QuizPhase, string> = { pretest: '前测', posttest: '后测' }

export function QuizOverlay({ open, candidates, cfg, fastModel, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('pick')
  const [phase, setPhase] = useState<QuizPhase>('pretest')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [qIdx, setQIdx] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [pretestScore, setPretestScore] = useState(0)
  const [error, setError] = useState('')
  const [usingLocal, setUsingLocal] = useState(false)
  const [conceptId, setConceptId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStage(candidates.length ? 'pick' : 'pick')
    setError('')
  }, [open, candidates.length])

  const loadQuiz = useCallback(
    async (cid: string, ph: QuizPhase) => {
      setStage('loading')
      setUsingLocal(false)
      setError('')
      try {
        const qs = await generateQuiz(cid, cfg, ph, fastModel ? { fastModel } : {})
        setQuestions(qs)
      } catch (e) {
        // LLM 不可用/解析失败 → 本地模板兜底，测评流程不断
        setQuestions(localFallbackQuiz(cid))
        setUsingLocal(true)
        setError(e instanceof LLMError ? friendlyFailure(e.kind, e.message) : '')
      }
      setPhase(ph)
      setQIdx(0)
      setPicked(null)
      setScore(0)
      setStage('answering')
    },
    [cfg, fastModel]
  )

  const startPretest = (cid: string) => {
    setConceptId(cid)
    void loadQuiz(cid, 'pretest')
  }

  const choose = (i: number) => {
    if (picked !== null) return
    setPicked(i)
    if (i === questions[qIdx]?.correctIndex) setScore((s) => s + 1)
  }

  const next = () => {
    if (qIdx + 1 < questions.length) {
      setQIdx((i) => i + 1)
      setPicked(null)
      return
    }
    if (phase === 'pretest') {
      setPretestScore(score)
      void loadQuiz(conceptId!, 'posttest')
    } else {
      // 后测完成：落盘记录并展示对比；广播给学习概览的测评趋势组件刷新
      saveQuizRecord({ conceptId: conceptId!, pretest: pretestScore, posttest: score, createdAt: Date.now() })
      notifyQuizSaved()
      setStage('result')
    }
  }

  const resultDiff = useMemo(
    () => score - pretestScore,
    [score, pretestScore]
  )
  const resultText =
    resultDiff > 0
      ? `提升 ${resultDiff} 题，阅读有效果！`
      : resultDiff === 0
        ? '前后持平——概念的难点可能还没消化，建议围绕它追问苏格拉底代理。'
        : '后测反而低了——可能是前测有运气成分，针对这个概念多停留、多提问。'

  if (!open) return null

  return (
    <div className="quiz-overlay" onClick={onClose}>
      <div className="quiz-panel" onClick={(e) => e.stopPropagation()}>
        <div className="quiz-head">
          <h2>概念测评</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {stage === 'pick' && (
          <div className="quiz-pick">
            <p className="quiz-note">从当前阅读中扫到的概念里挑一个，测一测掌握深度（阅读前测 → 阅读后测对比）。</p>
            {candidates.length === 0 && (
              <p className="quiz-note muted">还没扫到概念——先读一小段，或直接点下方按钮用全部概念。</p>
            )}
            <div className="quiz-pick-grid">
              {candidates.slice(0, 12).map((c) => (
                <button key={c.id} className="quiz-pick-btn" onClick={() => startPretest(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {stage === 'loading' && <div className="quiz-load">正在生成 {PHASE_LABEL[phase]}题…</div>}

        {stage === 'answering' && questions.length > 0 && (
          <div className="quiz-answer">
            <div className="quiz-progress">
              {PHASE_LABEL[phase]} · 第 {qIdx + 1}/{questions.length} 题
              {usingLocal && <span className="quiz-local">（离线题库）</span>}
            </div>
            <p className="quiz-question">{questions[qIdx].question}</p>
            <div className="quiz-options">
              {questions[qIdx].options.map((o, i) => (
                <button
                  key={i}
                  className={`quiz-option ${picked !== null ? (i === questions[qIdx].correctIndex ? 'correct' : picked === i ? 'wrong' : '') : ''}`}
                  onClick={() => choose(i)}
                  disabled={picked !== null}
                >
                  <span className="quiz-opt-label">{String.fromCharCode(65 + i)}.</span>
                  {o}
                </button>
              ))}
            </div>
            {picked !== null && (
              <div className="quiz-explain">
                <p>{questions[qIdx].explanation}</p>
                <button className="btn-primary" onClick={next}>
                  {qIdx + 1 < questions.length ? '下一题' : phase === 'pretest' ? '开始后测' : '完成'}
                </button>
              </div>
            )}
          </div>
        )}

        {stage === 'result' && (
          <div className="quiz-result">
            <div className="quiz-scores">
              <div className={`quiz-score ${pretestScore >= 2 ? 'good' : ''}`}>
                <span className="quiz-score-num">{pretestScore}/3</span>
                <span className="quiz-score-label">阅读前</span>
              </div>
              <span className="quiz-arrow">→</span>
              <div className={`quiz-score ${score >= 2 ? 'good' : ''}`}>
                <span className="quiz-score-num">{score}/3</span>
                <span className="quiz-score-label">阅读后</span>
              </div>
            </div>
            <p className="quiz-result-text">{resultText}</p>
            {error && <p className="quiz-error">{error}</p>}
            <button className="btn-primary" onClick={onClose}>
              完成
            </button>
          </div>
        )}
      </div>
    </div>
  )
}