import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Cogno 渲染错误:', error, info)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#f5f5f5' }}>
          <h2>页面出错了</h2>
          <p style={{ opacity: 0.75 }}>错误信息：{this.state.error.message}</p>
          <button
            onClick={this.reset}
            style={{
              marginTop: 12,
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid rgba(128,128,128,0.4)',
              background: 'none',
              color: '#f5f5f5',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}