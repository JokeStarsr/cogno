import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { CognitiveEngine } from '../../lib/cognitive'
import { BehavioralSignalTracker } from '../../lib/behavioralSignals'
import { AgentTrigger, AGENTS } from '../../lib/agents'
import { createTrackingController, subscribe, type TrackingController } from '../../lib/eyeTracking'
import { isLLMConfigured, chatCompletion, trimHistory, trimContext, friendlyFailure, LLMError } from '../../lib/llm'
import { localAgentReply, resetLocalBudget } from '../../lib/localAgent'
import { db, appendCognitiveLog, saveDoc, getDoc } from '../../lib/storage'
import { getReviewItem } from '../../lib/spacedRepetition'
import { getConcept } from '../../lib/knowledge'
import { scanConceptsInText } from '../../lib/concepts'
import {
  ReadingEventTracker,
  loadBaselineRate,
  recordBaseline,
} from '../../lib/readingSignals'
import { getDeviceId, isTreatmentGroup } from '../../lib/experiment'
import { CognitiveStateRing } from '../StateRing/CognitiveStateRing'
import { TextViewer, type TextHandle } from './TextViewer'
import { PdfViewer, type PdfHandle } from './PdfViewer'
import { ImportPanel, type ReaderSource } from './ImportPanel'
import { CalibrationOverlay } from './CalibrationOverlay'
import { AgentPanel, type AgentTurn } from '../AgentPanel/AgentPanel'
import { KnowledgeDrawer } from '../KnowledgeGrid/KnowledgeDrawer'
import { ReviewOverlay } from './ReviewOverlay'
import type { AgentId, ChatMessage, CognitiveState, Mastery, ReadingDoc } from '../../types'
import './ReaderPage.css'

