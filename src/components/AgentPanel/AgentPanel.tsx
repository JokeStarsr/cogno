import { useState } from 'react'
import { AGENTS, AGENT_LIST } from '../../lib/agents'
import type { AgentId } from '../../types'
import './AgentPanel.css'

export interface AgentTurn {
  agentId: AgentId
  role: 'user' | 'agent'
  content: string
  reason?: string
  ts: number
}

interface Props {
  activeAgent: AgentId
  onSelectAgent: (a: AgentId) => void
  turns: AgentTurn[]
  loading: boolean
  onSend: (agentId: AgentId, text: string) => void
  onClose: () => void
  /** 刚被自动触发时的原因提示 */
  lastReason?: string
}

export function AgentPanel({
  activeAgent,
  onSelectAgent,
  turns,
  loading,
  onSend,
  onClose,
  lastReason,
}: Props) {
  const [input, setInput] = useState('')
  const agent = AGENTS[activeAgent]

  const submit = () => {
    const t = input.trim()
    if (!t || loading) return
    onSend(activeAgent, t)
    setInput('')
  }

  return (
    <div className="agent-panel panel">
      <div className="agent-header">
        <div className="agent-tabs">
          {AGENT_LIST.map((id) => {
            const a = AGENTS[id]
            return (
              <button
                key={id}
                className={`agent-tab ${activeAgent === id ? 'active' : ''}`}
                style={{ '--ac': a.color } as React.CSSProperties}
                onClick={() => onSelectAgent(id)}
                title={a.tagline}
              >
                <span className="agent-orb" style={{ background: a.color }} />
                {a.name}
              </button>
            )
          })}
        </div>
        <button className="agent-close" onClick={onClose} aria-label="收起">
          ×
        </button>
      </div>

      {lastReason && activeAgent && turns[turns.length - 1]?.agentId === activeAgent && (
        <div className="agent-reason">系统提示：{lastReason}</div>
      )}

      <div className="agent-body">
        {turns.length === 0 ? (
          <div className="agent-empty">
            <p style={{ color: agent.color }}>{agent.tagline}</p>
            <p className="agent-style">声音：{agent.style}</p>
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={`turn ${t.role === 'user' ? 'user' : 'agent'}`}>
              {t.role === 'agent' && (
                <span className="turn-name" style={{ color: AGENTS[t.agentId].color }}>
                  {AGENTS[t.agentId].name}
                </span>
              )}
              {t.role === 'user' && <span className="turn-name">你</span>}
              <div className="turn-bubble">{t.content}</div>
              {t.reason && <div className="turn-reason">{t.reason}</div>}
            </div>
          ))
        )}
        {loading && (
          <div className="agent-typing">
            <span className="breathing-dot" style={{ background: agent.color }} />
            <span className="breathing-dot" style={{ background: agent.color }} />
            <span className="breathing-dot" style={{ background: agent.color }} />
          </div>
        )}
      </div>

      <div className="agent-input">
        <input
          className="input"
          value={input}
          placeholder={`和${agent.name}说点什么…`}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          disabled={loading}
        />
        <button className="btn-primary" onClick={submit} disabled={loading || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  )
}
