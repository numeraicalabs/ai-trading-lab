import { useState, useRef, useEffect } from 'react'
import { C, mono } from '../shared'
import api from '../../lib/api'

const SUGGESTIONS = [
  "Buy 5 shares of NVDA with momentum strategy",
  "Sell TSLA using sentiment agent for swing trade",
  "What's the best agent for day trading Bitcoin?",
  "Show me the ensemble signal",
  "Long SPY position trade, 10 shares",
  "Short QQQ scalping strategy",
]

export function OllamaChat({ onOrderSuggested, portfolio, agents }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '⚡ Hi! I\'m your AI trading assistant. Ask me to execute trades, analyze agents, or explain strategies.\n\nTry: "Buy 5 shares of NVDA with momentum strategy"' }
  ])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [ollamaStatus, setOllamaStatus] = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    api.fetch('/api/ollama/status').then(d => d && setOllamaStatus(d))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (text) => {
    if (!text.trim()) return
    const userMsg = { role: 'user', content: text }
    setMessages(m => [...m, userMsg])
    setInput('')
    setLoading(true)

    try {
      const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_history: history }),
      }).then(r => r.json())

      const assistantMsg = {
        role: 'assistant',
        content: res.response || '[No response]',
        suggested_order: res.suggested_order,
      }
      setMessages(m => [...m, assistantMsg])

      if (res.suggested_order && res.suggested_order.action !== 'HOLD') {
        onOrderSuggested?.(res.suggested_order)
      }
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: '⚠️ Backend not reachable. Run the FastAPI server first.' }])
    }
    setLoading(false)
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: 520,
      background: '#0d1525', borderRadius: 12, border: `1px solid ${C.border}`,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>🤖 AI Trading Assistant</span>
          <span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>powered by Ollama</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: 99, background: ollamaStatus?.available ? C.green : C.yellow }}/>
          <span style={{ fontSize: 10, color: C.muted }}>
            {ollamaStatus ? (ollamaStatus.available ? ollamaStatus.model : 'offline') : 'checking…'}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%', padding: '10px 14px', borderRadius: 10, fontSize: 12, lineHeight: 1.6,
              background: m.role === 'user' ? `${C.accent}33` : '#1a2540',
              border: `1px solid ${m.role === 'user' ? `${C.accent}44` : C.border}`,
              color: C.text,
              whiteSpace: 'pre-wrap',
            }}>
              {m.content}
              {m.suggested_order && m.suggested_order.action !== 'HOLD' && (
                <div style={{
                  marginTop: 10, padding: '8px 12px', borderRadius: 8,
                  background: `${C.green}15`, border: `1px solid ${C.green}44`,
                }}>
                  <div style={{ fontSize: 10, color: C.green, fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>
                    💡 SUGGESTED ORDER
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      ['Action', m.suggested_order.action, m.suggested_order.action === 'BUY' ? C.green : C.red],
                      ['Symbol', m.suggested_order.symbol, C.text],
                      ['Qty', m.suggested_order.quantity, C.text],
                      ['Horizon', m.suggested_order.horizon, C.cyan],
                      ['Agent', m.suggested_order.agent_abbr || 'auto', C.accent],
                    ].map(([l, v, c]) => (
                      <div key={l} style={{ fontSize: 10 }}>
                        <span style={{ color: C.muted }}>{l}: </span>
                        <span style={{ color: c, fontWeight: 700, fontFamily: 'monospace' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => onOrderSuggested?.(m.suggested_order)}
                    style={{
                      marginTop: 8, width: '100%', padding: '6px 0', borderRadius: 6,
                      background: `${C.green}22`, border: `1px solid ${C.green}44`,
                      color: C.green, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    ⚡ Execute this order
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '10px 14px', borderRadius: 10, background: '#1a2540', border: `1px solid ${C.border}`, fontSize: 12, color: C.muted }}>
              <span style={{ animation: 'pulse 1s infinite' }}>Thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div style={{ padding: '0 16px 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SUGGESTIONS.slice(0, 4).map((s, i) => (
            <button key={i} onClick={() => send(s)} style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer',
              background: `${C.accent}15`, border: `1px solid ${C.accent}33`, color: C.muted,
            }}>{s}</button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send(input)}
          placeholder='Type a trade order or question… (Enter to send)'
          style={{
            flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
            color: C.text, padding: '8px 12px', fontSize: 12, outline: 'none',
          }}
        />
        <button
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: input.trim() ? `${C.accent}22` : C.surface,
            border: `1px solid ${input.trim() ? `${C.accent}66` : C.border}`,
            color: input.trim() ? C.accent : C.muted,
            cursor: input.trim() ? 'pointer' : 'default',
          }}
        >Send</button>
      </div>
    </div>
  )
}
