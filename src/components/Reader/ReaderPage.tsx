import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { CognitiveEngine } from '../../lib/cognitive'
import { AgentTrigger, AGENTS } from '../../lib/agents'
import { createTrackingController, subscribe, type TrackingController } from '../../lib/eyeTracking'
import { isLLMConfigured, chatCompletion } from '../../lib/llm'
import { db, appendCognitiveLog } from '../../lib/storage'
import { getReviewItem } from '../../lib/spacedRepetition'
import { getConcept } from '../../lib/knowledge'
import { CognitiveStateRing } from '../StateRing/CognitiveStateRing'
import { TextViewer, type TextHandle } from './TextViewer'
import { PdfViewer } from './PdfViewer'
import { ImportPanel, type ReaderSource } from './ImportPanel'
import { CalibrationOverlay } from './CalibrationOverlay'
import { AgentPanel, type AgentTurn } from '../AgentPanel/AgentPanel'
import { KnowledgeDrawer } from '../KnowledgeGrid/KnowledgeDrawer'
import { ReviewOverlay } from './ReviewOverlay'
import type { AgentId, ChatMessage, CognitiveState, Mastery } from '../../types'
import './ReaderPage.css'

/** 简单问答缓存：同代理 + 同问题命中直接返回，减少 API 调用 */
const agentCache = new Map<string, string>()
const CACHE_MAX = 200
/** 澄清者/连接者使用轻量模型(更便宜)，挑战者/拓展者用主模型 */
const FAST_AGENTS: AgentId[] = ['clarifier', 'connector']

const DEFAULT_STATE: CognitiveState = {
  understanding: 45,
  attention: 55,
  fatigue: 12,
  divergence: 30,
  flow: false,
}

