import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { db, setSetting } from '../lib/storage'
import { DEFAULT_TRIGGER_CONFIG } from '../lib/agents'
import type { AgentTriggerConfig, LLMConfig, ViewId } from '../types'

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
        const s = saved.value as Partial<AppSettings>
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
