/** .docx → 纯文本（浏览器端 jszip 解压，适合扫描 PDF 转 Word 后直接阅读） */
export async function extractDocxText(file: File): Promise<string> {
  const { default: mammoth } = await import('mammoth/mammoth.browser')
  const arrayBuffer = await file.arrayBuffer()
  const { value } = await mammoth.extractRawText({ arrayBuffer })
  return value
}