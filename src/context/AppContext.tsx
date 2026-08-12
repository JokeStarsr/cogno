import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { db, setSetting } from '../lib/storage'
import type { LLMConfig, ViewId } from '../types'

export interface AppSettings {
  llm: LLMConfig
  /** 轻量模型(澄清者/连接者用，更便宜) */
  fastModel: string
  /** 眼动触发灵敏度 0.5-2，越高越敏感 */
  sensitivity: number
  /** 相机不可用时是否用鼠标代理 */
  mouseProxy: boolean
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
}

interface AppContextValue {
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  view: ViewId
  setView: (v: ViewId) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [view, setView] = useState<ViewId>('dashboard')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const saved = await db.settings.get('app')
      if (saved?.value && alive) {
        setSettings({ ...DEFAULT_SETTINGS, ...(saved.value as Partial<AppSettings>) })
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const updateSettings = async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    await setSetting('app', next)
  }

  return (
    <AppContext.Provider value={{ settings, updateSettings, view, setView }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
