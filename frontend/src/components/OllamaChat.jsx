import { useState, useRef, useEffect } from 'react'
import { C } from './UI'
import api from '../lib/api'

export function OllamaChat({ onOrderSuggested, portfolio, agents }) {
  const [msgs,    setMsgs]    = useState([{
    role: 'assistant',
    content: '⚡ Hi! I\'m your AI trading assistant powered by Ollama.\n\nTry: "Buy 5 shares of NVDA swing trade" or "What\'s the best agent right now?"',
  }])
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [status,  setStatus]  = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => { api.ollamaStatus().then(d => d && setStatus(d)) }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const send = async (text) => {
    if (!text.trim()) return
    setMsgs(m => [...m, { role: 'user', content: text }])
    setInput(''); setLoading(true)
    try {
      const history = msgs.slice(-6).map(m => ({ role: m.role, content: m.content }))
      const res     = await api.chat({ message: text, conversation_history: history })
      setMsgs(m => [...m, {
        role:            'assistant',
        content:         res?.response || '[No response]',
        suggested_order: res?.suggested_order,
      }])
      if (res?.suggested_order?.action && res.suggested_order.action !== 'HOLD')
        onOrderSuggested?.(res.suggested_order)
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: '⚠️ Backend not reachable. Start FastAPI first.' }])
    }
    setLoading(false)
  }

  const SUGGESTIONS = ['Buy 5 SPY swing trade','Sell 2 NVDA day','Bitcoin scalping long','Ensemble signal?']

  return (
    <div style={{ display:'flex', flexDirection:'column', height:520, background:'#0d1525',
                  borderRadius:12, border:`1px solid ${C.border}`, overflow:'hidden' }}>
      {/* Header */}
      <div style={{ padding:'12px 16px', borderBottom:`1px solid ${C.border}`, background:'#111d35',
                    display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:12, fontWeight:700, color:C.text }}>🤖 AI Trading Assistant</span>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <div style={{ width:6, height:6, borderRadius:99, background:status?.available?C.green:C.yellow }}/>
          <span style={{ fontSize:10, color:C.muted }}>
            {status ? (status.available ? status.model : 'offline — run: ollama serve') : 'checking…'}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex:1, overflowY:'auto', padding:'12px 14px', display:'flex', flexDirection:'column', gap:9 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display:'flex', justifyContent:m.role==='user'?'flex-end':'flex-start' }}>
            <div style={{
              maxWidth:'82%', padding:'9px 13px', borderRadius:10, fontSize:12,
              lineHeight:1.6, whiteSpace:'pre-wrap', color:C.text,
              background: m.role==='user' ? `${C.accent}33` : '#1a2540',
              border:`1px solid ${m.role==='user'?`${C.accent}44`:C.border}`,
            }}>
              {m.content}
              {m.suggested_order && m.suggested_order.action !== 'HOLD' && (
                <div style={{ marginTop:10, padding:'8px 11px', borderRadius:7,
                              background:`${C.green}15`, border:`1px solid ${C.green}44` }}>
                  <div style={{ fontSize:10, color:C.green, fontWeight:700, marginBottom:5, letterSpacing:1 }}>
                    💡 SUGGESTED ORDER
                  </div>
                  <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:8 }}>
                    {[['Action', m.suggested_order.action, m.suggested_order.action==='BUY'?C.green:C.red],
                      ['Symbol', m.suggested_order.symbol, C.text],
                      ['Qty',    m.suggested_order.quantity, C.text],
                      ['Horizon',m.suggested_order.horizon, C.cyan],
                      ['Agent',  m.suggested_order.agent_abbr||'auto', C.accent],
                    ].map(([l,v,c]) => (
                      <div key={l} style={{ fontSize:10 }}>
                        <span style={{ color:C.muted }}>{l}: </span>
                        <span style={{ color:c, fontWeight:700, ...{ fontFamily:'monospace' } }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => onOrderSuggested?.(m.suggested_order)}
                    style={{ width:'100%', padding:'5px 0', borderRadius:6, cursor:'pointer',
                             background:`${C.green}22`, border:`1px solid ${C.green}44`,
                             color:C.green, fontSize:11, fontWeight:700 }}>⚡ Execute</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display:'flex', justifyContent:'flex-start' }}>
            <div style={{ padding:'9px 13px', borderRadius:10, background:'#1a2540',
                          border:`1px solid ${C.border}`, fontSize:12, color:C.muted }}>Thinking…</div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Quick suggestions (only on first visit) */}
      {msgs.length <= 1 && (
        <div style={{ padding:'0 14px 8px', display:'flex', flexWrap:'wrap', gap:5 }}>
          {SUGGESTIONS.map((s, i) => (
            <button key={i} onClick={() => send(s)} style={{ padding:'3px 9px', borderRadius:20,
              fontSize:10, cursor:'pointer', background:`${C.accent}15`,
              border:`1px solid ${C.accent}33`, color:C.muted }}>{s}</button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding:'9px 12px', borderTop:`1px solid ${C.border}`, display:'flex', gap:7 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key==='Enter' && !e.shiftKey && send(input)}
          placeholder="Type a trade order or question… (Enter)"
          style={{ flex:1, background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                   color:C.text, padding:'7px 11px', fontSize:12, outline:'none' }}/>
        <button onClick={() => send(input)} disabled={loading || !input.trim()} style={{
          padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:700,
          background: input.trim() ? `${C.accent}22` : C.surface,
          border:`1px solid ${input.trim()?`${C.accent}66`:C.border}`,
          color: input.trim() ? C.accent : C.muted,
          cursor: input.trim() ? 'pointer' : 'default',
        }}>Send</button>
      </div>
    </div>
  )
}
