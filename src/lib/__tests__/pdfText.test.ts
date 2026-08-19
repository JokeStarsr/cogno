import { describe, it, expect } from 'vitest'
import { nearbyNonEmptyText } from '../pdfText'

describe('nearbyNonEmptyText', () => {
  it('空数组返回 null', () => {
    expect(nearbyNonEmptyText([], 0)).toBeNull()
  })

  it('当前页有文本时优先当前页并带左右页', () => {
    const pages = ['', '第二页内容', '第三页', '', '第五页']
    const r = nearbyNonEmptyText(pages, 2)
    expect(r).not.toBeNull()
    expect(r!.text).toContain('第二页内容')
    expect(r!.text).toContain('第三页')
    expect(r!.pages).toContain(2)
  })

  it('当前页为空时循环向外找最近的已识别页', () => {
    const pages = ['', '', '', '第四页有字', '', '第六页']
    const r = nearbyNonEmptyText(pages, 0)
    expect(r).not.toBeNull()
    expect(r!.text).toContain('第四页有字')
    expect(r!.pages[0]).toBe(3) // 优先取左侧最近的 3 而非右侧 5
  })

  it('整本全空返回 null', () => {
    expect(nearbyNonEmptyText(['', '', ''], 1)).toBeNull()
  })

  it('maxPages 限制并入页数', () => {
    const pages = ['一', '二', '三', '四', '五', '六']
    const r = nearbyNonEmptyText(pages, 3, 2)
    expect(r!.pages.length).toBeGreaterThanOrEqual(1)
    expect(r!.pages.length).toBeLessThanOrEqual(2)
  })

  it('冗长文本被截断到预算内', () => {
    const long = '长'.repeat(3000)
    const pages = [long, long]
    const r = nearbyNonEmptyText(pages, 0, 2)
    expect(r!.text.length).toBeLessThan(2100)
  })

  it('越界中心索引安全收敛', () => {
    expect(nearbyNonEmptyText(['内容'], 999)).not.toBeNull()
    expect(nearbyNonEmptyText(['内容'], -5)).not.toBeNull()
  })
})