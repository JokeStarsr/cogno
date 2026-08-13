import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import { db } from '../../lib/storage'
import { isLLMConfigured } from '../../lib/llm'
import './SettingsPanel.css'

export function SettingsPanel() {
  const { settings, updateSettings } = useApp()
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    baseUrl: settings.llm.baseUrl,
    apiKey: settings.llm.apiKey,
    model: settings.llm.model,
    fastModel: settings.fastModel,
    sensitivity: settings.sensitivity,
    mouseProxy: settings.mouseProxy,
  })

  const save = async () => {
    await updateSettings({
      llm: { baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model },
      fastModel: form.fastModel,
      sensitivity: form.sensitivity,
      mouseProxy: form.mouseProxy,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  const clearAll = async () => {
    if (!confirm('将清空本地全部学习数据（概念掌握度、阅读记录、认知日志）。此操作不可恢复。')) return
    await Promise.all([db.concepts.clear(), db.sessions.clear(), db.cognitiveLogs.clear()])
    alert('已清空')
  }

  const configured = isLLMConfigured(settings.llm)

  return (
    <div className="settings">
      <h1>设置</h1>

      <section className="set-section panel">
        <h2>AI 代理配置（sub2api / 任意 Anthropic 兼容端点）</h2>
        <p className="set-note">
          四个苏格拉底代理通过这里配置的端点调用，配合你的 claude-code key，key 仅保存在本机浏览器。
          本机调试填 <code>http://localhost:8180</code>；<b>手机/远程设备请用服务器代理</b>{' '}
          <code>http://115.159.221.62:8090/ai</code>（同源转发，手机可直接访问）。
        </p>
        <div className="set-row">
          <label>Base URL</label>
          <input
            className="input"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            placeholder="http://localhost:8180"
          />
          <button
            className="btn-ghost"
            onClick={() => setForm({ ...form, baseUrl: 'http://localhost:8180' })}
          >
            本地
          </button>
          <button
            className="btn-ghost"
            onClick={() => setForm({ ...form, baseUrl: 'http://115.159.221.62:8090/ai' })}
          >
            服务器代理
          </button>
        </div>
        <div className="set-row">
          <label>API Key</label>
          <input
            className="input"
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder="sk-…"
          />
        </div>
        <div className="set-row">
          <label>模型</label>
          <input
            className="input"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="claude-sonnet-4-5-20250929"
          />
        </div>
        <div className="set-row">
          <label>轻量模型</label>
          <input
            className="input"
            value={form.fastModel}
            onChange={(e) => setForm({ ...form, fastModel: e.target.value })}
            placeholder="claude-haiku-4-5-20251001"
          />
        </div>
        <p className="set-note">澄清者/连接者走轻量模型（成本更低），挑战者/拓展者走上方主模型。</p>
        <div className={`set-status ${configured ? 'ok' : 'warn'}`}>
          {configured ? '✓ AI 已配置，代理可用' : '⚠ 尚未配置完整，代理对话不可用'}
        </div>
      </section>

      <section className="set-section panel">
        <h2>眼动追踪</h2>
        <div className="set-row">
          <label>触发灵敏度</label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={form.sensitivity}
            onChange={(e) => setForm({ ...form, sensitivity: Number(e.target.value) })}
          />
          <span className="set-val">{form.sensitivity.toFixed(1)}</span>
        </div>
        <div className="set-row">
          <label>无相机时用鼠标代理</label>
          <input
            type="checkbox"
            checked={form.mouseProxy}
            onChange={(e) => setForm({ ...form, mouseProxy: e.target.checked })}
          />
        </div>
        <p className="set-note">眼动数据全部在本机处理，不上传云端。摄像头权限在阅读器首次启动时请求。</p>
      </section>

      <section className="set-section panel">
        <h2>数据</h2>
        <div className="set-row">
          <label>清空全部本地数据</label>
          <button className="btn-ghost danger" onClick={clearAll}>
            清空
          </button>
        </div>
      </section>

      <div className="set-save">
        <button className="btn-primary" onClick={save}>
          保存设置
        </button>
        {saved && <span className="set-saved">已保存</span>}
      </div>
    </div>
  )
}
