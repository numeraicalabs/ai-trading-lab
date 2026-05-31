/**
 * TradingModePage — 3 sections:
 *   Mode Selector   — PAPER_AUTO / PAPER_MANUAL / REAL_MANUAL / REAL_AUTO
 *   Approval Inbox  — pending signals requiring human approval
 *   Broker Status   — connection check, account info (Alpaca/stub)
 */
import { useState, useEffect, useCallback } from 'react'
import { C, Card, SectionTitle, Badge, ProgressBar, Spinner, TT } from '../components/UI'
import api from '../lib/api'

const MODES = [
  {
    id:    'PAPER_AUTO',
    label: 'Paper — Auto',
    icon:  '🤖',
    color: C.green,
    desc:  'Agent signals execute immediately as paper trades. No human approval needed.',
    badge: 'RECOMMENDED',
    safe:  true,
  },
  {
    id:    'PAPER_MANUAL',
    label: 'Paper — Manual',
    icon:  '✋',
    color: C.yellow,
    desc:  'Signals queue for your approval before paper execution. Review each trade.',
    badge: null,
    safe:  true,
  },
  {
    id:    'REAL_MANUAL',
    label: 'Real — Manual',
    icon:  '⚡',
    color: C.accent,
    desc:  'Signals queue for approval, then sent to real broker (Alpaca). Human in the loop.',
    badge: 'REAL MONEY',
    safe:  false,
  },
  {
    id:    'REAL_AUTO',
    label: 'Real — Auto',
    icon:  '🚨',
    color: C.red,
    desc:  'Signals execute directly on real broker without approval. DANGEROUS.',
    badge: 'HIGH RISK',
    safe:  false,
  },
]

const mono = { fontFamily:"'JetBrains Mono','Fira Code',monospace" }

function ModeCard({ mode, active, onSelect }) {
  return (
    <div onClick={() => onSelect(mode.id)}
      style={{
        background: active ? `${mode.color}12` : C.card,
        border:     `2px solid ${active ? mode.color : C.border}`,
        borderRadius: 14, padding: 20, cursor: 'pointer',
        transition: 'all .2s',
        boxShadow: active ? `0 0 24px ${mode.color}22` : 'none',
        position: 'relative',
      }}>
      {/* Active indicator */}
      {active && (
        <div style={{ position:'absolute', top:14, right:14, width:10, height:10,
          borderRadius:'50%', background:mode.color, boxShadow:`0 0 8px ${mode.color}` }}
          className="pulse"/>
      )}
      {mode.badge && (
        <div style={{ position:'absolute', top:12, left:12,
          background:`${mode.safe?C.green:C.red}22`, color:mode.safe?C.green:C.red,
          border:`1px solid ${mode.safe?C.green:C.red}44`,
          borderRadius:4, padding:'1px 7px', fontSize:9, fontWeight:800 }}>
          {mode.badge}
        </div>
      )}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12, marginTop:mode.badge?14:0 }}>
        <div style={{ width:44, height:44, borderRadius:12, fontSize:22,
          background:`${mode.color}18`, border:`1px solid ${mode.color}44`,
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          {mode.icon}
        </div>
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:active?mode.color:C.text }}>
            {mode.label}
          </div>
          <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>
            {active ? '● ACTIVE' : 'click to activate'}
          </div>
        </div>
      </div>
      <div style={{ fontSize:11, color:C.muted, lineHeight:1.6 }}>{mode.desc}</div>
    </div>
  )
}

