import { useApp } from './context/AppContext'
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
export default function App() {
  const { view, setView } = useApp()

  return (
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
  )
}