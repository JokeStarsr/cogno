import type { GazePoint } from '../types'

export type TrackingMode = 'webgazer' | 'mouse' | 'off'

export interface TrackingController {
  mode: TrackingMode
  /** 相机可用性 */
  cameraSupported: boolean
  startCamera: () => Promise<void>
  stop: () => void
  clearCalibration: () => void
  /** 切换鼠标代理（无相机降级方案） */
  setMouseProxy: (enabled: boolean) => void
}

type Handler = (g: GazePoint) => void

let handlers = new Set<Handler>()
let currentMode: TrackingMode = 'off'
let rAFId = 0
let lastGaze: { x: number; y: number } | null = null
let mouseX = 0
let mouseY = 0

function emit(g: GazePoint) {
  handlers.forEach((h) => h(g))
}

function wg() {
  return window.webgazer
}

export function isWebgazerLoaded(): boolean {
  return typeof wg() !== 'undefined'
}

let scriptPromise: Promise<void> | null = null
/** 懒加载本地 webgazer.js（public/vendor），避免首屏阻塞 */
export function loadWebgazerScript(): Promise<void> {
  if (isWebgazerLoaded()) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = '/vendor/webgazer.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('webgazer.js 加载失败'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

export function isCameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function subscribe(cb: Handler): () => void {
  handlers.add(cb)
  return () => handlers.delete(cb)
}

async function startWebgazer(): Promise<void> {
  const w = wg()
  if (!w) throw new Error('webgazer 未加载')
  await w.begin()
  w.showVideo(false)
  w.showFaceOverlay(false)
  w.showFaceFeedbackBox(false)
  w.showPredictionPoints(false)
  w.applyKalmanFilter(true)
  w.setGazeListener((data) => {
    if (data) {
      lastGaze = data
      currentMode = 'webgazer'
      emit({ x: data.x, y: data.y, ts: Date.now() })
    }
  })
}

function startMouseProxy() {
  currentMode = 'mouse'
  window.addEventListener('mousemove', onMouseMove, { passive: true })
}

function onMouseMove(e: MouseEvent) {
  mouseX = e.clientX
  mouseY = e.clientY
  lastGaze = { x: mouseX, y: mouseY }
  emit({ x: mouseX, y: mouseY, ts: Date.now() })
}

export function createTrackingController(): TrackingController {
  const controller: TrackingController = {
    mode: currentMode,
    cameraSupported: isCameraSupported(),
    async startCamera() {
      if (!isCameraSupported()) throw new Error('当前浏览器不支持摄像头')
      await loadWebgazerScript()
      await startWebgazer()
      currentMode = 'webgazer'
      controller.mode = 'webgazer'
    },
    stop() {
      const w = wg()
      if (w) w.end()
      window.removeEventListener('mousemove', onMouseMove)
      cancelAnimationFrame(rAFId)
      lastGaze = null
      currentMode = 'off'
      controller.mode = 'off'
    },
    clearCalibration() {
      const w = wg()
      if (w) w.clearData()
    },
    setMouseProxy(enabled) {
      if (enabled) {
        startMouseProxy()
        currentMode = 'mouse'
        controller.mode = 'mouse'
      } else {
        window.removeEventListener('mousemove', onMouseMove)
      }
    },
  }
  return controller
}

/** 降级探测：WebGazer 在部分机器上 init 失败，统一走鼠标代理 */
export function webgazerHealthy(): boolean {
  return currentMode === 'webgazer' && lastGaze !== null
}
