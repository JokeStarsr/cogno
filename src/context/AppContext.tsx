import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { db, setSetting } from '../lib/storage'
import { DEFAULT_TRIGGER_CONFIG } from '../lib/agents'
import { onAuthStateChange, signOut } from '../lib/auth'
import { syncEngine } from '../lib/sync'
import type { User } from '@supabase/supabase-js'
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
  /** 云端账号（Phase 1.2/1.3）：null=未登录或云端未配置 */
  user: User | null
  authOpen: boolean
  setAuthOpen: (v: boolean) => void
  /** 同步状态：'off' 云端未配置 / 'idle' / 'syncing' / 'error' */
  syncStatus: 'off' | 'idle' | 'syncing' | 'error'
  /** 手动触发同步（拉取 + 推送队列） */
  syncNow: () => Promise<void>
  /** 登出（浏览器本地数据保留） */
  signOutUser: () => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [view, setView] = useState<ViewId>('dashboard')
  const [resumeDocId, setResumeDocId] = useState<number | null>(null)
  const [user, setUserState] = useState<User | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'off' | 'idle' | 'syncing' | 'error'>('off')

  // user 双写（ref 供稳定回调读取，state 只驱动 UI）：
  // 关键——之前 syncNow 依赖 user、订阅 effect 依赖 syncNow，而 Supabase 每分钟
  // 的 TOKEN_REFRESHED 事件都会让 user 引用变化 → effect 重挂 → 重新订阅又触发
  // 事件 → 循环风暴，每次循环全量拉取云端（用户看到的持续 GET cognitive_logs + 资源耗尽）
  const userRef = useRef<User | null>(null)
  const setUser = useCallback((u: User | null) => {
    userRef.current = u
    setUserState(u)
  }, [])
  /** 全量拉取节流：登录/手动触发 60s 内不重复（增量由 pullUserData 的 maxTs 保证） */
  const lastPullAt = useRef(0)

  // ── 云端账号与会话（Phase 1.2/1.3）：登录后自动拉取云端数据并推送本地队列 ──
  // syncNow 不依赖 user/订阅状态，保持引用稳定——只订阅一次，杜绝重订阅循环
  const syncNow = useCallback(async () => {
    if (!syncEngine.isReady()) {
      setSyncStatus('off')
      return
    }
    if (!userRef.current) {
      setSyncStatus('idle')
      return
    }
    // 60s 节流：TOKEN_REFRESHED 等高频事件不会反复触发全量拉取
    if (Date.now() - lastPullAt.current < 60_000) return
    lastPullAt.current = Date.now()
    setSyncStatus('syncing')
    try {
      await syncEngine.pullUserData()
      await syncEngine.flush()
      setSyncStatus('idle')
    } catch {
      setSyncStatus('error')
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      // 云端是否启用（构建期决定）；未启用时保持 off，不注册监听
      const { isCloudEnabled } = await import('../lib/supabase')
      if (!isCloudEnabled) {
        if (alive) setSyncStatus('off')
        return
      }
      // 只订阅一次；Supabase 每分钟有 TOKEN_REFRESHED 事件，
      // 仅在"未登录→登录"的转变时做全量拉取（其余保持 idle，增量由 pullUserData 处理）
      const unsub = onAuthStateChange((u) => {
        const prev = userRef.current
        setUser(u)
        if (u && !prev) {
          // 未登录 → 登录（或页面加载会话恢复）：拉取云端 + 推送本地队列
          void syncNow()
        }
      })
      return () => {
        alive = false
        unsub()
      }
    })()
  }, [syncNow, setUser])

  // 定时兜底同步：登录状态下每 90s 尝试推一次队列（网络恢复/失败重试）
  useEffect(() => {
    if (!user) return
    const iv = setInterval(() => {
      void syncEngine.flush()
    }, 90_000)
    return () => clearInterval(iv)
  }, [user])

  const signOutUser = async () => {
    await signOut()
    setUser(null)
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const saved = await db.settings.get('app')
      if (saved?.value && alive) {
        const s = saved.value as Partial<AppSettings>
        // 触发参数 v3 迁移：v2 老存档的数值字段语义已作废（滚动px/理解度→按页停留/回读/速率）。
        // 数值等于 v2 默认值 → 视作从未自定义，整体升级新版；自定义过 → 保留角色开关、数值用新版默认
        const migrated = migrateTriggers(s.triggers)
        setSettings({
          ...DEFAULT_SETTINGS,
          ...s,
          // 老版本存档没有 triggers 字段，逐层合并保证新字段有默认值
          triggers: { ...DEFAULT_SETTINGS.triggers, ...(migrated ?? {}) },
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
      value={{
        settings,
        updateSettings,
        view,
        setView,
        requestResume,
        clearResume,
        resumeDocId,
        user,
        authOpen,
        setAuthOpen,
        syncStatus,
        syncNow,
        signOutUser,
      }}
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

/** v2(方案B) 各数值字段的默认值——只用于迁移判定 */
const TRIGGER_V2_DEFAULTS: Record<string, number> = {
  cooldownSec: 360,
  clarifyUnderstand: 35,
  clarifyReread: 6,
  challengeScrollPx: 6000,
  expanderUnderstand: 70,
  expanderDwellSec: 120,
  nudgeDwellSec: 150,
  nudgeCooldownSec: 360,
}

function migrateTriggers(oldTrig: AgentTriggerConfig | undefined): Partial<AgentTriggerConfig> | undefined {
  if (!oldTrig) return undefined
  const untouched = Object.entries(TRIGGER_V2_DEFAULTS).every(([k, v]) => {
    const val = oldTrig[k as keyof AgentTriggerConfig]
    return val === undefined || val === v
  })
  if (untouched) return undefined
  // 自定义过数值：v3 语义下旧数值作废，仅保留角色开关
  return { enabled: oldTrig.enabled }
}