function ApprovalCard({ req, onApprove, onReject, loading }) {
  const [qty,     setQty]     = useState(req.quantity || 1)
  const [showMod, setShowMod] = useState(false)
  const side_c = req.side === 'BUY' ? C.green : req.side === 'SELL' ? C.red : C.muted
  const conf_c = req.confidence >= 70 ? C.green : req.confidence >= 55 ? C.yellow : C.red
  const errors  = (req.risk_flags || []).filter(c => c.type === 'error')
  const warnings= (req.risk_flags || []).filter(c => c.type === 'warning')
  const isExpiring = req.expires_at && new Date(req.expires_at) - new Date() < 5 * 60 * 1000

  return (
    <div style={{
      background: C.card, border:`1px solid ${C.border}`,
      borderRadius:14, padding:18, marginBottom:12,
      borderLeft:`4px solid ${side_c}`,
      opacity: loading ? 0.6 : 1,
    }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ background:`${side_c}18`, border:`1px solid ${side_c}44`,
            borderRadius:8, padding:'6px 14px', fontSize:14, fontWeight:900, color:side_c, ...mono }}>
            {req.side}
          </div>
          <div>
            <div style={{ fontSize:18, fontWeight:900, color:C.text, ...mono }}>{req.symbol}</div>
            <div style={{ fontSize:10, color:C.muted }}>
              <span style={{ color:C.accent }}>{req.agent_abbr}</span>
              {' · '}{req.horizon}{' · '}{req.regime}
            </div>
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:11, fontWeight:700, color:conf_c }}>
            {req.confidence?.toFixed(0)}% conf
          </div>
          {isExpiring && (
            <div style={{ fontSize:9, color:C.red }}>⏰ expiring soon</div>
          )}
          <div style={{ fontSize:9, color:C.dim }}>
            {new Date(req.created_at).toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Thesis */}
      {req.thesis && (
        <div style={{ padding:'8px 12px', background:C.bg, borderRadius:7, marginBottom:10,
          fontSize:11, color:C.muted, lineHeight:1.6, fontStyle:'italic',
          border:`1px solid ${C.border}18` }}>
          "{req.thesis}"
        </div>
      )}

      {/* Risk flags */}
      {errors.length > 0 && (
        <div style={{ marginBottom:8 }}>
          {errors.map((e,i) => (
            <div key={i} style={{ display:'flex', gap:6, padding:'5px 9px', borderRadius:6,
              background:`${C.red}0e`, border:`1px solid ${C.red}33`, fontSize:10, marginBottom:4 }}>
              <span>🚫</span>
              <span style={{ color:C.red, fontWeight:700 }}>{e.title}</span>
              <span style={{ color:C.muted }}>— {e.detail}</span>
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div style={{ marginBottom:8 }}>
          {warnings.slice(0,2).map((w,i) => (
            <div key={i} style={{ display:'flex', gap:6, padding:'5px 9px', borderRadius:6,
              background:`${C.yellow}0e`, border:`1px solid ${C.yellow}33`, fontSize:10, marginBottom:3 }}>
              <span>⚠️</span>
              <span style={{ color:C.yellow, fontWeight:600 }}>{w.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* Modify qty */}
      {showMod && (
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10 }}>
          <span style={{ fontSize:11, color:C.muted }}>Qty:</span>
          <input type="number" value={qty} onChange={e => setQty(+e.target.value)} min={0.001}
            style={{ width:80, background:C.bg, border:`1px solid ${C.accent}44`,
              borderRadius:6, color:C.text, padding:'4px 8px', fontSize:11, outline:'none', ...mono }}/>
          <span style={{ fontSize:10, color:C.dim }}>(original: {req.quantity})</span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display:'flex', gap:7 }}>
        <button onClick={() => onApprove(req.req_id, qty)}
          disabled={loading || errors.length > 0}
          style={{ flex:2, padding:'8px 0', borderRadius:8, cursor:'pointer',
            fontSize:12, fontWeight:800, border:'none', color:'white',
            background: errors.length > 0 ? C.dim : `linear-gradient(135deg,${C.green},#059669)`,
            opacity: (loading || errors.length > 0) ? 0.5 : 1 }}>
          ✅ Approve {errors.length > 0 ? '(blocked)' : ''}
        </button>
        <button onClick={() => setShowMod(s => !s)}
          style={{ padding:'8px 12px', borderRadius:8, cursor:'pointer', fontSize:11,
            background:`${C.yellow}18`, border:`1px solid ${C.yellow}44`, color:C.yellow }}>
          ✏️ Modify
        </button>
        <button onClick={() => onReject(req.req_id)}
          disabled={loading}
          style={{ flex:1, padding:'8px 0', borderRadius:8, cursor:'pointer',
            fontSize:12, fontWeight:700, border:`1px solid ${C.red}44`,
            background:`${C.red}18`, color:C.red }}>
          ❌ Reject
        </button>
      </div>
    </div>
  )
}

export default function TradingModePage({ lastMessage }) {
  const [modeData,  setModeData]  = useState(null)
  const [queue,     setQueue]     = useState([])
  const [history,   setHistory]   = useState([])
  const [broker,    setBroker]    = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [actLoading,setActLoading]= useState({})
  const [section,   setSection]   = useState('mode')   // mode | inbox | history | broker

  const loadAll = useCallback(async () => {
    const [md, qd, hd] = await Promise.all([
      api.get('/api/trading/mode'),
      api.get('/api/approval/queue'),
      api.get('/api/approval/history?limit=40'),
    ])
    if (md) setModeData(md)
    if (qd) setQueue(qd.queue || [])
    if (hd) setHistory(Array.isArray(hd) ? hd : [])
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => {
    const id = setInterval(loadAll, 8000)
    return () => clearInterval(id)
  }, [loadAll])

  // Real-time: new approval request from WS
  useEffect(() => {
    if (lastMessage?.type === 'approval_request') {
      loadAll()
      setSection('inbox')  // auto-switch to inbox
    }
  }, [lastMessage, loadAll])

  const changeMode = async (mode) => {
    if (loading) return
    if (!['PAPER_AUTO','PAPER_MANUAL'].includes(mode)) {
      if (!window.confirm(`Switch to ${mode}?\n\nThis involves REAL MONEY. Confirm you understand the risk.`))
        return
    }
    setLoading(true)
    const r = await api.post(`/api/trading/mode/${mode}`, {})
    if (r?.mode) { await loadAll() }
    setLoading(false)
  }

  const onApprove = async (req_id, qty) => {
    setActLoading(s => ({...s, [req_id]:'approve'}))
    await api.post(`/api/approval/${req_id}/approve`, { approved_by:'user', modified_qty:qty })
    await loadAll()
    setActLoading(s => ({...s, [req_id]:null}))
  }

  const onReject = async (req_id) => {
    setActLoading(s => ({...s, [req_id]:'reject'}))
    await api.post(`/api/approval/${req_id}/reject`, { reason:'Rejected by user' })
    await loadAll()
    setActLoading(s => ({...s, [req_id]:null}))
  }

  const loadBroker = async () => {
    setBroker(null)
    const r = await api.get('/api/trading/broker')
    if (r) setBroker(r)
  }

  const currentMode = modeData?.mode || 'PAPER_AUTO'
  const pendingCount = queue.length

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:900, margin:0 }}>⚡ Trading Mode</h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>
            Paper / Real trading toggle · Signal approval queue · Broker connection
          </p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {pendingCount > 0 && (
            <div style={{ padding:'6px 14px', borderRadius:8, fontSize:12, fontWeight:700,
              background:`${C.yellow}18`, border:`1px solid ${C.yellow}44`, color:C.yellow }}>
              ✋ {pendingCount} pending approval{pendingCount>1?'s':''}
            </div>
          )}
          <div style={{ padding:'6px 14px', borderRadius:8, fontSize:12, fontWeight:700,
            background:`${MODES.find(m=>m.id===currentMode)?.color||C.accent}18`,
            border:`1px solid ${MODES.find(m=>m.id===currentMode)?.color||C.accent}44`,
            color: MODES.find(m=>m.id===currentMode)?.color||C.accent }}>
            {MODES.find(m=>m.id===currentMode)?.icon} {currentMode.replace('_',' ')}
          </div>
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display:'flex', gap:5, marginBottom:20 }}>
        {[
          ['mode',    '⚙️ Mode',    null],
          ['inbox',   '📥 Inbox',   pendingCount || null],
          ['history', '📋 History', null],
          ['broker',  '🔌 Broker',  null],
        ].map(([id, label, badge]) => (
          <button key={id} onClick={() => { setSection(id); if (id==='broker') loadBroker() }}
            style={{ padding:'8px 16px', borderRadius:9, fontSize:12, cursor:'pointer',
              fontWeight: section===id?700:400,
              background: section===id?`${C.accent}22`:C.surface,
              border:`1px solid ${section===id?`${C.accent}66`:C.border}`,
              color: section===id?C.accent:C.muted,
              position:'relative' }}>
            {label}
            {badge > 0 && (
              <span style={{ position:'absolute', top:-4, right:-4, width:16, height:16,
                borderRadius:'50%', background:C.yellow, color:'black',
                fontSize:9, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center' }}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Mode selector ─────────────────────────────────────────────────── */}
      {section === 'mode' && (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
            {MODES.map(mode => (
              <ModeCard key={mode.id} mode={mode}
                active={currentMode === mode.id}
                onSelect={changeMode}/>
            ))}
          </div>

          {/* Stats */}
          {modeData && (
            <Card>
              <SectionTitle title="Approval Stats" sub="Last session"/>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
                {[
                  ['Pending',   modeData.pending||0,       C.yellow],
                  ['Approved',  modeData.approved_24h||0,  C.green],
                  ['Rejected',  modeData.rejected_24h||0,  C.red],
                  ['Expired',   modeData.expired_24h||0,   C.muted],
                  ['Executed',  modeData.executed||0,       C.accent],
                ].map(([l,v,c]) => (
                  <div key={l} style={{ background:C.bg, borderRadius:8, padding:'10px 14px',
                    border:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:4 }}>{l}</div>
                    <div style={{ fontSize:20, fontWeight:800, color:c, ...mono }}>{v}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── Approval Inbox ────────────────────────────────────────────────── */}
      {section === 'inbox' && (
        <div>
          {queue.length > 0 && (
            <div style={{ display:'flex', gap:8, marginBottom:16 }}>
              <button onClick={async () => { setLoading(true); await api.post('/api/approval/bulk/approve',{}); await loadAll(); setLoading(false) }}
                disabled={loading}
                style={{ padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700,
                  background:`${C.green}18`, border:`1px solid ${C.green}44`, color:C.green }}>
                ✅ Approve All ({queue.filter(r=>!r.risk_flags?.some(f=>f.type==='error')).length})
              </button>
              <button onClick={async () => { setLoading(true); await api.post('/api/approval/bulk/reject',{}); await loadAll(); setLoading(false) }}
                disabled={loading}
                style={{ padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700,
                  background:`${C.red}18`, border:`1px solid ${C.red}44`, color:C.red }}>
                ❌ Reject All
              </button>
              <span style={{ fontSize:11, color:C.muted, alignSelf:'center' }}>
                {queue.length} pending · TTL: {modeData?.approval_ttl||30}min
              </span>
            </div>
          )}

          {queue.length === 0 ? (
            <Card>
              <div style={{ padding:'50px 20px', textAlign:'center' }}>
                <div style={{ fontSize:48, marginBottom:14 }}>📥</div>
                <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>
                  Inbox empty
                </div>
                <div style={{ fontSize:11, color:C.muted }}>
                  {currentMode === 'PAPER_AUTO'
                    ? 'Switch to PAPER MANUAL or REAL MANUAL mode to see signals here'
                    : 'No pending signals — agents will send requests here when they have opportunities'}
                </div>
              </div>
            </Card>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              {queue.map(req => (
                <ApprovalCard key={req.req_id} req={req}
                  loading={!!actLoading[req.req_id]}
                  onApprove={onApprove} onReject={onReject}/>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History ───────────────────────────────────────────────────────── */}
      {section === 'history' && (
        <Card>
          <SectionTitle title="Approval History" sub="Last 40 decisions"/>
          {history.length === 0 ? (
            <div style={{ padding:'30px 0', textAlign:'center', color:C.muted }}>No history yet</div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead>
                  <tr style={{ background:C.surface }}>
                    {['Time','Agent','Symbol','Side','Conf','Status','Approved By','Executed','Reason'].map(h=>(
                      <th key={h} style={{ textAlign:'left', padding:'7px 11px', color:C.muted,
                        fontSize:9, textTransform:'uppercase', letterSpacing:.8,
                        borderBottom:`1px solid ${C.border}`, whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((r,i) => {
                    const sc = r.status==='APPROVED'?C.green:r.status==='REJECTED'?C.red:C.muted
                    const side_c = r.side==='BUY'?C.green:r.side==='SELL'?C.red:C.muted
                    return (
                      <tr key={i} style={{ borderBottom:`1px solid ${C.border}18` }}>
                        <td style={{ padding:'7px 11px', color:C.dim, fontSize:10, whiteSpace:'nowrap' }}>
                          {new Date(r.created_at).toLocaleTimeString()}
                        </td>
                        <td style={{ padding:'7px 11px', color:C.accent, ...mono, fontWeight:700 }}>{r.agent_abbr}</td>
                        <td style={{ padding:'7px 11px', ...mono, fontWeight:700 }}>{r.symbol}</td>
                        <td style={{ padding:'7px 11px', color:side_c, fontWeight:700 }}>{r.side}</td>
                        <td style={{ padding:'7px 11px', color:C.muted, ...mono }}>{r.confidence?.toFixed(0)}%</td>
                        <td style={{ padding:'7px 11px' }}>
                          <span style={{ background:`${sc}18`, color:sc, border:`1px solid ${sc}44`,
                            borderRadius:4, padding:'2px 7px', fontSize:9, fontWeight:700 }}>{r.status}</span>
                        </td>
                        <td style={{ padding:'7px 11px', color:C.muted, fontSize:10 }}>
                          {r.approved_by || '—'}
                        </td>
                        <td style={{ padding:'7px 11px' }}>
                          <span style={{ color:r.executed?C.green:C.dim }}>{r.executed?'✅':'—'}</span>
                        </td>
                        <td style={{ padding:'7px 11px', color:C.dim, fontSize:10, maxWidth:180,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {r.reject_reason || r.thesis || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Broker ────────────────────────────────────────────────────────── */}
      {section === 'broker' && (
        <div>
          <Card style={{ marginBottom:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <SectionTitle title="Broker Connection" sub="Real trading requires a configured broker"/>
              <button onClick={loadBroker} style={{ padding:'6px 12px', borderRadius:6, cursor:'pointer',
                fontSize:10, background:`${C.accent}18`, border:`1px solid ${C.accent}44`, color:C.accent }}>
                ↺ Test
              </button>
            </div>
            {!broker ? <Spinner size={20}/> : (
              <>
                <div style={{ padding:'12px 16px', borderRadius:10, marginBottom:14,
                  background:`${broker.connected?C.green:C.red}12`,
                  border:`1px solid ${broker.connected?C.green:C.red}44` }}>
                  <div style={{ fontSize:14, fontWeight:700,
                    color:broker.connected?C.green:C.red, marginBottom:4 }}>
                    {broker.connected ? '✅ Connected' : '❌ Not Connected'}
                  </div>
                  <div style={{ fontSize:11, color:C.muted }}>
                    {broker.message || (broker.connected
                      ? `${broker.broker?.toUpperCase()} · ${broker.paper?'Paper account':'LIVE account'}`
                      : broker.error)}
                  </div>
                </div>
                {broker.connected && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    {[
                      ['Account',      broker.account_id    || '—'],
                      ['Equity',       broker.equity ? `$${parseFloat(broker.equity).toFixed(2)}` : '—'],
                      ['Buying Power', broker.buying_power ? `$${parseFloat(broker.buying_power).toFixed(2)}` : '—'],
                      ['Type',         broker.paper ? 'PAPER' : '⚠️ LIVE'],
                    ].map(([l,v]) => (
                      <div key={l} style={{ background:C.bg, borderRadius:7, padding:'10px 12px',
                        border:`1px solid ${C.border}` }}>
                        <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:3 }}>{l}</div>
                        <div style={{ fontSize:13, fontWeight:700, color:C.text, ...mono }}>{v}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Setup guide */}
          <Card>
            <SectionTitle title="Setup Guide" sub="Configure broker API credentials"/>
            <div style={{ display:'flex', flexDirection:'column', gap:10, fontSize:11, color:C.muted }}>
              {[
                ['1. Create Alpaca account',   'Go to alpaca.markets → create free paper trading account'],
                ['2. Get API keys',            'Alpaca Dashboard → Overview → API Keys → Generate New Key'],
                ['3. Set Render env vars',     'ALPACA_API_KEY, ALPACA_API_SECRET, ALPACA_BASE_URL'],
                ['4. Enable real trading',     'Set REAL_TRADING_ENABLED=true + ALPACA_BASE_URL=https://api.alpaca.markets'],
                ['5. Set trading mode',        'Select REAL_MANUAL above — signals queue for your approval first'],
              ].map(([step, desc]) => (
                <div key={step} style={{ display:'flex', gap:12, padding:'8px 12px',
                  background:C.bg, borderRadius:7, border:`1px solid ${C.border}18` }}>
                  <span style={{ color:C.accent, fontWeight:700, flexShrink:0 }}>{step}</span>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop:14, padding:'10px 14px', borderRadius:8, fontSize:11,
              background:`${C.yellow}0e`, border:`1px solid ${C.yellow}33`, color:C.yellow }}>
              ⚠️ Paper API URL: https://paper-api.alpaca.markets<br/>
              ⚠️ Live API URL: https://api.alpaca.markets (real money)
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
