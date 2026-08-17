import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BehavioralSignalTracker } from '../behavioralSignals'

describe('BehavioralSignalTracker', () => {
  let t: BehavioralSignalTracker
  beforeEach(() => {
    t = new BehavioralSignalTracker()
    t.attach()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => {
    t.detach()
    vi.useRealTimers()
  })

  it('复制事件计入快照，拉取后重置', () => {
    document.dispatchEvent(new Event('copy'))
    document.dispatchEvent(new Event('copy'))
    const snap = t.getSnapshot()
    expect(snap.copyCount).toBe(2)
    // 二次拉取：累计已重置
    expect(t.getSnapshot().copyCount).toBe(0)
  })

  it('空白选择不计为选中（选空的点击事件不污染信号）', () => {
    // jsdom 中 window.getSelection() 默认返回 null → len 0 < 2，不计
    document.dispatchEvent(new Event('selectionchange'))
    expect(t.getSnapshot().selectionCount).toBe(0)
  })

  it('鼠标采样不足(<10)时占比为 null（数据不可信）', () => {
    document.dispatchEvent(new MouseEvent('mousemove'))
    expect(t.getSnapshot().mouseInAreaRatio).toBeNull()
  })

  it('绑定阅读区后，区内鼠标采样会计入占比', () => {
    const el = document.createElement('div')
    t.attachReadingArea(el)
    // tracker 的 mousemove 监听在 window 上（浏览器冒泡到 window 更稳）
    for (let i = 0; i < 15; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }))
    }
    const snap = t.getSnapshot()
    expect(snap.mouseInAreaRatio).not.toBeNull()
    expect(snap.mouseInAreaRatio).toBeGreaterThan(0)
  })
})