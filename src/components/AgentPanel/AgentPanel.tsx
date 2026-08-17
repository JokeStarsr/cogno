import { memo, useState } from 'react'
import { AGENTS, AGENT_LIST } from '../../lib/agents'
import type { AgentId } from '../../types'
import './AgentPanel.css'

export interface AgentTurn {
  agentId: AgentId
  role: 'user' | 'agent'
  content: string
  reason?: string
  /** 本地离线应答（AI 不可用/余额不足时的降级回答） */
  local?: boolean
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

export const AgentPanel = memo(function AgentPanel({
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
                  {t.local && <span className="turn-local">本地</span>}
                </span>
              )}
              {t.role === 'user' && <span className="turn-name">你</span>}
              <div className="turn-bubble">{t.role === 'agent' ? <Md text={t.content} /> : t.content}</div>
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
          // 这里是对话输入，明确非登录凭据——防止密码管理器在此弹保存/填充提示
          autoComplete="off"
          name="agent-chat"
        />
        <button className="btn-primary" onClick={submit} disabled={loading || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  )
})

/** 轻量 markdown：代码块 / 粗体 / 行内代码 / 段落，无第三方依赖 */
function Md({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  const lines = text.split('\n')
  let inCode = false
  let codeBuf: string[] = []
  let para: string[] = []
  let key = 0

  const flushPara = () => {
    if (!para.length) return
    blocks.push(
      <p key={key++} className="md-para">
        {para.map((l) => inlineMd(l))}
      </p>
    )
    para = []
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushPara()
      if (inCode) {
        blocks.push(
          <pre key={key++} className="md-code">
            {esc(codeBuf.join('\n'))}
          </pre>
        )
        codeBuf = []
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }
    if (line.trim() === '') {
      flushPara()
      continue
    }
    para.push(line)
  }
  flushPara()
  if (inCode && codeBuf.length) {
    blocks.push(
      <pre key={key++} className="md-code">
        {esc(codeBuf.join('\n'))}
      </pre>
    )
  }

  return <>{blocks}</>
}

function inlineMd(line: string): React.ReactNode {
  const out: React.ReactNode[] = []
  // ```inline code``` 与 **bold** 交替切分
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index))
    const tk = m[0]
    if (tk.startsWith('`')) out.push(<code key={k++} className="md-il">{esc(tk.slice(1, -1))}</code>)
    else out.push(<strong key={k++}>{tk.slice(2, -2)}</strong>)
    last = m.index + tk.length
  }
  if (last < line.length) out.push(line.slice(last))
  return <>{out}</>
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
