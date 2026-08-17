import { useEffect, useState } from 'react'
import './PrivacyConsent.css'

const CONSENT_KEY = 'cogno.privacyConsent'

/**
 * 隐私同意门（Phase 1.5）：首次使用必须同意隐私条款才能进入应用。
 * 同意状态存 localStorage；「查看完整隐私政策」打开 privacy.html。
 */
export function PrivacyConsent({ children }: { children: React.ReactNode }) {
  const [agreed, setAgreed] = useState<boolean | null>(null)

  useEffect(() => {
    setAgreed(localStorage.getItem(CONSENT_KEY) === '1')
  }, [])

  if (agreed === true) return <>{children}</>
  if (agreed === null) return null // 读取中不闪内容

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, '1')
    setAgreed(true)
  }

  return (
    <>
      {children}
      <div className="consent-mask" role="dialog" aria-label="隐私同意">
        <div className="consent-card">
          <h2>在使用 Cogno Reader 之前，请确认以下内容</h2>
          <ul>
            <li><b>数据收集范围</b>：眼动坐标、阅读行为（翻页/停留/回读）、摄像头画面（仅在眼动追踪启用时）</li>
            <li><b>用途</b>：仅在本地进行认知状态推断，用于改善阅读陪伴体验</li>
            <li><b>存储位置</b>：目前全部数据保存在你的浏览器本地（IndexedDB）；未来接入云端同步时将有明确提示</li>
            <li><b>不分享</b>：你的阅读数据不会分享给任何第三方</li>
          </ul>
          <div className="consent-actions">
            <a className="consent-link" href="/privacy.html" target="_blank" rel="noreferrer">
              查看完整隐私政策
            </a>
            <button className="btn-consent" onClick={accept}>
              同意并继续
            </button>
          </div>
        </div>
      </div>
    </>
  )
}