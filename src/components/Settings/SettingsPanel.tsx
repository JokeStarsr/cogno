import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import { AGENTS } from '../../lib/agents'
import { baselineStatus } from '../../lib/readingSignals'
import { db } from '../../lib/storage'
import { chatCompletion, friendlyFailure, isLLMConfigured, LLMError } from '../../lib/llm'
import type { AgentId } from '../../types'
import './SettingsPanel.css'

const AGENT_IDS: AgentId[] = ['clarifier', 'challenger', 'connector', 'expander']

export function SettingsPanel() {
  const { settings, updateSettings } = useApp()
  const [saved, setSaved] = useState(false)
  const [base, setBase] = useState(() => baselineStatus())
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [form, setForm] = useState(() => ({
    baseUrl: settings.llm.baseUrl,
    apiKey: settings.llm.apiKey,
    model: settings.llm.model,
    fastModel: settings.fastModel,
    sensitivity: settings.sensitivity,
    mouseProxy: settings.mouseProxy,
    trigEnabled: { ...settings.triggers.enabled },
    trigCooldownMin: settings.triggers.cooldownSec / 60,
    trigCalmSec: settings.triggers.calmSec,
    trigClarifyDwellSec: settings.triggers.clarifyDwellSec,
    trigClarifyPageReread: settings.triggers.clarifyPageReread,
    trigChallengerMult: settings.triggers.challengerRateMult,
    trigChallengerFallback: settings.triggers.challengerFallbackRate,
    trigChallengerWindowMin: settings.triggers.challengerWindowMin,
    trigExpanderDwellSec: settings.triggers.expanderDwellSec,
    trigNudgeDwellSec: settings.triggers.nudgeDwellSec,
    trigNudgeCooldownMin: settings.triggers.nudgeCooldownSec / 60,
  }))

  const save = async () => {
    await updateSettings({
      llm: { baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model },
      fastModel: form.fastModel,
      sensitivity: form.sensitivity,
      mouseProxy: form.mouseProxy,
      triggers: {
        enabled: form.trigEnabled,
        cooldownSec: Math.round(form.trigCooldownMin * 60),
        calmSec: Math.round(form.trigCalmSec),
        clarifyDwellSec: Math.round(form.trigClarifyDwellSec),
        clarifyPageReread: Math.round(form.trigClarifyPageReread),
        challengerRateMult: form.trigChallengerMult,
        challengerFallbackRate: form.trigChallengerFallback,
        challengerWindowMin: Math.round(form.trigChallengerWindowMin),
        expanderDwellSec: Math.round(form.trigExpanderDwellSec),
        nudgeDwellSec: Math.round(form.trigNudgeDwellSec),
        nudgeCooldownSec: Math.round(form.trigNudgeCooldownMin * 60),
      },
    })
    setBase(baselineStatus())
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  /** 最小成本连通性测试：空 system + 单条 ping，输出上限压到 8 token */
  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      await chatCompletion(
        { baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model },
        '',
        [{ role: 'user', content: 'ping' }],
        { maxTokens: 8 }
      )
      setTestResult({ ok: true, msg: '连接正常，端点可用。' })
    } catch (e) {
      const err = e as Error
      const kind = err instanceof LLMError ? err.kind : 'unknown'
      setTestResult({ ok: false, msg: friendlyFailure(kind, err.message) })
    } finally {
      setTesting(false)
    }
  }

  const clearAll = async () => {
    if (
      !confirm(
        '将清空本地全部学习数据（概念掌握度、阅读记录、认知日志、已保存文档）。此操作不可恢复。'
      )
    )
      return
    await Promise.all([
      db.concepts.clear(),
      db.sessions.clear(),
      db.cognitiveLogs.clear(),
      db.docs.clear(),
    ])
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
          {configured ? '✓ AI 已配置，代理可用' : '⚠ 尚未配置完整，将使用本地苏格拉底问答'}
        </div>
        <div className="set-row">
          <label>端点测试</label>
          <button className="btn-ghost" onClick={testConnection} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          {testResult && (
            <span className={`set-test ${testResult.ok ? 'ok' : 'err'}`}>{testResult.msg}</span>
          )}
        </div>
        <p className="set-note">
          测试只发一个最小请求（约 10 token），用来验证 Base URL / Key / 模型是否可用，并
          及时识别"余额不足 / 无可用账户 / 限流"。
        </p>
      </section>

      <section className="set-section panel">
        <h2>苏格拉底代理 · 自动介入</h2>
        <p className="set-note">
          四角色按阅读行为自动介入。可逐代理开关，也可调整触发阈值——觉得谁爱出来凑热闹或总不来，就在这调。
          「触发灵敏度」会放大/缩小所有实测信号（越高越容易触发）。
        </p>
        <div className="set-row">
          <label>自动介入</label>
          <div className="agent-toggles">
            {AGENT_IDS.map((id) => (
              <label key={id} className="agent-toggle">
                <span className="agent-dot" style={{ background: AGENTS[id].color }} />
                <span className="agent-toggle-name">{AGENTS[id].name}</span>
                <input
                  type="checkbox"
                  checked={form.trigEnabled[id]}
                  onChange={(e) =>
                    setForm({ ...form, trigEnabled: { ...form.trigEnabled, [id]: e.target.checked } })
                  }
                />
              </label>
            ))}
          </div>
        </div>
        <div className="set-row">
          <label>介入冷却</label>
          <input
            className="num"
            type="number"
            min="0.5"
            max="20"
            step="0.5"
            value={form.trigCooldownMin}
            onChange={(e) => setForm({ ...form, trigCooldownMin: Number(e.target.value) })}
          />
          <span className="set-hint">分钟 · 同一角色两次自动介入的最小间隔</span>
        </div>
        <div className="set-row">
          <label>冷静期</label>
          <input
            className="num"
            type="number"
            min="0"
            max="600"
            step="10"
            value={form.trigCalmSec}
            onChange={(e) => setForm({ ...form, trigCalmSec: Number(e.target.value) })}
          />
          <span className="set-hint">秒 · 最近一次翻页/滚动后不打扰（这就是你的思考时间）</span>
        </div>
        <div className="set-row">
          <label>澄清者</label>
          <span className="set-hint">同一页停留 ≥</span>
          <input
            className="num"
            type="number"
            min="0"
            step="10"
            value={form.trigClarifyDwellSec}
            onChange={(e) => setForm({ ...form, trigClarifyDwellSec: Number(e.target.value) })}
          />
          <span className="set-hint">秒 且该页回读 ≥</span>
          <input
            className="num"
            type="number"
            min="0"
            max="20"
            value={form.trigClarifyPageReread}
            onChange={(e) => setForm({ ...form, trigClarifyPageReread: Number(e.target.value) })}
          />
          <span className="set-hint">次（或点「我困惑了」）</span>
        </div>
        <div className="set-row">
          <label>挑战者</label>
          <span className="set-hint">翻页速率超个人基线 ×</span>
          <input
            className="num"
            type="number"
            min="1"
            max="10"
            step="0.5"
            value={form.trigChallengerMult}
            onChange={(e) => setForm({ ...form, trigChallengerMult: Number(e.target.value) })}
          />
          <span className="set-hint">倍（无基线时 &gt; </span>
          <input
            className="num"
            type="number"
            min="0"
            step="0.5"
            value={form.trigChallengerFallback}
            onChange={(e) => setForm({ ...form, trigChallengerFallback: Number(e.target.value) })}
          />
          <span className="set-hint">页/分），窗口 ≥</span>
          <input
            className="num"
            type="number"
            min="1"
            max="20"
            value={form.trigChallengerWindowMin}
            onChange={(e) => setForm({ ...form, trigChallengerWindowMin: Number(e.target.value) })}
          />
          <span className="set-hint">分钟且该页无回读</span>
        </div>
        <div className="set-row">
          <label>个人基线</label>
          <span className="set-hint">
            {base.rate != null
              ? `当前 ${base.rate.toFixed(2)} 页/分（${base.n} 篇样本，最近 3 篇取均值）`
              : `尚未建立（需 ${2 - base.n} 篇 2 分钟以上样本，读满 3 篇自动启用）`}
          </span>
        </div>
        <div className="set-row">
          <label>拓展者</label>
          <span className="set-hint">同一页持续停留 ≥</span>
          <input
            className="num"
            type="number"
            min="0"
            step="10"
            value={form.trigExpanderDwellSec}
            onChange={(e) => setForm({ ...form, trigExpanderDwellSec: Number(e.target.value) })}
          />
          <span className="set-hint">秒且中途无回读</span>
        </div>
        <div className="set-row">
          <label>主动提问</label>
          <span className="set-hint">当前页停留 ≥</span>
          <input
            className="num"
            type="number"
            min="0"
            step="5"
            value={form.trigNudgeDwellSec}
            onChange={(e) => setForm({ ...form, trigNudgeDwellSec: Number(e.target.value) })}
          />
          <span className="set-hint">秒弹出气泡，间隔 ≥</span>
          <input
            className="num"
            type="number"
            min="0"
            step="0.5"
            value={form.trigNudgeCooldownMin}
            onChange={(e) => setForm({ ...form, trigNudgeCooldownMin: Number(e.target.value) })}
          />
          <span className="set-hint">分钟</span>
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