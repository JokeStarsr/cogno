import { useState } from 'react'
import { PLANS, type Plan } from '../../lib/billing'
import './PricingPanel.css'

interface Props {
  /** 当前方案（AppProvider 提供：本地模式恒 free） */
  currentPlan: Plan
  /** 云端可用（Supabase 就绪且已登录）时传 true，否则显示配置占位 */
  cloudReady?: boolean
}

/** 订阅入口（Phase 1.4）：云端未就绪时按钮引导配置，就绪后调 Supabase Edge Function */
export function PricingPanel({ currentPlan, cloudReady = false }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const checkout = async (plan: Plan) => {
    setError('')
    setBusy(plan)
    try {
      const res = await fetch('/functions/v1/stripe-checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      const j = (await res.json()) as { url?: string }
      if (j.url) window.location.href = j.url
      else throw new Error('未收到支付链接')
    } catch (e) {
      setError(e instanceof Error ? e.message : '支付发起失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="set-section panel">
      <h2>订阅方案</h2>
      <p className="set-note">
        免费档满足日常阅读；Pro 解锁无限 AI 代理、云端同步与全部学科。当前方案：
        <b className="plan-current">{PLANS.find((p) => p.key === currentPlan)?.name ?? '免费'}</b>
      </p>
      <div className="pricing-grid">
        {PLANS.map((p) => {
          const isCurrent = p.key === currentPlan
          return (
            <div key={p.key} className={`pricing-card ${p.key === 'pro' ? 'hot' : ''} ${isCurrent ? 'current' : ''}`}>
              <div className="pricing-name">{p.name}</div>
              <div className="pricing-price">
                {p.price}
                <span className="pricing-note">{p.priceNote}</span>
              </div>
              <ul className="pricing-features">
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {isCurrent ? (
                <span className="pricing-badge">当前方案</span>
              ) : cloudReady ? (
                <button
                  className="btn-primary"
                  disabled={busy !== null}
                  onClick={() => void checkout(p.key)}
                >
                  {busy === p.key ? '跳转中…' : '立即订阅'}
                </button>
              ) : (
                <span className="pricing-lock">配置 Supabase + Stripe 后启用</span>
              )}
            </div>
          )
        })}
      </div>
      {error && <p className="set-test err">{error}</p>}
    </section>
  )
}