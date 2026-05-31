import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('React ErrorBoundary caught:', error, info)
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div style={{
        minHeight: '100vh', background: '#050911',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{
          background: '#111c30', border: '1px solid #ef444444',
          borderRadius: 14, padding: 32, maxWidth: 600, width: '100%',
          boxShadow: '0 0 40px rgba(239,68,68,.15)',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>💥</div>
          <h2 style={{ color: '#ef4444', fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
            App Error
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
            React encountered an error. The message below helps diagnose the problem.
          </p>

          {/* Error message */}
          <div style={{
            background: '#0a0e17', border: '1px solid #ef444422',
            borderRadius: 8, padding: '12px 16px', marginBottom: 12,
            fontFamily: 'monospace', fontSize: 12, color: '#ef4444',
          }}>
            {error.toString()}
          </div>

          {/* Stack (collapsed) */}
          {info?.componentStack && (
            <details style={{ marginBottom: 16 }}>
              <summary style={{ color: '#64748b', fontSize: 11, cursor: 'pointer', marginBottom: 6 }}>
                Component stack
              </summary>
              <pre style={{
                background: '#0a0e17', borderRadius: 6, padding: 10,
                fontSize: 10, color: '#475569', overflow: 'auto',
                maxHeight: 200, lineHeight: 1.5, margin: 0,
              }}>
                {info.componentStack}
              </pre>
            </details>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => this.setState({ error: null, info: null })}
              style={{
                padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 700, border: 'none', color: 'white',
                background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
              }}
            >
              ↺ Try again
            </button>
            <button
              onClick={() => window.location.replace('/')}
              style={{
                padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, background: '#1e3050',
                border: '1px solid #243a5e', color: '#94a3b8',
              }}
            >
              ⟳ Reload app
            </button>
          </div>
        </div>
      </div>
    )
  }
}
