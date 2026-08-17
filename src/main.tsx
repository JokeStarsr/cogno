import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { AppProvider } from './context/AppContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>
)

/**
 * PWA 更新自检（替代"让用户手清缓存"的方案）：
 * 新版本 Service Worker 就绪时广播 cogno-sw-update 事件，
 * App 顶部出现「点击刷新获取新版本」横幅，一键完成更新。
 * 正轨是部署原子切换（服务端无中间态）+ 此横幅（客户端零手工操作）。
 */
function setupSwUpdates() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing
          if (!nw) return
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new Event('cogno-sw-update'))
            }
          })
        })
      })
      .catch(() => {
        /* SW 不可用（非安全上下文等）不影响功能 */
      })
  })
}
setupSwUpdates()