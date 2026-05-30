import { useState, useEffect } from 'react'
import { C, ProgressBar, mono } from './UI'
import api from '../lib/api'

const HORIZONS = [
  { id:'scalping', label:'Scalping', sub:'5m chart',  color:C.red,    icon:'⚡' },
  { id:'day',      label:'Day',      sub:'1h chart',  color:C.yellow, icon:'☀️' },
  { id:'swing',    label:'Swing',    sub:'1d chart',  color:C.accent, icon:'🌊' },
  { id:'position', label:'Position', sub:'1wk chart', color:C.green,  icon:'🏔️' },
]
const SYMBOLS   = ['SPY','QQQ','AAPL','MSFT','NVDA','TSLA','META','AMZN','GLD','TLT','BTC-USD','ETH-USD']
const AGENT_IDS = ['MOM','MRV','PPO','DQN','MAC','SEN','VOL','REG','OPT']

export function OrderModal({ isOpen, onClose, prefill, agents = [], onExecuted }) {
  const [form, setForm] = useState({
    symbol:'SPY', side:'BUY', quantity:1, agent_abbr:'MOM',
    order_type:'MARKET', limit_price:'', horizon:'swing',
    confidence:0.7, reason:'',
  })
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState(null)
  const [signal,     setSignal]     = useState(null)
  const [recommended,setRecommended]= useState([])
  const [livePrice,  setLivePrice]  = useState(null)

  useEffect(() => {
    if (!prefill) return
    setForm(f => ({
      ...f,
      symbol:      prefill.symbol      || f.symbol,
      side:        prefill.action      || f.side,
      quantity:    prefill.quantity    || f.quantity,
      agent_abbr:  prefill.agent_abbr  || f.agent_abbr,
      horizon:     prefill.horizon     || f.horizon,
      order_type:  prefill.order_type  || f.order_type,
      confidence:  prefill.confidence  || 0.7,
      reason:      prefill.reasoning   || '',
    }))
    setResult(null); setSignal(null)
  }, [prefill])

  useEffect(() => {
    if (!isOpen || !form.symbol) return
    api.quote(form.symbol).then(d => d?.price > 0 && setLivePrice(d))
  }, [form.symbol, isOpen])

  useEffect(() => {
    api.horizons(form.horizon).then(d => d?.recommended_agents && setRecommended(d.recommended_agents))
  }, [form.horizon])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const getSignal = async () => {
    setSignal(null)
    const r = await api.runAgent(form.agent_abbr, { symbol: form.symbol, horizon: form.horizon })
    if (r) {
      setSignal(r)
      if (r.action && r.action !== 'HOLD') set('side', r.action)
    }
  }

  const submit = async () => {
    setLoading(true); setResult(null)
    const r = await api.executeTrade({
      symbol: form.symbol, side: form.side, quantity: Number(form.quantity),
      agent_abbr: form.agent_abbr, order_type: form.order_type,
      limit_price: form.limit_price ? Number(form.limit_price) : null,
      horizon: form.horizon, confidence: Number(form.confidence), reason: form.reason,
    })
    if (r?.id) { setResult({ ...r, ok: true }); onExecuted?.(r) }
    else setResult({ ok: false, error: r?.detail || 'Trade failed' })
    setLoading(false)
  }

  if (!isOpen) return null

  const hCfg     = HORIZONS.find(h => h.id === form.horizon) || HORIZONS[2]
  const price    = livePrice?.price || 0
  const notional = price * Number(form.quantity || 0)

  return (
    <div style={{ position:'fixed', inset:0, background:'#000000bb', zIndex:1000,
                  display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'#0f1829', border:`1px solid ${C.border}`, borderRadius:14,
                    width:'100%', maxWidth:680, maxHeight:'92vh', overflowY:'auto', padding:28 }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div>
            <h2 style={{ fontSize:17, fontWeight:800, margin:0 }}>⚡ Execute Paper Trade</h2>
            <p style={{ fontSize:11, color:C.muted, margin:'2px 0 0' }}>Real price · Slippage + fees applied</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, fontSize:20, cursor:'pointer' }}>✕</button>
        </div>

        {/* Horizon selector */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:8, textTransform:'uppercase', letterSpacing:1 }}>Time Horizon</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:7 }}>
            {HORIZONS.map(h => (
              <button key={h.id} onClick={() => set('horizon', h.id)}
                style={{ padding:'9px 6px', borderRadius:9, cursor:'pointer', textAlign:'left',
                         background: form.horizon===h.id ? `${h.color}18` : C.surface,
                         border:`1px solid ${form.horizon===h.id ? `${h.color}66` : C.border}` }}>
                <div style={{ fontSize:15, marginBottom:2 }}>{h.icon}</div>
                <div style={{ fontSize:11, fontWeight:700, color: form.horizon===h.id ? h.color : C.text }}>{h.label}</div>
                <div style={{ fontSize:9, color:C.muted, marginTop:1 }}>{h.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {recommended.length > 0 && (
          <div style={{ marginBottom:14, padding:'7px 12px', borderRadius:7,
                        background:`${hCfg.color}10`, border:`1px solid ${hCfg.color}33`, fontSize:10 }}>
            <span style={{ color:C.muted }}>Best agents for {form.horizon}: </span>
            <span style={{ color:hCfg.color, ...mono }}>{recommended.join(' · ')}</span>
          </div>
        )}

        {/* Two-column form */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
          {/* Left */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {/* Symbol */}
            <div>
              <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Symbol</div>
              <div style={{ display:'flex', gap:6 }}>
                <input value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())}
                  style={{ flex:1, background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                           color:C.text, padding:'8px 11px', fontSize:13, fontWeight:700, outline:'none', ...mono }}/>
                <select value={form.symbol} onChange={e => set('symbol', e.target.value)}
                  style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                           color:C.muted, padding:'0 7px', fontSize:11, outline:'none' }}>
                  {SYMBOLS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              {livePrice && (
                <div style={{ marginTop:4, fontSize:11, color:C.muted }}>
                  Live: <span style={{ color:C.text, ...mono, fontWeight:700 }}>${livePrice.price?.toFixed(2)}</span>
                  <span style={{ color: livePrice.change_pct>=0 ? C.green : C.red, ...mono }}>
                    {' '}{livePrice.change_pct>=0?'+':''}{livePrice.change_pct?.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>

            {/* Side */}
            <div>
              <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Side</div>
              <div style={{ display:'flex', gap:5 }}>
                {['BUY','SELL','HOLD'].map(s => (
                  <button key={s} onClick={() => set('side', s)} style={{
                    flex:1, padding:'8px 0', borderRadius:7, fontWeight:700, fontSize:11, cursor:'pointer',
                    background: form.side===s ? `${s==='BUY'?C.green:s==='SELL'?C.red:C.muted}22` : C.surface,
                    border: `1px solid ${form.side===s ? `${s==='BUY'?C.green:s==='SELL'?C.red:C.muted}66` : C.border}`,
                    color: form.side===s ? (s==='BUY'?C.green:s==='SELL'?C.red:C.muted) : C.muted,
                  }}>{s}</button>
                ))}
              </div>
            </div>

            {/* Quantity */}
            <div>
              <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Quantity</div>
              <input type="number" value={form.quantity} onChange={e => set('quantity', e.target.value)} min="0.001"
                style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                         color:C.text, padding:'8px 11px', fontSize:13, outline:'none', ...mono }}/>
            </div>

            {/* Order type */}
            <div>
              <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Order Type</div>
              <div style={{ display:'flex', gap:5 }}>
                {['MARKET','LIMIT','STOP'].map(t => (
                  <button key={t} onClick={() => set('order_type', t)} style={{
                    flex:1, padding:'7px 0', borderRadius:7, fontSize:10, fontWeight:600, cursor:'pointer',
                    background: form.order_type===t ? `${C.accent}22` : C.surface,
                    border: `1px solid ${form.order_type===t ? `${C.accent}66` : C.border}`,
                    color: form.order_type===t ? C.accent : C.muted,
                  }}>{t}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Right */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {/* Agent picker */}
            <div>
              <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Agent</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4 }}>
                {AGENT_IDS.map(abbr => {
                  const a      = agents.find(x => x.abbr === abbr)
                  const isRec  = recommended.includes(abbr)
                  const active = form.agent_abbr === abbr
                  return (
                    <button key={abbr} onClick={() => set('agent_abbr', abbr)}
                      style={{ padding:'6px 4px', borderRadius:6, cursor:'pointer', position:'relative',
                               background: active ? `${a?.color||C.accent}22` : C.surface,
                               border:`1px solid ${active?`${a?.color||C.accent}66`:isRec?`${C.yellow}44`:C.border}` }}>
                      <div style={{ fontSize:13 }}>{a?.icon||'🤖'}</div>
                      <div style={{ fontSize:9, color: active?(a?.color||C.accent):C.muted, ...mono, fontWeight:700 }}>{abbr}</div>
                      {isRec && <div style={{ position:'absolute', top:2, right:2, width:4, height:4,
                                              borderRadius:99, background:C.yellow }}/>}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Confidence slider */}
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:.8 }}>Confidence</span>
                <span style={{ fontSize:10, color:C.accent, ...mono }}>{Math.round(form.confidence*100)}%</span>
              </div>
              <input type="range" min="0.1" max="1" step="0.05" value={form.confidence}
                onChange={e => set('confidence', parseFloat(e.target.value))}
                style={{ width:'100%', accentColor:C.accent }}/>
            </div>

            {/* Notes */}
            <div>
              <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Notes</div>
              <textarea value={form.reason} onChange={e => set('reason', e.target.value)} rows={2}
                placeholder="Optional…"
                style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                         color:C.text, padding:'8px 11px', fontSize:11, outline:'none', resize:'none' }}/>
            </div>

            {/* Order preview */}
            <div style={{ background:C.bg, borderRadius:7, padding:11, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:7, textTransform:'uppercase', letterSpacing:.8 }}>Preview</div>
              {[['Price',`$${price.toFixed(2)}`],['Notional',`$${notional.toFixed(2)}`],
                ['Fee',`$${(notional*0.001).toFixed(2)}`],['Total',`$${(notional*1.001).toFixed(2)}`]
              ].map(([l,v]) => (
                <div key={l} style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontSize:11, color:C.muted }}>{l}</span>
                  <span style={{ fontSize:11, color:C.text, ...mono, fontWeight:700 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Get signal */}
        <button onClick={getSignal} style={{ width:'100%', padding:'8px 0', marginBottom:10, borderRadius:7,
          cursor:'pointer', background:`${C.purple}18`, border:`1px solid ${C.purple}44`,
          color:C.purple, fontSize:12, fontWeight:600 }}>
          🧠 Get {form.agent_abbr} Signal for {form.symbol} ({form.horizon})
        </button>

        {signal && (
          <div style={{ marginBottom:12, padding:'9px 14px', borderRadius:7,
            background:`${signal.action==='BUY'?C.green:signal.action==='SELL'?C.red:C.muted}15`,
            border:`1px solid ${signal.action==='BUY'?C.green:signal.action==='SELL'?C.red:C.muted}44` }}>
            <span style={{ fontSize:14, fontWeight:800, color:signal.action==='BUY'?C.green:signal.action==='SELL'?C.red:C.muted, ...mono }}>
              {signal.action}
            </span>
            <span style={{ fontSize:11, color:C.muted, marginLeft:14 }}>
              Confidence: <span style={{ color:C.text, ...mono }}>{Math.round((signal.confidence||0)*100)}%</span>
            </span>
          </div>
        )}

        {/* Execute / result */}
        {!result ? (
          <button onClick={submit} disabled={loading} style={{
            width:'100%', padding:'12px 0', borderRadius:9, fontSize:14, fontWeight:800,
            cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
            background: form.side==='BUY' ? `${C.green}22` : form.side==='SELL' ? `${C.red}22` : C.surface,
            border:`2px solid ${form.side==='BUY'?`${C.green}66`:form.side==='SELL'?`${C.red}66`:C.border}`,
            color: form.side==='BUY' ? C.green : form.side==='SELL' ? C.red : C.muted,
          }}>
            {loading ? '⏳ Executing…' : `⚡ ${form.side} ${form.quantity} × ${form.symbol}`}
          </button>
        ) : (
          <div style={{ padding:'14px 16px', borderRadius:9,
            background: result.ok ? `${C.green}18` : `${C.red}18`,
            border:`1px solid ${result.ok?C.green:C.red}44` }}>
            {result.ok ? (
              <>
                <div style={{ fontSize:13, fontWeight:700, color:C.green, marginBottom:8 }}>✅ Trade Executed</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, fontSize:11 }}>
                  {[['Fill Price',`$${result.price?.toFixed(2)}`],['Notional',`$${result.notional?.toFixed(2)}`],
                    ['Fee',`$${result.fee?.toFixed(4)}`],['Agent',result.agent_abbr]].map(([l,v]) => (
                    <div key={l}><span style={{ color:C.muted }}>{l}: </span>
                      <span style={{ color:C.text, ...mono, fontWeight:700 }}>{v}</span></div>
                  ))}
                </div>
                <button onClick={() => { setResult(null); onClose() }}
                  style={{ marginTop:10, padding:'6px 14px', borderRadius:6, cursor:'pointer',
                           background:`${C.green}22`, border:`1px solid ${C.green}44`,
                           color:C.green, fontSize:11, fontWeight:700 }}>Close</button>
              </>
            ) : (
              <div style={{ fontSize:12, color:C.red }}>❌ {result.error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
