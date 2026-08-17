import { useState } from 'react'
import { signUp, signIn, signInWithGoogle } from '../../lib/auth'
import './AuthPage.css'

/**
 * 登录/注册弹层（Phase 1.3）：邮箱密码 + Google OAuth。
 * 云端未配置时按钮禁用并提示纯本地模式（应用本身仍完全可用）。
 */
export function AuthPage({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    setNotice(null)
    setBusy(true)
    const fn = mode === 'signin' ? signIn : signUp
    const r = await fn(email, password)
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? '操作失败')
      return
    }
    if (mode === 'signup') {
      setNotice('🎉 注册成功！已自动登录（部分邮箱需先完成确认邮件）')
      setMode('signin')
      return
    }
    onClose()
  }

  const google = async () => {
    setError(null)
    setBusy(true)
    const r = await signInWithGoogle()
    setBusy(false)
    if (!r.ok) setError(r.error ?? '操作失败')
  }

  return (
    <div className="auth-mask" onClick={() => !busy && onClose()}>
      <div className="auth-card" onClick={(e) => e.stopPropagation()}>
        <button className="auth-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
        <h2>{mode === 'signin' ? '登录 Cogno' : '创建账号'}</h2>
        <p className="auth-sub">
          本地数据始终保存在你的设备上；登录后开启<b>多端同步</b>（掌握度/学习日志）
        </p>

        <label className="auth-label" htmlFor="auth-email">
          邮箱
        </label>
        <input
          id="auth-email"
          className="auth-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />

        <label className="auth-label" htmlFor="auth-password">
          密码
        </label>
        <input
          id="auth-password"
          className="auth-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'signup' ? '至少 8 位' : '请输入密码'}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}
        />

        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="auth-notice">{notice}</div>}

        <button className="auth-btn-primary" onClick={submit} disabled={busy || !email || !password}>
          {busy ? '处理中…' : mode === 'signin' ? '登录' : '注册'}
        </button>

        <div className="auth-divider">
          <span>或</span>
        </div>

        <button className="auth-btn-google" onClick={google} disabled={busy}>
          <span aria-hidden>G</span> 使用 Google 账号登录
        </button>

        <button
          className="auth-toggle"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
          }}
        >
          {mode === 'signin' ? '没有账号？注册一个' : '已有账号？去登录'}
        </button>
      </div>
    </div>
  )
}