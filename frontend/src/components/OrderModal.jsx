/**
 * OrderModal v2 — 4-step wizard con structured memo obbligatorio.
 * Step 1: Ordine (symbol/side/qty/agent/horizon)
 * Step 2: Memo  (thesis, signal source, stop/tp, tags)
 * Step 3: Review (pre-trade checks AI-powered)
 * Step 4: Done
 */
import { useState, useEffect } from 'react'
import { C, ProgressBar, Badge } from './UI'
import api from '../lib/api'

const HORIZONS = [
  { id:'scalping', label:'Scalping', sub:'5m',  color:C.red,    icon:'⚡' },
  { id:'day',      label:'Day',      sub:'1h',  color:C.yellow, icon:'☀️' },
  { id:'swing',    label:'Swing',    sub:'1d',  color:C.accent, icon:'🌊' },
  { id:'position', label:'Position', sub:'1wk', color:C.green,  icon:'🏔' },
]
const SYMBOLS      = ['SPY','QQQ','AAPL','MSFT','NVDA','TSLA','META','AMZN','GLD','TLT','BTC-USD','ETH-USD']
const AGENT_IDS    = ['MOM','MRV','PPO','DQN','MAC','SEN','VOL','REG','OPT']
const RISK_LEVELS  = [
  { id:'LOW',    color:C.green,  icon:'🟢' },
  { id:'MEDIUM', color:C.yellow, icon:'🟡' },
  { id:'HIGH',   color:C.red,    icon:'🔴' },
]
const PRESET_TAGS  = ['momentum','breakout','reversal','macro','earnings','sentiment',
                      'volatility','regime','hedging','scalp','swing','value']
const AGENT_COLORS = {
  MOM:C.cyan, MRV:C.purple, PPO:C.accent, DQN:'#ec4899', MAC:C.yellow,
  SEN:'#f97316', VOL:C.red, REG:'#14b8a6', OPT:C.green, SCOUT:'#f0abfc',
}
const mono = { fontFamily:"'JetBrains Mono','Fira Code',monospace" }

function memoScore(memo, reason) {
  let s = 0
  if ((memo.thesis || reason).length > 10)  s += 30
  if (memo.signal_source.length > 0)         s += 20
  if (memo.market_context.length > 0)        s += 20
  if (memo.tags.length > 0)                  s += 15
  if (memo.stop_loss_price)                  s += 10
  if (memo.take_profit_price)                s += 5
  return s
}

function ScoreRing({ score }) {
  const c    = score >= 80 ? C.green : score >= 50 ? C.yellow : C.red
  const r    = 20
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  return (
    <div style={{ position:'relative', width:50, height:50, flexShrink:0 }}>
      <svg viewBox="0 0 50 50" style={{ transform:'rotate(-90deg)' }}>
        <circle cx="25" cy="25" r={r} fill="none" stroke={C.border} strokeWidth="4"/>
        <circle cx="25" cy="25" r={r} fill="none" stroke={c} strokeWidth="4"
                strokeDasharray={dash + ' ' + circ} strokeLinecap="round"
                style={{ transition:'stroke-dasharray .4s ease' }}/>
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <span style={{ fontSize:12, fontWeight:800, color:c }}>{score}</span>
      </div>
    </div>
  )
}

function Check({ type, title, detail }) {
  const col = type === 'error' ? C.red : type === 'warning' ? C.yellow : C.green
  const icon = type === 'error' ? '🚫' : type === 'warning' ? '⚠️' : '✅'
  return (
    <div style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'7px 10px',
                  borderRadius:7, fontSize:11, marginBottom:5,
                  background: col + '0e', border: '1px solid ' + col + '33' }}>
      <span style={{ flexShrink:0 }}>{icon}</span>
      <div>
        <div style={{ fontWeight:700, color:col }}>{title}</div>
        <div style={{ color:C.muted, marginTop:2 }}>{detail}</div>
      </div>
    </div>
  )
}

