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
import type { AgentId, CognitiveState, Mastery } from '../../types'
import './ReaderPage.css'

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
  const [agentLoading, setAgentLoading] = useState(false)
  const [mastery, setMastery] = useState<Map<string, Mastery>>(new Map())
  const [lastReason, setLastReason] = useState<string | undefined>()

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
    setAgentLoading(true)
    try {
      const text = await chatCompletion(
        cfg,
        AGENTS[agentId].systemPrompt,
        [{ role: 'user', content: userText }],
        { maxTokens: 500 }
      )
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
                  <TextViewer
                    ref={textHandle}
                    text={source.text ?? ''}
                    onScroll={(d) => engineRef.current.pushScroll(d)}
                    onConceptSeen={handleConceptSeen}
                  />
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
