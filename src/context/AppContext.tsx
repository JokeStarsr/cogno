import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { db, setSetting } from '../lib/storage'
import { DEFAULT_TRIGGER_CONFIG, LEGACY_TRIGGER_CONFIG } from '../lib/agents'
import type { AgentId, AgentTriggerConfig, LLMConfig, ViewId } from '../types'

export interface AppSettings {
  llm: LLMConfig
  /** 轻量模型(澄清者/连接者用，更便宜) */
  fastModel: string
  /** 代理触发灵敏度 0.5-2，越高越敏感（作用于所有触发阈值） */
  sensitivity: number
  /** 相机不可用时是否用鼠标代理 */
  mouseProxy: boolean
  /** 苏格拉底四代理自动介入触发配置 */
  triggers: AgentTriggerConfig
}

const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    baseUrl: 'http://localhost:8180',
    apiKey: '',
    model: 'claude-sonnet-4-5-20250929',
  },
  fastModel: 'claude-haiku-4-5-20251001',
  sensitivity: 1,
  mouseProxy: true,
  triggers: DEFAULT_TRIGGER_CONFIG,
}

interface AppContextValue {
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  view: ViewId
  setView: (v: ViewId) => void
  /** 历史记录续读：请求把某篇已保存的文档重新载入阅读器 */
  requestResume: (docId: number) => void
  clearResume: () => void
  resumeDocId: number | null
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [view, setView] = useState<ViewId>('dashboard')
  const [resumeDocId, setResumeDocId] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const saved = await db.settings.get('app')
      if (saved?.value && alive) {
        let s = saved.value as Partial<AppSettings>
        // 触发参数 v2 迁移：整个 triggers 仍等于旧默认值（从未自定义过）的老存档，
        // 丢弃后由合并逻辑自然升级为新默认；自定义过任一值的存档不动
        if (s.triggers && equalTriggers(s.triggers, LEGACY_TRIGGER_CONFIG)) {
          s = { ...s, triggers: undefined }
        }
        setSettings({
          ...DEFAULT_SETTINGS,
          ...s,
          // 老版本存档没有 triggers 字段，逐层合并保证新字段有默认值
          triggers: { ...DEFAULT_SETTINGS.triggers, ...(s.triggers ?? {}) },
        })
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const updateSettings = async (patch: Partial<AppSettings>) => {
    const next = {
      ...settings,
      ...patch,
      triggers: { ...settings.triggers, ...(patch.triggers ?? {}) },
    }
    setSettings(next)
    await setSetting('app', next)
  }

  const requestResume = useCallback((docId: number) => setResumeDocId(docId), [])
  const clearResume = useCallback(() => setResumeDocId(null), [])

  return (
    <AppContext.Provider
      value={{ settings, updateSettings, view, setView, requestResume, clearResume, resumeDocId }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

/** 字段级比较，忽略对象键顺序差异 */
function equalTriggers(a: AgentTriggerConfig, b: AgentTriggerConfig): boolean {
  return (
    a.cooldownSec === b.cooldownSec &&
    a.clarifyUnderstand === b.clarifyUnderstand &&
    a.clarifyReread === b.clarifyReread &&
    a.challengeScrollPx === b.challengeScrollPx &&
    a.expanderUnderstand === b.expanderUnderstand &&
    a.expanderDwellSec === b.expanderDwellSec &&
    a.nudgeDwellSec === b.nudgeDwellSec &&
    a.nudgeCooldownSec === b.nudgeCooldownSec &&
    ['clarifier', 'challenger', 'connector', 'expander'].every(
      (k) => a.enabled[k as AgentId] === b.enabled[k as AgentId]
    )
  )
}
