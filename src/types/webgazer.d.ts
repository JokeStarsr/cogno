/** WebGazer.js 全局声明（通过 /vendor/webgazer.js 脚本加载） */
export {}

declare global {
  interface Window {
    webgazer?: {
      setRegression(mode: 'ridge' | 'weightedRidge' | 'linear'): unknown
      setGazeListener(
        cb: (data: { x: number; y: number } | null, elapsedTime: number) => void
      ): unknown
      setTracker(mode: string): unknown
      showVideo(show: boolean): unknown
      showFaceOverlay(show: boolean): unknown
      showFaceFeedbackBox(show: boolean): unknown
      showPredictionPoints(show: boolean): unknown
      applyKalmanFilter(apply: boolean): unknown
      begin(): Promise<unknown>
      end(): void
      freeze(): unknown
      unfreeze(): unknown
      clearData(): unknown
      isLoaded(): boolean
      readyState: number
    }
  }
}
