/**
 * PDF 逐页文本的上下文选取工具。
 * 页面文本可能因抽取未完成/OCR 排队而部分为空：
 * nearbyNonEmptyText 从"当前页"交替向左右寻找已识别页，确保代理始终能拿到最近的正文。
 */

export interface NearbyText {
  text: string
  /** 并入文本的已成页（0 基，升序） */
  pages: number[]
}

/**
 * 在 pages 中就近收集已识别文本。
 * @param centerIdx 当前所在页（可为任意值，内部收敛到合法范围）
 * @param maxPages 最多并入的页数（保证上下文不膨胀）
 * @returns null 表示整本都还没有任何已识别文本
 */
export function nearbyNonEmptyText(pages: string[], centerIdx: number, maxPages = 3): NearbyText | null {
  const n = pages.length
  if (!n) return null
  const center = Math.max(0, Math.min(n - 1, Math.floor(centerIdx) || 0))

  const picked: number[] = []
  const visit = (i: number) => {
    if (i >= 0 && i < n && pages[i] && pages[i].trim()) picked.push(i)
  }
  // 交替向左右扩展：当前页 → 前页 → 后页 → 前 2 页 → 后 2 页 …
  visit(center)
  for (let r = 1; r <= n && picked.length < maxPages; r++) {
    if (picked.length >= maxPages) break
    visit(center - r)
    if (picked.length < maxPages) visit(center + r)
  }
  if (!picked.length) return null
  picked.sort((a, b) => a - b)

  // 上下文最多保留 2000 字符，避免长文本书中一次喂太多
  let text = ''
  for (const i of picked) {
    const seg = pages[i].trim()
    if (!seg) continue
    if (text.length + seg.length > 2000) {
      // 丢弃超出预算的中段，保留开头与结尾附近
      text = (text.slice(0, 1800) + '\n…' + seg.slice(0, 200)).trim()
      break
    }
    text = text ? `${text}\n${seg}` : seg
  }
  return { text, pages: picked }
}