/** 简单问答缓存：同代理 + 同问题命中直接返回，减少 API 调用 */
const agentCache = new Map<string, string>()
const CACHE_MAX = 200
/** A/B 实验组（Phase 2.2）：对照组禁用自动介入，仅保留手动对话与主动按钮 */
const isExperimentTreatment = isTreatmentGroup(getDeviceId())
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
  const { settings, resumeDocId, clearResume, view } = useApp()
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
  const signalRef = useRef(new ReadingEventTracker())
  /** 行为信号（选中/复制/失焦/鼠标停留）：无摄像头场景的认知推断来源 */
  const behavioralRef = useRef(new BehavioralSignalTracker())
  /** 个人翻页速率基线（页/分）；null = 样本不足 */
  const baselineRef = useRef<number | null>(null)
  const controllerRef = useRef<TrackingController | null>(null)
  const textHandle = useRef<TextHandle>(null)
  const pdfHandle = useRef<PdfHandle>(null)
  const pdfTextsRef = useRef<string[]>([])
  const pdfSeenRef = useRef<Set<string>>(new Set())
  const stateRef = useRef(state)
  stateRef.current = state
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const viewRef = useRef(view)
  viewRef.current = view
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
  // 阅读器保持挂载（页面切换不卸载），不在阅读视图时暂停日志写入与触发检查
  useEffect(() => {
    const iv = setInterval(() => {
      const active = viewRef.current === 'reader'
      // 行为信号：无论是否阅读视图都先清空累计（防堆积），阅读时推给引擎融合
      const bs = behavioralRef.current.getSnapshot()
      engineRef.current.pushBehavioralSignals(active ? bs : null)
      if (!active) return
      const st = engineRef.current.recompute()
      stateRef.current = st
      setState(st)
      appendCognitiveLog({ ...st, ts: Date.now() }).catch(() => {})
      // 页信号层推进：可见时才累计停留
      signalRef.current.tick()
      // 每 3 次循环做一次触发检查（约 6s 一次）
      sessionCount.current++
      if (sessionCount.current % 3 === 0) runTriggerCheck()
    }, 2000)
    const boundsIv = setInterval(() => {
      if (viewRef.current !== 'reader') return
      const el = textHandle.current?.el
      if (el) {
        const r = el.getBoundingClientRect()
        engineRef.current.setReadingBounds({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
        // 行为信号鼠标占比以同一阅读区为界
        behavioralRef.current.attachReadingArea(el)
        // 文本模式虚拟页检测（PDF 模式走 onPageChange；滚动时由 TextViewer 即时上报）
        signalRef.current.setTextScroll(el.scrollTop, el.clientHeight)
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
    // 行为信号监听：挂载即启用（阅读区元素指针通过 attachReadingArea 动态更新）
    behavioralRef.current.attach()
    return () => {
      mountedRef.current = false
      controllerRef.current?.stop()
      behavioralRef.current.detach()
    }
  }, [])

  // ── 眼动订阅 ──
  useEffect(() => {
    const unsub = subscribe((g) => engineRef.current.pushGaze(g))
    return unsub
  }, [])

  // ── 页面行为：标签切换 / 失焦 = 走神信号 ──
  useEffect(() => {
    const syncVis = (v: boolean) => {
      engineRef.current.setPageVisible(v)
      signalRef.current.setPageVisible(v)
    }
    const onVis = () => syncVis(!document.hidden)
    const onFocus = () => syncVis(true)
    const onBlur = () => syncVis(false)
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
    const trig = settingsRef.current.triggers
    const sig = signalRef.current
    // 页面不可见(切标签/失焦)：不自动介入也不弹气泡，避免离开时攒下一堆打扰
    if (document.hidden) return
    // A/B 对照组（Phase 2.2）：不自动介入也不弹气泡，手动按钮与对话始终可用
    if (!isExperimentTreatment) return
    const calm = sig.isCalm(trig.calmSec)
    const masteredLabels = [...mastery].filter(([, m]) => m >= 2).map(([id]) => safeLabel(id))
    const interv = triggerRef.current.evaluate(
      {
        state: stateRef.current,
        pageDwellSec: sig.pageDwellSec(),
        pageRereads: sig.pageRereads(),
        pageRatePerMin: sig.pageRatePerMin(trig.challengerWindowMin * 60_000),
        baselineRate: baselineRef.current,
        isCalm: calm,
        newConceptId: newConceptRef.current ?? undefined,
        masteredLabels,
      },
      trig,
      settingsRef.current.sensitivity
    )
    newConceptRef.current = null
    // 主动提问气泡：当前页停留超过配置时长、已过冷静期且非心流 → 温和提问
    if (
      !nudgeRef.current &&
      !stateRef.current.flow &&
      calm &&
      sig.pageDwellSec() >= trig.nudgeDwellSec &&
      Date.now() - lastNudgeAt.current > trig.nudgeCooldownSec * 1000
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
      const ctx = visibleContext()
      void autoIntervene(interv.agentId, ctx, interv.reason, cfg)
    }
  }

  /** 当前可见阅读片段：文本走 TextViewer，PDF 走当前页(±1)抽取文本。
   *  用 ref 判定 PDF 与否，避免被首个渲染闭包中的 stale state 误导。 */
  const visibleContext = (): string => {
    if (pdfHandle.current) return pdfHandle.current.getVisibleText().slice(-800) ?? ''
    return textHandle.current?.visibleText().slice(-600) ?? ''
  }

  const autoIntervene = async (
    agentId: AgentId,
    ctx: string,
    reason: string,
    cfg: { baseUrl: string; apiKey: string; model: string }
  ) => {
    if (!isLLMConfigured(cfg)) {
      // 未配置端点：先试本地苏格拉底（用阅读片段匹配概念，命中即可离线答疑）
      const local = localAgentReply(agentId, ctx.slice(0, 400) || '请帮我理解刚刚读到的内容')
      setTurns((t) => [
        ...t,
        {
          agentId,
          role: 'agent',
          content:
            local ??
            '我检测到你似乎遇到了困难。请先在「设置」里配置 AI 端点（sub2api 地址 + key），我才能和你对话。',
          reason,
          local: !!local,
          ts: Date.now(),
        },
      ])
      // 自动介入的消息里带上具体阅读片段，让 AI 拿到上下文（本地兜底已直接回答时不再追加）
      if (!local) return
    }
    const prompt = `我刚刚在阅读下面这段内容，系统判断我可能需要帮助（原因：${reason}）。请以你的角色介入。\n\n阅读片段：\n${trimContext(ctx)}`
    await doAgentCall(agentId, prompt, reason)
  }

  const dismissNudge = () => {
    nudgeRef.current = null
    setNudge(null)
  }

  const onConfused = () => {
    void autoIntervene('clarifier', visibleContext(), '你主动标记了困惑', settingsRef.current.llm)
  }

  const onImportant = () => {
    void autoIntervene('connector', visibleContext(), '你主动标记了重要内容', settingsRef.current.llm)
  }

  const doAgentCall = async (agentId: AgentId, userText: string, reason?: string, context?: string) => {
    const cfg = settingsRef.current.llm
    const content = context
      ? `我刚刚在阅读下面这段内容，请结合它回答我的问题。\n\n阅读片段：\n${trimContext(context)}\n\n我的问题：${userText}`
      : userText
    setTurns((t) => [...t, { agentId, role: 'user', content: userText, ts: Date.now() }])
    // 本地兜底：命中知识图谱概念时，本地苏格拉底话术可离线作答（token 用尽也能续上对话）
    const local = localAgentReply(agentId, userText)
    if (!isLLMConfigured(cfg)) {
      setTurns((t) => [
        ...t,
        {
          agentId,
          role: 'agent',
          content:
            local ??
            '尚未配置 AI 端点。可以先在「设置」里填 Base URL / Key / 模型；也可以直接输入概念名（如「二分查找」「动态规划」），我可以先用本地知识库回答你。',
          reason,
          local: !!local,
          ts: Date.now(),
        },
      ])
      return
    }
    // 常见问答缓存：同代理 + 同问题直接复用，避免重复计费（key 不含阅读片段，保证同问题缓存命中）
    const cacheKey = `${agentId}:${userText.trim()}`
    const cached = agentCache.get(cacheKey)
    if (cached) {
      setTurns((t) => [...t, { agentId, role: 'agent', content: cached, reason, ts: Date.now() }])
      return
    }
    setAgentLoading(true)
    try {
      // 多轮上下文：Token 预算化裁剪（不是固定条数），保留最近的追问
      const history: ChatMessage[] = trimHistory(turnsRef.current, agentId).map((t) => ({
        role: (t.role === 'user' ? 'user' : 'assistant') as ChatMessage['role'],
        content: t.content,
      }))
      // 分档模型：澄清者/连接者走轻量模型省成本
      const model = FAST_AGENTS.includes(agentId) ? settingsRef.current.fastModel : cfg.model
      const text = await chatCompletion(
        { ...cfg, model },
        AGENTS[agentId].systemPrompt,
        [...history, { role: 'user', content }],
        { maxTokens: 1024 }
      )
      if (agentCache.size >= CACHE_MAX) {
        const firstKey = agentCache.keys().next().value
        if (firstKey !== undefined) agentCache.delete(firstKey)
      }
      agentCache.set(cacheKey, text)
      setTurns((t) => [...t, { agentId, role: 'agent', content: text, reason, ts: Date.now() }])
    } catch (e) {
      // 余额不足/限流/服务端故障等 → 本地兜底，对话不断裂；都答不了再报可操作提示
      const err = e as Error
      const kind = err instanceof LLMError ? err.kind : 'unknown'
      setTurns((t) => [
        ...t,
        {
          agentId,
          role: 'agent',
          content:
            local ?? friendlyFailure(kind, err.message),
          reason,
          local: !!local,
          ts: Date.now(),
        },
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

  /** 统一滚动上报：认知状态 + 页信号层（后者只用于刷新冷静期） */
  const handleScrollDelta = useCallback((d: number) => {
    engineRef.current.pushScroll(d)
    signalRef.current.reportScroll()
  }, [])

  /** 文本模式滚动即时虚拟页检测（每 3s 的轮询仍保留作兜底） */
  const handleVirtualScroll = useCallback((scrollTop: number, viewportH: number) => {
    signalRef.current.setTextScroll(scrollTop, viewportH)
  }, [])

  /** PDF 逐页文本抽取完成：缓存给代理取上下文，并扫描首页概念 */
  const handlePdfText = useCallback(
    (pages: string[]) => {
      pdfTextsRef.current = pages
      if (pages.length) scanConceptsInText(pages[0], (id) => handleConceptSeen(id), pdfSeenRef.current)
    },
    [handleConceptSeen]
  )

  /** PDF 滚动跨页：页信号 + 扫描当前页概念，让连接者也能在 PDF 中触发 */
  const handlePdfPage = useCallback(
    (idx: number) => {
      signalRef.current.reportPage(idx)
      const t = pdfTextsRef.current[idx]
      if (t && t.length) scanConceptsInText(t, (id) => handleConceptSeen(id), pdfSeenRef.current)
    },
    [handleConceptSeen]
  )

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

  /** 续读恢复位置（resumeDocId 触发时填充，新导入时清空） */
  const resumePosRef = useRef<{ page?: number; scrollTop?: number } | null>(null)

  /** 开启一次新会话并渲染内容；docId 用于把续读会话也关联回已保存文档 */
  const startSession = (src: ReaderSource, docId?: number) => {
    setSource(src)
    setShowImport(false)
    sessionStart.current = Date.now()
    triggerRef.current.reset()
    signalRef.current.reset()
    resetLocalBudget()
    baselineRef.current = loadBaselineRate()
    pdfSeenRef.current = new Set()
    void db.sessions.add({
      title: src.title,
      sourceType: src.sourceType,
      startedAt: sessionStart.current,
      durationSec: 0,
      conceptsTouched: [],
      agentInterventions: 0,
      docId,
    }).then((id) => {
      sessionIdRef.current = id
    })
  }

  /** 保存文档到本地 IndexedDB（从历史记录可重新打开），并回填到当前会话 */
  const loadSource = (src: ReaderSource) => {
    startSession(src)
    void (async () => {
      try {
        const pdfData =
          src.sourceType === 'pdf' && src.file ? await src.file.arrayBuffer() : undefined
        const docId = await saveDoc({
          title: src.title,
          sourceType: src.sourceType,
          text: src.text,
          pdfData,
          createdAt: Date.now(),
        })
        if (sessionIdRef.current != null) {
          await db.sessions.update(sessionIdRef.current, { docId })
        }
      } catch (e) {
        console.error('保存文档失败', e)
      }
    })()
  }

  const saveSession = useCallback(async () => {
    if (!source || sessionIdRef.current == null) return
    const dur = Math.round((Date.now() - sessionStart.current) / 1000)
    // 会话速率样本 → 个人基线（挑战者离群检测依据）
    const minutes = dur / 60
    recordBaseline(source.title, signalRef.current.totalPagesTurned() / minutes, dur)
    await db.sessions.update(sessionIdRef.current, {
      durationSec: dur,
      conceptsTouched: [...mastery.keys()],
      agentInterventions: turns.filter((t) => t.role === 'agent' && t.reason).length,
    })
    // 续读位置写入文档记录：PDF 记当前页，文本记滚动位置（从历史可精确续读）
    const sess = await db.sessions.get(sessionIdRef.current)
    if (sess?.docId) {
      const patch: Partial<ReadingDoc> = {}
      if (source.sourceType === 'pdf') {
        patch.lastPage = pdfHandle.current?.getCurrentPage() ?? 0
      } else {
        const el = textHandle.current?.el
        if (el) patch.lastScrollTop = el.scrollTop
      }
      void db.docs.update(sess.docId, patch)
    }
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

  // ── 历史记录续读：从 docs 表取出已保存文档并重新开启会话 ──
  // token 方案：effect 因依赖变化重跑时，旧异步被丢弃，只有最新一轮能完成
  const resumeTokenRef = useRef(0)
  useEffect(() => {
    if (resumeDocId == null) return
    const token = ++resumeTokenRef.current
    let alive = true
    void (async () => {
      let src: ReaderSource | null = null
      let doc: ReadingDoc | undefined
      try {
        doc = await getDoc(resumeDocId)
        if (!alive) return
        if (!doc) {
          alert('该历史记录对应的文档已不存在（本地数据可能已被清空）')
        } else if (doc.sourceType === 'pdf') {
          if (!doc.pdfData) alert('这份 PDF 未保存文件内容，无法重新打开')
          else src = { title: doc.title, sourceType: 'pdf', file: new File([doc.pdfData], doc.title, { type: 'application/pdf' }) }
        } else {
          src = { title: doc.title, sourceType: doc.sourceType, text: doc.text ?? '' }
        }
      } catch (e) {
        console.error('读取已保存文档失败', e)
        alert('读取已保存文档失败，请重试')
      }
      if (!alive || token !== resumeTokenRef.current) return
      if (src) {
        // 恢复位置：PDF 跳上次页，文本滚上次位置
        resumePosRef.current =
          src.sourceType === 'pdf'
            ? { page: doc?.lastPage && doc.lastPage > 0 ? doc.lastPage : 0 }
            : { scrollTop: doc?.lastScrollTop ?? 0 }
        startSession(src, resumeDocId)
      }
      clearResume()
    })()
    return () => {
      alive = false
    }
  }, [resumeDocId, startSession, clearResume])

  return (
    <div className="reader-layout">
      <CognitiveStateRing state={state} />

      <div className="reader-main">
        {source?.sourceType === 'pdf' && source.file ? (
          <PdfViewer
            ref={pdfHandle}
            file={source.file}
            onScroll={handleScrollDelta}
            onTextReady={handlePdfText}
            onPageChange={handlePdfPage}
            initialPage={resumePosRef.current?.page ?? 0}
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
                      onScroll={handleScrollDelta}
                      onVirtualScroll={handleVirtualScroll}
                      onConceptSeen={handleConceptSeen}
                      initialScrollTop={resumePosRef.current?.scrollTop ?? 0}
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
                              dismissNudge()
                              void autoIntervene('clarifier', visibleContext(), '系统主动提问：在内容上停留较久', settingsRef.current.llm)
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
          onSend={(agentId, text) => void doAgentCall(agentId, text, undefined, visibleContext())}
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