export function ReaderPage() {
  const { settings } = useApp()
  const [source, setSource] = useState<ReaderSource | null>(null)
  const [showImport, setShowImport] = useState(true)
  const [calibrating, setCalibrating] = useState(false)
  const [trackingLabel, setTrackingLabel] = useState('眼动未启用')
  const [state, setState] = useState<CognitiveState>(DEFAULT_STATE)
  const [kdrawerOpen, setKdrawerOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [activeAgent, setActiveAgent] = useState<AgentId>('clarifier')
  const [turns, setTurns] = useState<AgentTurn[]>([])
  const turnsRef = useRef<AgentTurn[]>([])
  useEffect(() => {
    turnsRef.current = turns
  }, [turns])
  const [agentLoading, setAgentLoading] = useState(false)
  const [mastery, setMastery] = useState<Map<string, Mastery>>(new Map())
  const [lastReason, setLastReason] = useState<string | undefined>()
  const [nudge, setNudge] = useState<string | null>(null)
  const nudgeRef = useRef<string | null>(null)
  const lastNudgeAt = useRef(0)

  const engineRef = useRef(new CognitiveEngine())
  const triggerRef = useRef(new AgentTrigger())
  const controllerRef = useRef<TrackingController | null>(null)
  const textHandle = useRef<TextHandle>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const newConceptRef = useRef<string | null>(null)
  const sessionStart = useRef(Date.now())
  const sessionIdRef = useRef<number | null>(null)
  const sessionCount = useRef(0)
  const mountedRef = useRef(true)

  // ── 掌握度加载 ──
  useEffect(() => {
    let alive = true
    ;(async () => {
      const items = await db.concepts.toArray()
      if (!alive) return
      setMastery(new Map(items.map((i) => [i.conceptId, i.mastery as Mastery])))
    })()
    return () => {
      alive = false
    }
  }, [])

  // ── 认知循环 + 触发检查 ──
  useEffect(() => {
    const iv = setInterval(() => {
      const st = engineRef.current.recompute()
      stateRef.current = st
      setState(st)
      appendCognitiveLog({ ...st, ts: Date.now() }).catch(() => {})
      // 每 10 次循环做一次触发检查（约 20s 一次）
      sessionCount.current++
      if (sessionCount.current % 3 === 0) runTriggerCheck()
    }, 2000)
    const boundsIv = setInterval(() => {
      const el = textHandle.current?.el
      if (el) {
        const r = el.getBoundingClientRect()
        engineRef.current.setReadingBounds({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
      }
    }, 3000)
    return () => {
      clearInterval(iv)
      clearInterval(boundsIv)
    }
  }, [])

  // ── 会话保存 ──
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllerRef.current?.stop()
    }
  }, [])

  // ── 眼动订阅 ──
  useEffect(() => {
    const unsub = subscribe((g) => engineRef.current.pushGaze(g))
    return unsub
  }, [])

  // ── 页面行为：标签切换 / 失焦 = 走神信号 ──
  useEffect(() => {
    const onVis = () => engineRef.current.setPageVisible(!document.hidden)
    const onFocus = () => engineRef.current.setPageVisible(true)
    const onBlur = () => engineRef.current.setPageVisible(false)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const runTriggerCheck = () => {
    const cfg = settingsRef.current.llm
    const stats = engineRef.current.getStats()
    const masteredLabels = [...mastery].filter(([, m]) => m >= 2).map(([id]) => safeLabel(id))
    const interv = triggerRef.current.evaluate({
      state: stateRef.current,
      rereadCount: stats.rereadCount,
      scrollPx: stats.scrollPx,
      maxDwellMs: stats.maxDwellMs,
      newConceptId: newConceptRef.current ?? undefined,
      masteredLabels,
    })
    newConceptRef.current = null
    // 主动提问气泡：在内容上停留较久(≥60s)且非心流 → 温和提问
    if (
      !nudgeRef.current &&
      !stateRef.current.flow &&
      stats.maxDwellMs >= 60_000 &&
      Date.now() - lastNudgeAt.current > 2 * 60_000
    ) {
      lastNudgeAt.current = Date.now()
      const text = '感觉你在某段内容上停留了一会儿 —— 这段讲的是什么?能用你自己的话复述一下吗?'
      nudgeRef.current = text
      setNudge(text)
    }
    if (interv) {
      setLastReason(interv.reason)
      setActiveAgent(interv.agentId)
      setAgentOpen(true)
      const ctx = textHandle.current?.visibleText().slice(-600) ?? ''
      void autoIntervene(interv.agentId, ctx, interv.reason, cfg)
    }
  }

  const autoIntervene = async (
    agentId: AgentId,
    ctx: string,
    reason: string,
    cfg: { baseUrl: string; apiKey: string; model: string }
  ) => {
    if (!isLLMConfigured(cfg)) {
      setTurns((t) => [
        ...t,
        {
          agentId,
          role: 'agent',
          content: '我检测到你似乎遇到了困难。请先在「设置」里配置 AI 端点（sub2api 地址 + key），我才能和你对话。',
          reason,
          ts: Date.now(),
        },
      ])
      return
    }
    const prompt = `我刚刚在阅读下面这段内容，系统判断我可能需要帮助（原因：${reason}）。请以你的角色介入。\n\n阅读片段：\n${ctx}`
    await doAgentCall(agentId, prompt, reason)
  }

  const dismissNudge = () => {
    nudgeRef.current = null
    setNudge(null)
  }

  const onConfused = () => {
    const ctx = textHandle.current?.visibleText().slice(-600) ?? ''
    void autoIntervene('clarifier', ctx, '你主动标记了困惑', settingsRef.current.llm)
  }

  const onImportant = () => {
    const ctx = textHandle.current?.visibleText().slice(-600) ?? ''
    void autoIntervene('connector', ctx, '你主动标记了重要内容', settingsRef.current.llm)
  }

  const doAgentCall = async (agentId: AgentId, userText: string, reason?: string) => {
    const cfg = settingsRef.current.llm
    setTurns((t) => [...t, { agentId, role: 'user', content: userText, ts: Date.now() }])
    if (!isLLMConfigured(cfg)) {
      setTurns((t) => [
        ...t,
        {
          agentId,
          role: 'agent',
          content: '请先在「设置」里配置 AI 端点与 key，我才能回复你。',
          ts: Date.now(),
        },
      ])
      return
    }
    // 常见问答缓存：同代理 + 同问题直接复用，避免重复计费
    const cacheKey = `${agentId}:${userText.trim()}`
    const cached = agentCache.get(cacheKey)
    if (cached) {
      setTurns((t) => [...t, { agentId, role: 'agent', content: cached, reason, ts: Date.now() }])
      return
    }
    setAgentLoading(true)
    try {
      // 多轮上下文：携带该代理此前的对话历史（最近 8 条），实现苏格拉底式连续追问
      const history: ChatMessage[] = turnsRef.current
        .filter((t) => t.agentId === agentId)
        .slice(-8)
        .map((t) => ({ role: (t.role === 'user' ? 'user' : 'assistant') as ChatMessage['role'], content: t.content }))
      // 分档模型：澄清者/连接者走轻量模型省成本
      const model = FAST_AGENTS.includes(agentId) ? settingsRef.current.fastModel : cfg.model
      const text = await chatCompletion(
        { ...cfg, model },
        AGENTS[agentId].systemPrompt,
        [...history, { role: 'user', content: userText }],
        { maxTokens: 1024 }
      )
      if (agentCache.size >= CACHE_MAX) {
        const firstKey = agentCache.keys().next().value
        if (firstKey !== undefined) agentCache.delete(firstKey)
      }
      agentCache.set(cacheKey, text)
      setTurns((t) => [...t, { agentId, role: 'agent', content: text, reason, ts: Date.now() }])
    } catch (e) {
      setTurns((t) => [
        ...t,
        { agentId, role: 'agent', content: `（出错了：${(e as Error).message}）`, ts: Date.now() },
      ])
    } finally {
      setAgentLoading(false)
    }
  }

  // ── 概念被读到：标记"学习中" ──
  const handleConceptSeen = useCallback((conceptId: string) => {
    newConceptRef.current = conceptId
    setMastery((prev) => {
      const next = new Map(prev)
      const cur = next.get(conceptId) ?? 0
      if (cur < 1) next.set(conceptId, 1)
      return next
    })
    getReviewItem(conceptId).then((item) => {
      if (item.mastery < 1) {
        db.concepts.put({ ...item, mastery: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 86400_000 })
      }
    })
  }, [])

  const startTracking = async () => {
    if (!controllerRef.current) controllerRef.current = createTrackingController()
    const ctrl = controllerRef.current
    ctrl.stop()
    if (settings.mouseProxy) ctrl.setMouseProxy(true)
    setTrackingLabel('正在请求摄像头…')
    try {
      await ctrl.startCamera()
      setTrackingLabel('眼动追踪已启用 · 点击校准')
      setCalibrating(true)
    } catch {
      if (settings.mouseProxy) {
        setTrackingLabel('相机不可用 · 已用鼠标代理')
      } else {
        setTrackingLabel('相机不可用')
      }
    }
  }

  const loadSource = (src: ReaderSource) => {
    setSource(src)
    setShowImport(false)
    sessionStart.current = Date.now()
    triggerRef.current.reset()
    void db.sessions.add({
      title: src.title,
      sourceType: src.sourceType,
      startedAt: sessionStart.current,
      durationSec: 0,
      conceptsTouched: [],
      agentInterventions: 0,
    }).then((id) => {
      sessionIdRef.current = id
    })
  }

  const saveSession = useCallback(async () => {
    if (!source || sessionIdRef.current == null) return
    const dur = Math.round((Date.now() - sessionStart.current) / 1000)
    await db.sessions.update(sessionIdRef.current, {
      durationSec: dur,
      conceptsTouched: [...mastery.keys()],
      agentInterventions: turns.filter((t) => t.role === 'agent' && t.reason).length,
    })
  }, [source, mastery, turns])

  useEffect(() => {
    if (!source) return
    const iv = setInterval(() => saveSession(), 60_000)
    const onUnload = () => {
      void saveSession()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      clearInterval(iv)
      window.removeEventListener('beforeunload', onUnload)
      void saveSession()
    }
  }, [source, saveSession])

  return (
    <div className="reader-layout">
      <CognitiveStateRing state={state} />

      <div className="reader-main">
        {source?.sourceType === 'pdf' && source.file ? (
          <PdfViewer
            file={source.file}
            onScroll={(d) => engineRef.current.pushScroll(d)}
          />
        ) : (
          <div className="reader-pane">
            <div className="reader-toolbar">
              <div className="reader-title">
                <span className="reader-title-text">{source?.title ?? '未加载'}</span>
                <span className="reader-mode">{trackingLabel}</span>
              </div>
              <div className="reader-buttons">
                {!source && (
                  <button className="btn-ghost" onClick={() => setShowImport(true)}>
                    导入内容
                  </button>
                )}
                <button className="btn-ghost" onClick={() => setShowImport(true)}>
                  换一篇
                </button>
                <button className="btn-ghost" onClick={startTracking}>
                  {trackingLabel.startsWith('眼动') ? '校准眼动' : '启用眼动'}
                </button>
                <button
                  className={`btn-ghost ${kdrawerOpen ? 'active' : ''}`}
                  onClick={() => setKdrawerOpen((v) => !v)}
                >
                  理解网格
                </button>
                <button
                  className={`btn-ghost ${agentOpen ? 'active' : ''}`}
                  onClick={() => setAgentOpen((v) => !v)}
                >
                  苏格拉底
                </button>
                <button className="btn-ghost" onClick={() => setReviewOpen(true)}>
                  回顾
                </button>
              </div>
            </div>
            <div className="reader-body">
              {source ? (
                source.sourceType === 'pdf' && source.file ? null : (
                  <>
                    <TextViewer
                      ref={textHandle}
                      text={source.text ?? ''}
                      onScroll={(d) => engineRef.current.pushScroll(d)}
                      onConceptSeen={handleConceptSeen}
                    />
                    <div className="reader-feedback">
                      <button className="feedback-btn confused" onClick={onConfused}>
                        我困惑了
                      </button>
                      <button className="feedback-btn important" onClick={onImportant}>
                        这里很重要
                      </button>
                    </div>
                    {nudge && (
                      <div className="reader-nudge">
                        <p>{nudge}</p>
                        <div className="nudge-actions">
                          <button
                            className="btn-primary"
                            onClick={() => {
                              const ctx = textHandle.current?.visibleText().slice(-600) ?? ''
                              dismissNudge()
                              void autoIntervene('clarifier', ctx, '系统主动提问：在内容上停留较久', settingsRef.current.llm)
                            }}
                          >
                            聊聊
                          </button>
                          <button className="btn-ghost" onClick={dismissNudge}>
                            忽略
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )
              ) : (
                <div className="reader-empty" onClick={() => setShowImport(true)}>
                  <div className="reader-empty-orb" />
                  <p>选择一篇文章开始阅读 —— 摄像头会感知你的认知状态</p>
                  <button className="btn-primary">开始</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {agentOpen && (
        <AgentPanel
          activeAgent={activeAgent}
          onSelectAgent={setActiveAgent}
          turns={turns}
          loading={agentLoading}
          onSend={(agentId, text) => void doAgentCall(agentId, text)}
          onClose={() => setAgentOpen(false)}
          lastReason={lastReason}
        />
      )}

      <KnowledgeDrawer
        open={kdrawerOpen}
        mastery={mastery}
        onClose={() => setKdrawerOpen(false)}
        onGoReview={() => {
          setKdrawerOpen(false)
          setReviewOpen(true)
        }}
      />

      {reviewOpen && (
        <ReviewOverlay
          onClose={() => setReviewOpen(false)}
          onReviewed={() => {
            void (async () => {
              const items = await db.concepts.toArray()
              setMastery(new Map(items.map((i) => [i.conceptId, i.mastery as Mastery])))
            })()
          }}
        />
      )}

      {showImport && <ImportPanel onLoad={loadSource} onClose={() => setShowImport(false)} />}

      {calibrating && (
        <CalibrationOverlay
          onDone={() => setCalibrating(false)}
          onCancel={() => setCalibrating(false)}
        />
      )}
    </div>
  )
}

function safeLabel(id: string): string {
  try {
    return getConcept(id).label
  } catch {
    return id
  }
}