function StepDot({ n, label, active, done }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <div style={{ width:24, height:24, borderRadius:'50%', fontSize:11, fontWeight:700,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    background: done ? C.green : active ? C.accent : C.surface,
                    border: '1px solid ' + (done ? C.green : active ? C.accent : C.border),
                    color: done || active ? 'white' : C.muted }}>
        {done ? '✓' : n}
      </div>
      <span style={{ fontSize:11, color: active ? C.text : C.muted }}>{label}</span>
    </div>
  )
}

export function OrderModal({ isOpen, onClose, prefill, agents = [], onExecuted }) {
  const [step, setStep]       = useState('form')
  const [form, setForm]       = useState({
    symbol:'SPY', side:'BUY', quantity:1, agent_abbr:'MOM',
    order_type:'MARKET', limit_price:'', horizon:'swing', confidence:0.7, reason:'',
  })
  const [memo, setMemo]       = useState({
    signal_source:'', market_context:'', thesis:'',
    risk_level:'MEDIUM', stop_loss_price:'', take_profit_price:'', tags:[],
  })
  const [loading,      setLoading]      = useState(false)
  const [result,       setResult]       = useState(null)
  const [livePrice,    setLivePrice]    = useState(null)
  const [signal,       setSignal]       = useState(null)
  const [checks,       setChecks]       = useState([])
  const [recommended,  setRecommended]  = useState([])
  const [agentSignals, setAgentSignals] = useState({})

  useEffect(() => {
    if (!prefill) return
    setForm(f => ({
      ...f,
      symbol:     prefill.symbol      || f.symbol,
      side:       prefill.action      || f.side,
      quantity:   prefill.quantity    || f.quantity,
      agent_abbr: prefill.agent_abbr  || f.agent_abbr,
      horizon:    prefill.horizon     || f.horizon,
      order_type: prefill.order_type  || f.order_type,
      confidence: prefill.confidence  || 0.7,
      reason:     prefill.reasoning   || '',
    }))
    if (prefill.reasoning) setMemo(m => ({ ...m, thesis: prefill.reasoning }))
    setResult(null); setStep('form'); setChecks([])
  }, [prefill])

  useEffect(() => {
    if (!isOpen || !form.symbol) return
    api.quote(form.symbol).then(d => d && d.price > 0 && setLivePrice(d))
    api.horizons(form.horizon).then(d => d && d.recommended_agents && setRecommended(d.recommended_agents))
    api.signals().then(sigs => {
      if (!sigs) return
      const m = {}
      sigs.forEach(s => { if (s.agent_abbr) m[s.agent_abbr] = s })
      setAgentSignals(m)
    })
  }, [form.symbol, form.horizon, isOpen])

  const set  = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setM = (k, v) => setMemo(m => ({ ...m, [k]: v }))
  const toggleTag = t => setMemo(m => ({
    ...m, tags: m.tags.includes(t) ? m.tags.filter(x => x !== t) : [...m.tags, t],
  }))

  const getSignal = async () => {
    setSignal(null)
    const r = await api.runAgent(form.agent_abbr, { symbol: form.symbol, horizon: form.horizon })
    if (r) {
      setSignal(r)
      if (r.action && r.action !== 'HOLD') {
        set('side', r.action)
        set('confidence', r.confidence || 0.7)
        setMemo(m => ({
          ...m,
          signal_source: form.agent_abbr + ' ML model (conf. ' + Math.round((r.confidence||0)*100) + '%)',
          market_context: form.horizon + ' · ' + r.action,
        }))
      }
    }
  }

  const autoFillMemo = () => {
    const agreeing = AGENT_IDS.filter(a => {
      const s = agentSignals[a]
      return s && s.action === form.side && s.symbol === form.symbol
    })
    if (agreeing.length > 0 && !memo.signal_source) {
      setMemo(m => ({ ...m, signal_source: agreeing.join(' + ') + ' consensus (' + agreeing.length + '/' + AGENT_IDS.length + ')' }))
    }
  }

  const buildChecks = () => {
    const chks = []
    const price = livePrice ? livePrice.price : 0
    const sl  = parseFloat(memo.stop_loss_price)
    const tp  = parseFloat(memo.take_profit_price)
    const sc  = memoScore(memo, form.reason)

    if (sc < 40) chks.push({ type:'warning', title:'Memo incompleto',  detail:'Score ' + sc + '/100 — aggiungi thesis e segnale' })
    else         chks.push({ type:'info',    title:'Memo completo',     detail:'Score ' + sc + '/100' })

    if (!sl)
      chks.push({ type:'warning', title:'Nessuno stop loss', detail:'Considera un livello di uscita per limitare le perdite' })
    else if (form.side === 'BUY' && sl > price)
      chks.push({ type:'error', title:'Stop loss sopra il prezzo', detail:'SL ' + sl.toFixed(2) + ' > prezzo ' + price.toFixed(2) })
    else {
      const slPct = Math.abs((sl - price) / (price||1) * 100)
      chks.push({ type: slPct > 8 ? 'warning' : 'info',
                  title:'Stop loss: ' + slPct.toFixed(1) + '% dal prezzo', detail:'Livello impostato' })
    }

    if (sl && tp) {
      const rr = Math.abs(tp - price) / (Math.abs(price - sl) || 1)
      chks.push({ type: rr >= 2 ? 'info' : 'warning',
                  title:'R:R = ' + rr.toFixed(1) + ':1',
                  detail: rr >= 2 ? 'Ottimo rapporto rischio/rendimento' : 'Considera di migliorare il R:R' })
    }

    if (signal && signal.filtered === 'regime_blocked')
      chks.push({ type:'warning', title:'Segnale contro-trend', detail:'Il regime di mercato suggerisce direzione opposta' })

    if (form.confidence < 0.55)
      chks.push({ type:'warning', title:'Confidenza bassa (' + Math.round(form.confidence*100) + '%)', detail:'Segnale debole dal modello ML' })

    return chks
  }

  const goToMemo   = () => { autoFillMemo(); setStep('memo') }
  const goToReview = () => { setChecks(buildChecks()); setStep('review') }

  const submit = async () => {
    setLoading(true); setResult(null)
    const price = livePrice ? livePrice.price : 0
    const r = await api.executeTrade({
      symbol:      form.symbol,
      side:        form.side,
      quantity:    Number(form.quantity),
      agent_abbr:  form.agent_abbr,
      order_type:  form.order_type,
      limit_price: form.limit_price ? Number(form.limit_price) : null,
      horizon:     form.horizon,
      confidence:  Number(form.confidence),
      reason:      memo.thesis || form.reason,
      memo: {
        signal_source:     memo.signal_source,
        market_context:    memo.market_context,
        thesis:            memo.thesis || form.reason,
        risk_level:        memo.risk_level,
        stop_loss_price:   memo.stop_loss_price ? Number(memo.stop_loss_price) : null,
        take_profit_price: memo.take_profit_price ? Number(memo.take_profit_price) : null,
        tags:              memo.tags,
      },
    })
    if (r && r.id) {
      setResult({ ...r, ok: true }); setStep('done'); onExecuted && onExecuted(r)
    } else {
      setResult({ ok: false, error: (r && r.detail) || 'Trade failed' }); setStep('review')
    }
    setLoading(false)
  }

  const reset = () => {
    setStep('form'); setResult(null); setChecks([])
    setMemo({ signal_source:'', market_context:'', thesis:'',
              risk_level:'MEDIUM', stop_loss_price:'', take_profit_price:'', tags:[] })
  }

  if (!isOpen) return null

  const hCfg     = HORIZONS.find(h => h.id === form.horizon) || HORIZONS[2]
  const price    = livePrice ? livePrice.price : 0
  const notional = price * Number(form.quantity || 0)
  const score    = memoScore(memo, form.reason)
  const inpStyle = { width:'100%', background:C.bg, border:'1px solid ' + C.border, borderRadius:7,
                     color:C.text, padding:'8px 11px', fontSize:12, outline:'none' }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:1000,
                  display:'flex', alignItems:'center', justifyContent:'center', padding:20,
                  backdropFilter:'blur(4px)' }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'#0f1829', border:'1px solid ' + C.border, borderRadius:16,
                    width:'100%', maxWidth:720, maxHeight:'94vh', overflowY:'auto', padding:28,
                    boxShadow:'0 24px 80px rgba(0,0,0,.6)' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div>
            <h2 style={{ fontSize:18, fontWeight:800, margin:0 }}>⚡ Execute Paper Trade</h2>
            <p style={{ fontSize:11, color:C.muted, margin:'2px 0 0' }}>Real price · Memo obbligatorio · Pre-trade check</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, fontSize:22, cursor:'pointer' }}>✕</button>
        </div>

        {/* Steps */}
        <div style={{ display:'flex', gap:14, alignItems:'center', marginBottom:22,
                      padding:'10px 14px', background:C.surface, borderRadius:10, border:'1px solid ' + C.border }}>
          <StepDot n={1} label="Ordine"   active={step==='form'}   done={['memo','review','done'].includes(step)}/>
          <div style={{ flex:1, height:1, background:C.border }}/>
          <StepDot n={2} label="Memo"     active={step==='memo'}   done={['review','done'].includes(step)}/>
          <div style={{ flex:1, height:1, background:C.border }}/>
          <StepDot n={3} label="Review"   active={step==='review'} done={step==='done'}/>
          <div style={{ flex:1, height:1, background:C.border }}/>
          <StepDot n={4} label="Eseguito" active={step==='done'}   done={false}/>
        </div>

        {/* ─── STEP 1 ─────────────────────────────────────────────────── */}
        {step === 'form' && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginBottom:16 }}>
              {HORIZONS.map(h => (
                <button key={h.id} onClick={() => set('horizon', h.id)}
                  style={{ padding:'10px 6px', borderRadius:9, cursor:'pointer', textAlign:'left',
                           background: form.horizon===h.id ? h.color + '18' : C.surface,
                           border:'1px solid ' + (form.horizon===h.id ? h.color + '66' : C.border) }}>
                  <div style={{ fontSize:16, marginBottom:2 }}>{h.icon}</div>
                  <div style={{ fontSize:11, fontWeight:700, color:form.horizon===h.id ? h.color : C.text }}>{h.label}</div>
                  <div style={{ fontSize:9, color:C.muted }}>{h.sub}</div>
                </button>
              ))}
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {/* Symbol */}
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Symbol</div>
                  <div style={{ display:'flex', gap:6 }}>
                    <input value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())}
                      style={{ ...inpStyle, flex:1, fontSize:14, fontWeight:700, ...mono }}/>
                    <select value={form.symbol} onChange={e => set('symbol', e.target.value)}
                      style={{ background:C.bg, border:'1px solid ' + C.border, borderRadius:7,
                               color:C.muted, padding:'0 8px', fontSize:11, outline:'none' }}>
                      {SYMBOLS.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  {livePrice && (
                    <div style={{ marginTop:5, fontSize:11 }}>
                      <span style={{ color:C.muted }}>Live: </span>
                      <span style={{ color:C.text, fontWeight:700, ...mono }}>${livePrice.price.toFixed(2)}</span>
                      <span style={{ color:livePrice.change_pct>=0?C.green:C.red, marginLeft:8, ...mono }}>
                        {livePrice.change_pct>=0?'+':''}{livePrice.change_pct.toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
                {/* Side */}
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Side</div>
                  <div style={{ display:'flex', gap:5 }}>
                    {['BUY','SELL','HOLD'].map(s => {
                      const sc = s==='BUY'?C.green:s==='SELL'?C.red:C.muted
                      return (
                        <button key={s} onClick={() => set('side', s)} style={{
                          flex:1, padding:'9px 0', borderRadius:7, fontWeight:700, fontSize:12, cursor:'pointer',
                          background: form.side===s ? sc + '22' : C.surface,
                          border:'1px solid ' + (form.side===s ? sc + '66' : C.border),
                          color: form.side===s ? sc : C.muted }}>
                          {s}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {/* Qty */}
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Quantity</div>
                  <input type="number" value={form.quantity} onChange={e => set('quantity', e.target.value)} min="0.001"
                    style={{ ...inpStyle, ...mono }}/>
                  {price > 0 && (
                    <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>
                      Nozionale: <span style={{ color:C.text, ...mono }}>${notional.toFixed(2)}</span>
                      {' · '} Fee: <span style={{ color:C.muted, ...mono }}>${(notional*0.001).toFixed(2)}</span>
                    </div>
                  )}
                </div>
                {/* Order type */}
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Order Type</div>
                  <div style={{ display:'flex', gap:5 }}>
                    {['MARKET','LIMIT','STOP'].map(t => (
                      <button key={t} onClick={() => set('order_type', t)} style={{
                        flex:1, padding:'7px 0', borderRadius:7, fontSize:10, fontWeight:600, cursor:'pointer',
                        background: form.order_type===t ? C.accent + '22' : C.surface,
                        border:'1px solid ' + (form.order_type===t ? C.accent + '66' : C.border),
                        color: form.order_type===t ? C.accent : C.muted }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {/* Agent */}
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Agent</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:4 }}>
                    {AGENT_IDS.map(abbr => {
                      const a      = agents.find(x => x.abbr === abbr) || {}
                      const sigAct = agentSignals[abbr] && agentSignals[abbr].action
                      const isRec  = recommended.includes(abbr)
                      const active = form.agent_abbr === abbr
                      const aColor = AGENT_COLORS[abbr] || C.accent
                      const dotC   = sigAct==='BUY' ? C.green : sigAct==='SELL' ? C.red : isRec ? C.yellow : null
                      return (
                        <button key={abbr} onClick={() => set('agent_abbr', abbr)} style={{
                          padding:'6px 4px', borderRadius:7, cursor:'pointer', position:'relative',
                          background: active ? aColor + '22' : C.surface,
                          border:'1px solid ' + (active ? aColor + '66' : isRec ? C.yellow + '44' : C.border) }}>
                          <div style={{ fontSize:13 }}>{a.icon || '🤖'}</div>
                          <div style={{ fontSize:9, fontWeight:700, color:active?aColor:C.muted, ...mono }}>{abbr}</div>
                          {dotC && <div style={{ position:'absolute', top:2, right:2, width:5, height:5,
                                                 borderRadius:99, background:dotC }}/>}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <button onClick={getSignal} style={{ padding:'8px 0', borderRadius:7, cursor:'pointer',
                  background:C.purple + '18', border:'1px solid ' + C.purple + '44',
                  color:C.purple, fontSize:11, fontWeight:600 }}>
                  🧠 Get {form.agent_abbr} signal
                </button>
                {signal && (
                  <div style={{ padding:'9px 12px', borderRadius:7, fontSize:11,
                    background:(signal.action==='BUY'?C.green:signal.action==='SELL'?C.red:C.muted) + '15',
                    border:'1px solid ' + (signal.action==='BUY'?C.green:signal.action==='SELL'?C.red:C.muted) + '44' }}>
                    <span style={{ fontSize:14, fontWeight:800, color:signal.action==='BUY'?C.green:signal.action==='SELL'?C.red:C.muted, ...mono }}>
                      {signal.action}
                    </span>
                    <span style={{ fontSize:11, color:C.muted, marginLeft:10 }}>conf. {Math.round((signal.confidence||0)*100)}%</span>
                  </div>
                )}
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                    <span style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:.8 }}>Confidence</span>
                    <span style={{ fontSize:10, color:C.accent, ...mono }}>{Math.round(form.confidence*100)}%</span>
                  </div>
                  <input type="range" min="0.1" max="1" step="0.05" value={form.confidence}
                    onChange={e => set('confidence', parseFloat(e.target.value))}
                    style={{ width:'100%', accentColor:C.accent, marginBottom:4 }}/>
                  <ProgressBar value={form.confidence*100} color={C.accent} height={3}/>
                </div>
              </div>
            </div>

            <button onClick={goToMemo} style={{
              width:'100%', marginTop:18, padding:'11px 0', borderRadius:9, cursor:'pointer',
              fontSize:13, fontWeight:800, border:'none', color:'white',
              background:'linear-gradient(135deg,' + C.accent + ',' + C.purple + ')',
              boxShadow:'0 4px 16px ' + C.accent + '44' }}>
              Continua -> Memo
            </button>
          </>
        )}

        {/* ─── STEP 2: MEMO ───────────────────────────────────────────── */}
        {step === 'memo' && (
          <>
            <div style={{ display:'flex', gap:14, alignItems:'center', marginBottom:18,
                          padding:'12px 16px', background:C.surface, borderRadius:10, border:'1px solid ' + C.border }}>
              <ScoreRing score={score}/>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Qualità del Memo</div>
                <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
                  {score >= 80 ? '✅ Eccellente' : score >= 50 ? '⚠️ Sufficiente — aggiungi dettagli' : '🔴 Incompleto'}
                </div>
              </div>
              <div style={{ marginLeft:'auto', textAlign:'right' }}>
                <div style={{ fontSize:11, color:C.muted, ...mono }}>{form.side} {form.quantity}× {form.symbol}</div>
                <div style={{ fontSize:13, fontWeight:700, color:form.side==='BUY'?C.green:form.side==='SELL'?C.red:C.muted, ...mono }}>
                  @ ${price.toFixed(2)}
                </div>
              </div>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {[
                ['Fonte del Segnale', 'signal_source', 'es. MOM + SEN consensus, breakout RSI...'],
                ['Contesto di Mercato', 'market_context', 'es. Bull regime, VIX basso, earnings domani...'],
              ].map(([label, key, ph]) => (
                <div key={key}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>{label}</div>
                  <input value={memo[key]} onChange={e => setM(key, e.target.value)} placeholder={ph} style={inpStyle}/>
                </div>
              ))}

              <div>
                <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>
                  Thesis di Investimento ★
                </div>
                <textarea value={memo.thesis || form.reason}
                  onChange={e => { setM('thesis', e.target.value); set('reason', e.target.value) }}
                  rows={3} placeholder="Perché stai aprendo questa posizione? Qual è il catalizzatore atteso?"
                  style={{ ...inpStyle, resize:'vertical', lineHeight:1.5 }}/>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                {[
                  ['Stop Loss ($)', 'stop_loss_price', C.red],
                  ['Take Profit ($)', 'take_profit_price', C.green],
                ].map(([label, key, borderC]) => (
                  <div key={key}>
                    <div style={{ fontSize:10, color:borderC, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>{label}</div>
                    <input type="number" value={memo[key]} onChange={e => setM(key, e.target.value)}
                      placeholder={key==='stop_loss_price' && price > 0 ? (price*.97).toFixed(2) : ''}
                      style={{ ...inpStyle, border:'1px solid ' + borderC + '44', ...mono }}/>
                    {memo[key] && price > 0 && (
                      <div style={{ fontSize:10, color:borderC, marginTop:3 }}>
                        {((Number(memo[key]) - price)/price*100).toFixed(1)}% dal prezzo
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize:10, color:C.muted, marginBottom:6, textTransform:'uppercase', letterSpacing:.8 }}>Risk Level</div>
                <div style={{ display:'flex', gap:8 }}>
                  {RISK_LEVELS.map(r => (
                    <button key={r.id} onClick={() => setM('risk_level', r.id)} style={{
                      flex:1, padding:'8px 0', borderRadius:7, cursor:'pointer', fontSize:11, fontWeight:700,
                      background: memo.risk_level===r.id ? r.color + '22' : C.surface,
                      border:'1px solid ' + (memo.risk_level===r.id ? r.color + '66' : C.border),
                      color: memo.risk_level===r.id ? r.color : C.muted }}>
                      {r.icon} {r.id}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize:10, color:C.muted, marginBottom:7, textTransform:'uppercase', letterSpacing:.8 }}>Tags</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                  {PRESET_TAGS.map(tag => (
                    <button key={tag} onClick={() => toggleTag(tag)} style={{
                      padding:'3px 10px', borderRadius:20, cursor:'pointer', fontSize:10, fontWeight:600,
                      background: memo.tags.includes(tag) ? C.accent + '22' : C.surface,
                      border:'1px solid ' + (memo.tags.includes(tag) ? C.accent + '66' : C.border),
                      color: memo.tags.includes(tag) ? C.accent : C.muted }}>
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display:'flex', gap:10, marginTop:20 }}>
              <button onClick={() => setStep('form')} style={{ flex:1, padding:'10px 0', borderRadius:9, cursor:'pointer',
                fontSize:12, background:C.surface, border:'1px solid ' + C.border, color:C.muted }}>
                ← Indietro
              </button>
              <button onClick={goToReview} style={{ flex:2, padding:'10px 0', borderRadius:9, cursor:'pointer',
                fontSize:13, fontWeight:800, border:'none', color:'white',
                background:'linear-gradient(135deg,' + C.accent + ',' + C.purple + ')' }}>
                Review &rarr;
              </button>
            </div>
          </>
        )}

        {/* ─── STEP 3: REVIEW ─────────────────────────────────────────── */}
        {step === 'review' && (
          <>
            <div style={{ padding:'14px 16px', borderRadius:10, marginBottom:16,
                          background:(form.side==='BUY'?C.green:form.side==='SELL'?C.red:C.muted) + '12',
                          border:'1px solid ' + (form.side==='BUY'?C.green:form.side==='SELL'?C.red:C.muted) + '44' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <span style={{ fontSize:24, fontWeight:900, color:form.side==='BUY'?C.green:form.side==='SELL'?C.red:C.muted, ...mono }}>
                    {form.side}
                  </span>
                  <span style={{ fontSize:18, fontWeight:700, color:C.text, marginLeft:12, ...mono }}>
                    {form.quantity} × {form.symbol}
                  </span>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:18, fontWeight:800, color:C.text, ...mono }}>${price.toFixed(2)}</div>
                  <div style={{ fontSize:11, color:C.muted }}>Nozionale: ${notional.toFixed(2)}</div>
                </div>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                <Badge label={form.agent_abbr} color={AGENT_COLORS[form.agent_abbr]||C.accent}/>
                <Badge label={form.horizon}    color={C.purple}/>
                <Badge label={memo.risk_level} color={memo.risk_level==='HIGH'?C.red:memo.risk_level==='LOW'?C.green:C.yellow}/>
                {memo.tags.map(t => <Badge key={t} label={t} color={C.dim}/>)}
              </div>
            </div>

            <div style={{ padding:'12px 14px', borderRadius:9, marginBottom:14,
                          background:C.surface, border:'1px solid ' + C.border }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <span style={{ fontSize:11, fontWeight:700, color:C.text }}>📝 Memo</span>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <ScoreRing score={score}/>
                  <button onClick={() => setStep('memo')}
                    style={{ fontSize:10, color:C.accent, background:'none', border:'none', cursor:'pointer' }}>Modifica</button>
                </div>
              </div>
              {[
                ['Thesis',       memo.thesis || form.reason],
                ['Segnale',      memo.signal_source],
                ['Contesto',     memo.market_context],
                ['Stop Loss',    memo.stop_loss_price ? '$' + memo.stop_loss_price : null],
                ['Take Profit',  memo.take_profit_price ? '$' + memo.take_profit_price : null],
              ].filter(([,v]) => v).map(([l,v]) => (
                <div key={l} style={{ display:'flex', gap:10, marginBottom:4, fontSize:11 }}>
                  <span style={{ color:C.muted, minWidth:80, flexShrink:0 }}>{l}</span>
                  <span style={{ color:C.text }}>{v}</span>
                </div>
              ))}
            </div>

            {checks.length > 0 && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase',
                              letterSpacing:.8, marginBottom:8 }}>Pre-trade Checks</div>
                {checks.map((c,i) => <Check key={i} {...c}/>)}
              </div>
            )}

            {result && !result.ok && (
              <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:12,
                background:C.red + '15', border:'1px solid ' + C.red + '44', color:C.red, fontSize:12 }}>
                ❌ {result.error}
              </div>
            )}

            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setStep('memo')} style={{ flex:1, padding:'10px 0', borderRadius:9, cursor:'pointer',
                fontSize:12, background:C.surface, border:'1px solid ' + C.border, color:C.muted }}>← Memo</button>
              <button onClick={submit} disabled={loading} style={{
                flex:2, padding:'12px 0', borderRadius:9, cursor:'pointer', fontSize:14, fontWeight:800,
                border:'none', color:'white', opacity:loading?0.6:1,
                background: form.side==='BUY'
                  ? 'linear-gradient(135deg,' + C.green + ',#059669)'
                  : form.side==='SELL'
                  ? 'linear-gradient(135deg,' + C.red + ',#dc2626)'
                  : C.surface,
                boxShadow:'0 4px 16px ' + (form.side==='BUY'?C.green:form.side==='SELL'?C.red:C.muted) + '44',
              }}>
                {loading ? '⏳ Esecuzione…' : '⚡ Conferma ' + form.side + ' ' + form.quantity + ' × ' + form.symbol}
              </button>
            </div>
          </>
        )}

        {/* ─── STEP 4: DONE ───────────────────────────────────────────── */}
        {step === 'done' && result && result.ok && (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ fontSize:52, marginBottom:12 }}>✅</div>
            <div style={{ fontSize:18, fontWeight:800, color:C.green, marginBottom:6 }}>Trade Eseguito!</div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>
              {result.side} {result.quantity} × {result.symbol} @ ${result.price && result.price.toFixed(2)}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20 }}>
              {[
                ['Fill Price',  '$' + (result.price && result.price.toFixed(2)),     C.text],
                ['Nozionale',   '$' + (result.notional && result.notional.toFixed(2)), C.text],
                ['Fee',         '$' + (result.fee && result.fee.toFixed(4)),         C.muted],
                ['Slippage',    '$' + (result.slippage && result.slippage.toFixed(4)), C.muted],
                ['Agente',       result.agent_abbr,                                  C.accent],
                ['Horizon',      form.horizon,                                        C.purple],
              ].map(([l,v,c]) => (
                <div key={l} style={{ background:C.surface, borderRadius:8, padding:'10px',
                                      border:'1px solid ' + C.border }}>
                  <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:3 }}>{l}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:c, ...mono }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
              <button onClick={reset} style={{ padding:'8px 20px', borderRadius:8, cursor:'pointer',
                background:C.accent + '22', border:'1px solid ' + C.accent + '44',
                color:C.accent, fontSize:12, fontWeight:700 }}>+ Nuovo Ordine</button>
              <button onClick={onClose} style={{ padding:'8px 20px', borderRadius:8, cursor:'pointer',
                background:C.surface, border:'1px solid ' + C.border, color:C.muted, fontSize:12 }}>
                Chiudi
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
