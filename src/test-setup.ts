// vitest 全局测试基础设施
import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'

// IndexedDB 在 jsdom 中不存在，fake-indexeddb 已注入；
// 若被测模块 import dexie（storage.ts），这里保证 db 可正常初始化
beforeEach(() => {
  localStorage.clear()
})