import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { listConcepts, listDue } from '../../lib/spacedRepetition'
import { getConcept } from '../../lib/knowledge'
import { db } from '../../lib/storage'
import type { ReviewItem, ReadingSession } from '../../types'
import './Dashboard.css'

export function Dashboard() {
  const { setView } = useApp()
  const [concepts, setConcepts] = useState<ReviewItem[]>([])
  const [due, setDue] = useState<ReviewItem[]>([])
  const [sessions, setSessions] = useState<ReadingSession[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [c, d, s] = await Promise.all([listConcepts(), listDue(), db.sessions.orderBy('startedAt').reverse().limit(7).toArray()])
      if (!alive) return
      setConcepts(c)
      setDue(d)
      setSessions(s)
    })()
    return () => {
      alive = false
    }
  }, [])

  const mastered = concepts.filter((c) => c.mastery >= 2).length
  const deepMastered = concepts.filter((c) => c.mastery === 3).length
  const todayMs = sessions.reduce((a, s) => a + s.durationSec, 0)
  const days = new Set(
    sessions.map((s) => new Date(s.startedAt).toISOString().slice(0, 10))
  ).size

  const cards = [
    { label: '今日阅读', value: formatDuration(todayMs), hint: `${sessions.length} 次会话` },
    { label: '已掌握概念', value: mastered, hint: `深度掌握 ${deepMastered}` },
    { label: '待复习', value: due.length, hint: '间隔重复到期' },
    { label: '连续学习', value: `${days} 天`, hint: '本地记录' },
  ]

  return (
    <div className="dashboard">
      <h1 className="dash-title">学习概览</h1>
      <div className="dash-cards">
        {cards.map((c) => (
          <div key={c.label} className="dash-card panel">
            <div className="dash-card-value">{c.value}</div>
            <div className="dash-card-label">{c.label}</div>
            <div className="dash-card-hint">{c.hint}</div>
          </div>
        ))}
      </div>

      <div className="dash-actions">
        <button className="btn-primary" onClick={() => setView('reader')}>
          开始阅读
        </button>
        <button className="btn-ghost" onClick={() => setView('settings')}>
          配置 AI
        </button>
      </div>

      <div className="dash-columns">
        <div className="dash-col panel">
          <h2>待复习概念</h2>
          {due.length === 0 ? (
            <p className="dash-empty">当前没有到期的复习任务，专注阅读吧。</p>
          ) : (
            <ul className="dash-due">
              {due.slice(0, 12).map((d) => (
                <li key={d.conceptId}>
                  <span className="due-name">{safeLabel(d.conceptId)}</span>
                  <span className="due-mastery">掌握度 {d.mastery}/3</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-col panel">
          <h2>最近阅读</h2>
          {sessions.length === 0 ? (
            <p className="dash-empty">还没有阅读记录。开始第一次阅读吧。</p>
          ) : (
            <ul className="dash-sessions">
              {sessions.map((s) => (
                <li key={s.id}>
                  <div className="sess-title">{s.title}</div>
                  <div className="sess-meta">
                    {new Date(s.startedAt).toLocaleString('zh-CN')} · {formatDuration(s.durationSec)} ·{' '}
                    {s.agentInterventions} 次代理介入
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function safeLabel(id: string): string {
  try {
    return getConcept(id).label
  } catch {
    return id
  }
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}秒`
  if (sec < 3600) return `${Math.round(sec / 60)}分钟`
  return `${(sec / 3600).toFixed(1)}小时`
}
