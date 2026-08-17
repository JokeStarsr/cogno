import { useEffect, useState } from 'react'
import { useApp } from './context/AppContext'
import { PrivacyConsent } from './components/Legal/PrivacyConsent'
import { Dashboard } from './components/Dashboard/Dashboard'
import { ReaderPage } from './components/Reader/ReaderPage'
import { SettingsPanel } from './components/Settings/SettingsPanel'
import type { ViewId } from './types'
import './App.css'

const NAV: { id: ViewId; label: string }[] = [
  { id: 'dashboard', label: '学习概览' },
  { id: 'reader', label: '阅读器' },
  { id: 'settings', label: '设置' },
]

/** 三页全部保持挂载，用 CSS 显隐切换：
 *  阅读中途去设置/回概览，会话、AI 对话、滚动位置与眼动追踪都不中断 */
/** Phase 3.3：离线横幅——阅读本地数据仍可用，联网后自动恢复 */
function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine)
  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  if (!offline) return null
  return (
    <div className="offline-banner" role="status">
      ⚠️ 当前处于离线模式：已导入文档、知识网格与本地问答仍可用；AI 对话与联网功能暂停，数据不会丢失
    </div>
  )
}

export default function App() {
  const { view, setView } = useApp()

  return (
    <PrivacyConsent>
    <OfflineBanner />
    <div className="app-shell">
      <nav className="top-nav">
        <div className="brand">
          <span className="brand-orb" />
          <span className="brand-name">Cogno Reader</span>
        </div>
        <div className="nav-links">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-link ${view === n.id ? 'active' : ''}`}
              onClick={() => setView(n.id)}
            >
              {n.label}
            </button>
          ))}
        </div>
        <div className="nav-spacer" />
      </nav>
      <main className="app-main">
        <div className={`page ${view === 'dashboard' ? 'page-active' : ''}`}>
          <Dashboard />
        </div>
        <div className={`page ${view === 'reader' ? 'page-active' : ''}`}>
          <ReaderPage />
        </div>
        <div className={`page ${view === 'settings' ? 'page-active' : ''}`}>
          <SettingsPanel />
        </div>
      </main>
    </div>
    </PrivacyConsent>
  )
}