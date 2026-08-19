import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { extractDocxText } from '../docx'

const fixture = readFileSync(
  path.join(process.cwd(), 'src', 'lib', '__tests__', 'fixtures', 'sample.docx'),
)

function asFile(
  name = 'sample.docx',
  type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
): File {
  return new File([fixture], name, { type })
}

describe('docx 提取', () => {
  it('提取纯文本且保留正文内容', async () => {
    const text = await extractDocxText(asFile())
    expect(text).toContain('数据结构与算法导论')
    expect(text).toContain('复杂度分析是时间复杂度的基础')
    expect(text).toContain('链表与栈都是线性结构')
    expect(text).toContain('二叉树和哈希表')
  })

  it('段落以换行分隔（TextViewer 按空行分段），不粘连成一大块', async () => {
    const text = await extractDocxText(asFile())
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(4)
    expect(lines[0]).toBe('数据结构与算法导论')
  })

  it('非法文件抛出错误而非静默成功', async () => {
    const bad = new File(['这不是一个 docx'], 'bad.docx', { type: 'application/octet-stream' })
    await expect(extractDocxText(bad)).rejects.toThrow()
  })
})