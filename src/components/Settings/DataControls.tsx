import { useState } from 'react'
import { db } from '../../lib/storage'

/**
 * 数据自主权（Phase 1.5）：导出全部本地数据为 JSON、删除全部本地数据。
 * 当前版本数据全在本地 IndexedDB，导出即完整的个人数据副本。
 */
export function DataControls() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const exportData = async () => {
    setBusy(true)
    setMessage('')
    try {
      // 导出全部表：settings/concepts/sessions/cognitiveLogs/docs
      const tables: Record<string, string[]> = {}
      for (const t of ['settings', 'concepts', 'sessions', 'cognitiveLogs', 'docs'] as const) {
        const table = db[t as keyof typeof db] as unknown as { toArray: () => Promise<unknown[]> } | undefined
        if (table && typeof table.toArray === 'function') {
          tables[t] = (await table.toArray()) as string[]
        }
      }
      // 附带本地设置（app 级 localStorage 键以 cogno. 开头）
      const localPrefs: Record<string, unknown> = {}
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('cogno.')) localPrefs[k] = localStorage.getItem(k)
      }
      const bundle = { exportedAt: new Date().toISOString(), tables, localPrefs }
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cogno-data-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setMessage('✅ 数据已导出为 JSON')
    } catch (e) {
      setMessage(`❌ 导出失败: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const [confirming, setConfirming] = useState(false)

  const deleteAll = async () => {
    setBusy(true)
    setMessage('')
    try {
      await db.delete() // 删除整个 IndexedDB
      // 清掉本地偏好（隐私同意/实验桶/基线等）
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('cogno.')) keys.push(k)
      }
      keys.forEach((k) => localStorage.removeItem(k))
      setMessage('✅ 全部数据已删除，页面即将刷新')
      setTimeout(() => location.reload(), 1200)
    } catch (e) {
      setMessage(`❌ 删除失败: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  return (
    <div className="data-controls" style={{ marginTop: 18 }}>
      <h3>🔐 数据自主权</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <button
          className="btn btn-sm"
          style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' }}
          onClick={exportData}
          disabled={busy}
        >
          ⬇ 导出我的数据（JSON）
        </button>
        {!confirming ? (
          <button
            className="btn btn-sm btn-consent-danger"
            style={{ background: 'rgba(255,99,71,0.15)', color: '#ff6347', border: '1px solid rgba(255,99,71,0.4)' }}
            onClick={() => setConfirming(true)}
          >
            🗑 删除我的数据
          </button>
        ) : (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: 'rgba(255,99,71,0.12)',
              border: '1px solid rgba(255,99,71,0.5)',
              borderRadius: 8,
              fontSize: 13,
              color: '#ff6347',
            }}
          >
            确认删除？此操作不可恢复
            <button className="btn btn-sm" style={{ color: '#ff6347', fontWeight: 700, cursor: 'pointer' }} onClick={deleteAll} disabled={busy}>
              确认删除
            </button>
            <button className="btn btn-sm" style={{ cursor: 'pointer' }} onClick={() => setConfirming(false)}>
              取消
            </button>
          </span>
        )}
      </div>
      {message && (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text2)' }}>{message}</div>
      )}
    </div>
  )
}