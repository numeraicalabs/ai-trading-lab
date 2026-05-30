import { useState, useEffect } from 'react'
import { C } from './UI'
import api from '../lib/api'

const PAGE_LABEL = {
  dashboard:'Portfolio', agents:'AI Agents', ecosystem:'Ecosystem',
  analytics:'Analytics', trades:'Trades',    network:'Network', chat:'Chat',
}
const QUICK = ['Best agent now?', 'Biggest risk?', 'What to improve?', 'Market outlook']

export function AiInsightsPanel({ page, portfolio, agents }) {
  const [open,     setOpen]     = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [history,  setHistory]  = useState([])
  const [question, setQuestion] = useState('')

  // Reset on page change
  useEffect(() => { setHistory([]) }, [page])

  const ask = async (q = '') => {
    setLoading(true)
    const res = await api.summarize({ page, data: { portfolio, agent_count: agents?.length }, question: q })
    const ans = res?.summary || '⚠️ Ollama not running — run: ollama serve && ollama pull llama3'
    setHistory(h => [{ q: q || `Summarize ${PAGE_LABEL[page]||page}`, a: ans }, ...h].slice(0, 8))
    setLoading(false)
  }

  const send = () => { if (!question.trim()) return; ask(question); setQuestion('') }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => { setOpen(o => !o); if (!open && !history.length) ask() }}
        title="AI Page Insights"
        style={{
          position:'fixed', bottom:24, right:24, zIndex:300,
          width:48, height:48, borderRadius:'50%',
          background:`linear-gradient(135deg,${C.accent},${C.purple})`,
          border:'none', cursor:'pointer', fontSize:20,
          boxShadow:`0 4px 20px ${C.accent}55`,
          display:'flex', alignItems:'center', justifyContent:'center',
          transition:'transform .2s',
          transform: open ? 'rotate(45deg) scale(1.1)' : 'scale(1)',
        }}
      >
        {open ? '✕' : '🤖'}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position:'fixed', bottom:84, right:24, width:370, maxHeight:500,
          background:'#0d1525', border:`1px solid ${C.border}`, borderRadius:14,
          zIndex:299, boxShadow:'0 12px 48px #000c',
          display:'flex', flexDirection:'column', overflow:'hidden',
        }}>
          {/* Header */}
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}`, background:'#111d35',
                        display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <span style={{ fontSize:12, fontWeight:700, color:C.text }}>🤖 AI Insights</span>
              <span style={{ fontSize:10, color:C.muted, marginLeft:8 }}>{PAGE_LABEL[page]||page}</span>
            </div>
            <button onClick={() => ask()} disabled={loading}
              style={{ fontSize:10, background:`${C.accent}22`, border:`1px solid ${C.accent}44`,
                       borderRadius:5, padding:'3px 8px', color:C.accent, cursor:'pointer' }}>
              {loading ? '…' : '↺ Refresh'}
            </button>
          </div>

          {/* Conversation */}
          <div style={{ flex:1, overflowY:'auto', padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>
            {loading && !history.length && (
              <div style={{ textAlign:'center', color:C.muted, padding:'20px 0', fontSize:12 }}>
                Analyzing {PAGE_LABEL[page]}…
              </div>
            )}
            {history.map((h, i) => (
              <div key={i}>
                {h.q && h.q !== `Summarize ${PAGE_LABEL[page]||page}` && (
                  <div style={{ fontSize:11, color:C.accent, marginBottom:3, fontStyle:'italic' }}>❓ {h.q}</div>
                )}
                <div style={{ fontSize:12, color:C.muted, lineHeight:1.7,
                              background:'#1a2540', borderRadius:7, padding:'9px 11px',
                              whiteSpace:'pre-wrap' }}>{h.a}</div>
              </div>
            ))}
          </div>

          {/* Quick prompts */}
          <div style={{ padding:'7px 12px', display:'flex', gap:5, flexWrap:'wrap',
                        borderTop:`1px solid ${C.border}11` }}>
            {QUICK.map(q => (
              <button key={q} onClick={() => ask(q)} style={{ padding:'3px 9px', borderRadius:20,
                fontSize:10, cursor:'pointer', background:`${C.accent}15`,
                border:`1px solid ${C.accent}33`, color:C.muted }}>{q}</button>
            ))}
          </div>

          {/* Input */}
          <div style={{ padding:'9px 12px', borderTop:`1px solid ${C.border}`, display:'flex', gap:7 }}>
            <input value={question} onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key==='Enter' && send()}
              placeholder="Ask about this page…"
              style={{ flex:1, background:'#0a0e17', border:`1px solid ${C.border}`, borderRadius:7,
                       color:C.text, padding:'7px 10px', fontSize:11, outline:'none' }}/>
            <button onClick={send} disabled={!question.trim() || loading} style={{
              padding:'7px 11px', borderRadius:7, fontSize:11, fontWeight:700,
              background: question.trim() ? `${C.accent}22` : C.surface,
              border:`1px solid ${question.trim()?`${C.accent}66`:C.border}`,
              color: question.trim() ? C.accent : C.muted,
              cursor: question.trim() ? 'pointer' : 'default',
            }}>Ask</button>
          </div>
        </div>
      )}
    </>
  )
}
