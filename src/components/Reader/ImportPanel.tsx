import { useState } from 'react'
import { SAMPLE_TEXT } from '../../data/sampleText'
import { extractDocxText } from '../../lib/docx'

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
  const [extracting, setExtracting] = useState(false)
  const [fetchingUrl, setFetchingUrl] = useState(false)
  const [urlError, setUrlError] = useState('')

  const loadUrl = async () => {
    const u = url.trim()
    if (!u) return
    // 同源/后端 CORS 放行的 URL 可以抓到正文；失败则回退为 URL 文本导入并说明原因
    setFetchingUrl(true)
    setUrlError('')
    try {
      const res = await fetch(u, { mode: 'cors', signal: AbortSignal.timeout(8000) })
      if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) throw new Error('no-html')
      const html = await res.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const bodyText = (doc.body?.textContent ?? '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      if (bodyText.length > 200) {
        const title = doc.title?.trim() || u
        onLoad({ title: title.slice(0, 80), sourceType: 'url', text: bodyText })
        onClose()
        return
      }
      throw new Error('no-html')
    } catch {
      setUrlError('该网页无法直接抓取（浏览器跨域限制）。已按 URL 文本导入，或先复制网页正文再到「粘贴文本」模式阅读。')
      onLoad({ title: u.slice(0, 80), sourceType: 'url', text: u })
      onClose()
    } finally {
      setFetchingUrl(false)
    }
  }

  const load = async () => {
    if (tab === 'sample') {
      onLoad({ title: '数据结构与算法导论', sourceType: 'sample', text: SAMPLE_TEXT })
    } else if (tab === 'pdf' && file) {
      if (/\.docx$/i.test(file.name)) {
        // Word：浏览器端提取纯文本，走文本阅读管线（滚动/代理/续读全可用）
        setExtracting(true)
        try {
          const text = await extractDocxText(file)
          onLoad({ title: file.name.replace(/\.docx$/i, ''), sourceType: 'text', text })
          onClose()
          return
        } catch (e) {
          console.error('docx 提取失败', e)
          alert(`Word 文档解析失败：${e instanceof Error ? e.message : String(e)}`)
          setExtracting(false)
          return
        }
      }
      onLoad({ title: file.name, sourceType: 'pdf', file })
    } else if (tab === 'url') {
      void loadUrl()
      return
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
              {t === 'pdf' && '上传文档'}
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
            <>
              <label className="import-file">
                <input
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? `已选择：${file.name}` : '点击选择 PDF / Word 文档'}
              </label>
              <p className="import-hint">
                PDF 保留排版（扫描件自动 OCR）；Word(.docx) 自动提取文字——扫描 PDF 建议先用 Word/WPS 转成 Word 再上传，识别效果更好
              </p>
            </>
          )}
          {tab === 'url' && (
            <div className="import-url">
              <input
                className="input"
                placeholder="https://…（跨域网页将回退为 URL 文本导入）"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              {fetchingUrl && <p className="import-hint">正在抓取网页正文…</p>}
              {urlError && <p className="import-url-error">{urlError}</p>}
            </div>
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
          <button
            className="btn-primary"
            onClick={() => void load()}
            disabled={(tab === 'pdf' && !file) || extracting}
          >
            {extracting ? '正在提取…' : '开始阅读'}
          </button>
        </div>
      </div>
    </div>
  )
}
