import { useState } from 'react'
import { SAMPLE_TEXT } from '../../data/sampleText'

export interface ReaderSource {
  title: string
  sourceType: 'pdf' | 'url' | 'text' | 'sample'
  text?: string
  file?: File
}

interface Props {
  onLoad: (src: ReaderSource) => void
  onClose: () => void
}

export function ImportPanel({ onLoad, onClose }: Props) {
  const [tab, setTab] = useState<'sample' | 'pdf' | 'url' | 'text'>('sample')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const load = () => {
    if (tab === 'sample') {
      onLoad({ title: '数据结构与算法导论', sourceType: 'sample', text: SAMPLE_TEXT })
    } else if (tab === 'pdf' && file) {
      onLoad({ title: file.name, sourceType: 'pdf', file })
    } else if (tab === 'url' && url.trim()) {
      onLoad({ title: url.trim(), sourceType: 'url', text: url.trim() })
    } else if (tab === 'text' && text.trim()) {
      onLoad({ title: '我的笔记', sourceType: 'text', text })
    }
    onClose()
  }

  return (
    <div className="import-overlay">
      <div className="import-card panel">
        <div className="import-tabs">
          {(['sample', 'pdf', 'url', 'text'] as const).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'sample' && '示例文章'}
              {t === 'pdf' && '上传 PDF'}
              {t === 'url' && '粘贴网页'}
              {t === 'text' && '粘贴文本'}
            </button>
          ))}
        </div>

        <div className="import-body">
          {tab === 'sample' && (
            <p className="import-hint">加载内置示例：《数据结构与算法导论》，用于演示眼动追踪与代理介入。</p>
          )}
          {tab === 'pdf' && (
            <label className="import-file">
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? `已选择：${file.name}` : '点击选择 PDF 文件'}
            </label>
          )}
          {tab === 'url' && (
            <input
              className="input"
              placeholder="https://…（受浏览器跨域限制，部分网页无法直接读取）"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
          {tab === 'text' && (
            <textarea
              className="input import-textarea"
              placeholder="粘贴要阅读的文本…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </div>

        <div className="import-actions">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={load} disabled={tab === 'pdf' && !file}>
            开始阅读
          </button>
        </div>
      </div>
    </div>
  )
}
