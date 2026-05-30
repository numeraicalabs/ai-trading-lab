/**
 * NetworkPage — Multi-agent network con:
 *   - Live impulse flow (ImpulseFlow component)
 *   - Opportunity Scanner: convergenza multi-agente in tempo reale
 *   - Correlation matrix live degli agenti
 *   - Connection strength heatmap
 */
import { useState, useEffect, useCallback } from 'react'
import { C, Card, SectionTitle, Badge, ProgressBar, Spinner, TT } from '../components/UI'
import { ImpulseFlow } from '../components/ImpulseFlow'
import api from '../lib/api'

const mono = { fontFamily:"'JetBrains Mono','Fira Code',monospace" }

const AGENT_COLORS = {
  MOM:'#06b6d4', MRV:'#8b5cf6', PPO:'#3b82f6', DQN:'#ec4899', MAC:'#f59e0b',
  SEN:'#f97316', VOL:'#ef4444', REG:'#14b8a6', OPT:'#10b981', SCOUT:'#f0abfc',
}

// ── Opportunity card ──────────────────────────────────────────────────────────
function OpCard({ op, onTrade }) {
  const dc  = op.direction === 'BUY' ? C.green : C.red
  const str = Math.round(op.score * 100)

  return (
    <div style={{
      background:'linear-gradient(145deg,' + C.card + ',' + C.card2 + ')',
      border:'1px solid ' + dc + '33',
      borderRadius:12, padding:16,
      boxShadow:'0 2px 16px ' + dc + '0a',
      transition:'all .2s',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:900, color:C.text, ...mono }}>{op.symbol}</div>
          <div style={{ fontSize:10, color:C.muted, marginTop:1 }}>
            {op.regime_aligned ? '✅ Allineato al regime' : '⚠️ Contro-trend'}
            {' · '}{op.regime}
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:22, fontWeight:900, color:dc, ...mono }}>
            {op.direction}
          </div>
          <div style={{ fontSize:10, color:C.muted }}>{Math.round(op.consensus*100)}% consenso</div>
        </div>
      </div>

      {/* Score bar */}
      <div style={{ marginBottom:10 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
          <span style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8 }}>Conviction Score</span>
          <span style={{ fontSize:10, color:dc, ...mono, fontWeight:700 }}>{str}/100</span>
        </div>
        <ProgressBar value={str} color={dc} height={6}/>
      </div>

      {/* Agent agreement badges */}
      <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 }}>
        {(op.buy_agents || []).map(a => (
          <span key={a} style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:4,
                                  background:C.green + '15', border:'1px solid ' + C.green + '44',
                                  color:C.green, ...mono }}>{a}</span>
        ))}
        {(op.sell_agents || []).map(a => (
          <span key={a} style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:4,
                                  background:C.red + '15', border:'1px solid ' + C.red + '44',
                                  color:C.red, ...mono }}>{a}</span>
        ))}
      </div>

      {/* Stats row */}
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        {[
          [op.agreement + '/' + op.total_agents + ' agenti', C.text],
          [op.direction, dc],
        ].map(([v, c], i) => (
          <div key={i} style={{ background:C.bg, borderRadius:6, padding:'4px 8px',
                                fontSize:10, color:c, ...mono }}>{v}</div>
        ))}
      </div>

      <button onClick={() => onTrade(op)} style={{
        width:'100%', padding:'8px 0', borderRadius:8, cursor:'pointer',
        fontSize:11, fontWeight:700, border:'none', color:'white',
        background:'linear-gradient(135deg,' + dc + ',' + dc + 'cc)',
        boxShadow:'0 2px 8px ' + dc + '44',
      }}>
        ⚡ Esegui {op.direction} {op.symbol}
      </button>
    </div>
  )
}

// ── Correlation cell ──────────────────────────────────────────────────────────
function CorrCell({ v }) {
  const abs  = Math.abs(v)
  const bg   = v > 0.3
    ? 'rgba(16,185,129,' + (abs * 0.4) + ')'
    : v < -0.3
    ? 'rgba(239,68,68,' + (abs * 0.4) + ')'
    : 'rgba(100,116,139,' + (abs * 0.3) + ')'
  const col  = abs > 0.5 ? C.text : C.muted
  return (
    <td style={{ padding:'5px 8px', textAlign:'center', background:bg,
                 borderRadius:4, color:col, ...mono, fontSize:9 }}>
      {v.toFixed(2)}
    </td>
  )
}

// ── Root page ─────────────────────────────────────────────────────────────────
export default function NetworkPage({ agents = [], impulses = [], liveImpulses = {}, regime = {} }) {
  const [opportunities, setOpportunities] = useState([])
  const [correlation,   setCorrelation]   = useState(null)
  const [flowData,      setFlowData]      = useState(null)
  const [tab,           setTab]           = useState('opportunities')
  const [loading,       setLoading]       = useState(false)
  const [lastScan,      setLastScan]      = useState(null)
  const [filter,        setFilter]        = useState('ALL')  // ALL / BUY / SELL / ALIGNED

  const scan = useCallback(async () => {
    setLoading(true)
    const [opp, corr, flow] = await Promise.all([
      api.get('/api/network/opportunities'),
      api.get('/api/network/correlation'),
      api.get('/api/network/flow'),
    ])
    if (opp)  { setOpportunities(opp.opportunities || []); setLastScan(opp.ts) }
    if (corr) setCorrelation(corr)
    if (flow) setFlowData(flow)
    setLoading(false)
  }, [])

  useEffect(() => { scan() }, [scan])
  useEffect(() => { const id = setInterval(scan, 15000); return () => clearInterval(id) }, [scan])

  const filteredOps = opportunities.filter(op => {
    if (filter === 'BUY')     return op.direction === 'BUY'
    if (filter === 'SELL')    return op.direction === 'SELL'
    if (filter === 'ALIGNED') return op.regime_aligned
    return true
  })

  const liveCount  = agents.filter(a => a.state === 'Live').length
  const buyOps     = opportunities.filter(o => o.direction === 'BUY').length
  const sellOps    = opportunities.filter(o => o.direction === 'SELL').length
  const alignedOps = opportunities.filter(o => o.regime_aligned).length

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>🕸 Multi-Agent Network</h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>
            Live impulse flow · Opportunity scanner · Correlation · {liveCount}/{agents.length} agents live
          </p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ padding:'6px 12px', borderRadius:7, fontSize:11,
            background:C.cyan + '18', border:'1px solid ' + C.cyan + '44', color:C.cyan }}>
            🔍 Regime: <span style={{ fontWeight:700 }}>{regime && regime.label ? regime.label : 'detecting'}</span>
          </div>
          <button onClick={scan} disabled={loading} style={{
            padding:'7px 14px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:700,
            background:C.accent + '22', border:'1px solid ' + C.accent + '44', color:C.accent,
            opacity:loading?0.6:1 }}>
            {loading ? '⏳' : '↺'} Scan
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:20 }}>
        {[
          ['Opportunità',  opportunities.length, C.text],
          ['BUY signals',  buyOps,               C.green],
          ['SELL signals', sellOps,               C.red],
          ['Regime align', alignedOps,            C.cyan],
          ['Active agents',liveCount,             C.accent],
        ].map(([l,v,c]) => (
          <Card key={l} style={{ padding:14 }}>
            <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>{l}</div>
            <div style={{ fontSize:22, fontWeight:800, color:c, ...mono }}>{v}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:5, marginBottom:18 }}>
        {[
          ['opportunities','🎯 Opportunità'],
          ['impulses',     '⚡ Impulsi Live'],
          ['correlation',  '📊 Correlazioni'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'8px 16px', borderRadius:9, fontSize:12, cursor:'pointer',
            fontWeight: tab===id ? 700 : 400,
            background: tab===id ? C.accent + '22' : C.surface,
            border:'1px solid ' + (tab===id ? C.accent + '66' : C.border),
            color: tab===id ? C.accent : C.muted,
          }}>{label}</button>
        ))}
        {lastScan && (
          <span style={{ marginLeft:'auto', fontSize:10, color:C.dim, alignSelf:'center' }}>
            Ultimo scan: {new Date(lastScan).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* ── TAB: OPPORTUNITIES ─────────────────────────────────────────── */}
      {tab === 'opportunities' && (
        <>
          {/* Filter bar */}
          <div style={{ display:'flex', gap:6, marginBottom:16 }}>
            {[['ALL','Tutte'],['BUY','BUY'],['SELL','SELL'],['ALIGNED','Allineate']].map(([id,label]) => (
              <button key={id} onClick={() => setFilter(id)} style={{
                padding:'5px 12px', borderRadius:7, fontSize:11, cursor:'pointer',
                background: filter===id
                  ? (id==='BUY'?C.green:id==='SELL'?C.red:C.accent) + '22'
                  : C.surface,
                border:'1px solid ' + (filter===id
                  ? (id==='BUY'?C.green:id==='SELL'?C.red:C.accent) + '66'
                  : C.border),
                color: filter===id
                  ? (id==='BUY'?C.green:id==='SELL'?C.red:C.accent)
                  : C.muted,
              }}>{label} {id !== 'ALL' && <span style={{ fontSize:9 }}>({id==='BUY'?buyOps:id==='SELL'?sellOps:alignedOps})</span>}</button>
            ))}
          </div>

          {loading && !opportunities.length ? <Spinner/> : (
            filteredOps.length === 0 ? (
              <Card>
                <div style={{ padding:'40px 0', textAlign:'center' }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>🔍</div>
                  <div style={{ color:C.text, fontWeight:600, marginBottom:6 }}>Nessuna opportunità rilevata</div>
                  <div style={{ color:C.muted, fontSize:11 }}>
                    Gli agenti stanno analizzando il mercato. Esegui "Train All" per avere segnali attivi.
                  </div>
                </div>
              </Card>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:14 }}>
                {filteredOps.map(op => (
                  <OpCard key={op.symbol} op={op} onTrade={op => {
                    window._openOrder && window._openOrder({
                      symbol:     op.symbol,
                      action:     op.direction,
                      quantity:   1,
                      horizon:    'swing',
                      reasoning:  op.agreement + '/' + op.total_agents + ' agents agree on ' + op.direction,
                    })
                  }}/>
                ))}
              </div>
            )
          )}

          {/* How it works */}
          {opportunities.length > 0 && (
            <Card style={{ marginTop:16 }}>
              <SectionTitle title="Come funziona l'Opportunity Scanner" sub="Algoritmo di convergenza multi-agente"/>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
                {[
                  ['1. Raccoglie segnali', 'Ogni agente produce un segnale BUY/SELL/HOLD con confidence score'],
                  ['2. Pesa per accuracy', 'Agenti con OOS accuracy alta pesano di più nel voto ensemble'],
                  ['3. Calcola consenso',  'Simboli con ≥40% accordo tra agenti vengono segnalati'],
                  ['4. Filtra per regime', 'Opportunità allineate al regime di mercato vengono evidenziate'],
                ].map(([t,d]) => (
                  <div key={t} style={{ background:C.bg, borderRadius:8, padding:'12px 14px',
                                        border:'1px solid ' + C.border }}>
                    <div style={{ fontSize:11, fontWeight:700, color:C.accent, marginBottom:5 }}>{t}</div>
                    <div style={{ fontSize:10, color:C.muted, lineHeight:1.6 }}>{d}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── TAB: IMPULSES ─────────────────────────────────────────────── */}
      {tab === 'impulses' && (
        <ImpulseFlow agents={agents} impulses={impulses} liveImpulses={liveImpulses} height={440}/>
      )}

      {/* ── TAB: CORRELATION ──────────────────────────────────────────── */}
      {tab === 'correlation' && (
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16 }}>
          <Card>
            <SectionTitle title="Agent Return Correlation Matrix"
                          sub="1 = perfect positive · -1 = perfect negative · 0 = uncorrelated"/>
            {correlation ? (
              <div style={{ overflowX:'auto' }}>
                <table style={{ borderCollapse:'separate', borderSpacing:3 }}>
                  <thead>
                    <tr>
                      <th style={{ padding:'4px 8px', color:C.muted, fontSize:9 }}/>
                      {correlation.agents.map(a => (
                        <th key={a} style={{ padding:'4px 8px', fontSize:9, fontWeight:700,
                                             color:AGENT_COLORS[a]||C.text, ...mono }}>{a}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {correlation.agents.map(rowA => (
                      <tr key={rowA}>
                        <td style={{ padding:'4px 8px', fontSize:9, fontWeight:700, whiteSpace:'nowrap',
                                     color:AGENT_COLORS[rowA]||C.text, ...mono }}>{rowA}</td>
                        {correlation.agents.map(colA => (
                          <CorrCell key={colA} v={(correlation.matrix[rowA] && correlation.matrix[rowA][colA]) || 0}/>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Spinner/>}
          </Card>

          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <Card>
              <SectionTitle title="Diversificazione" sub="Correlazione media del portfolio"/>
              {correlation && (() => {
                const agents  = correlation.agents
                const vals    = []
                agents.forEach(a => agents.forEach(b => {
                  if (a !== b) vals.push(Math.abs(correlation.matrix[a][b]))
                }))
                const avg = vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0
                const div = 1 - avg
                const c   = div > 0.5 ? C.green : div > 0.3 ? C.yellow : C.red
                return (
                  <div>
                    <div style={{ fontSize:36, fontWeight:900, color:c, ...mono, marginBottom:4 }}>
                      {(div*100).toFixed(0)}%
                    </div>
                    <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>
                      {div > 0.5 ? '✅ Buona diversificazione' : div > 0.3 ? '⚠️ Correlazione moderata' : '🔴 Alta correlazione — rischio concentrato'}
                    </div>
                    <ProgressBar value={div*100} color={c} height={6}/>
                  </div>
                )
              })()}
            </Card>

            <Card>
              <SectionTitle title="Connection Strength" sub="Intensità flusso impulsi"/>
              {flowData && Object.entries(flowData.connection_strength || {})
                .sort(([,a],[,b]) => b - a).slice(0,8).map(([pair, strength]) => {
                  const [from] = pair.split('-')
                  const c = AGENT_COLORS[from] || C.accent
                  return (
                    <div key={pair} style={{ marginBottom:7 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                        <span style={{ fontSize:10, color:C.muted, ...mono }}>{pair.replace('-','->')}</span>
                        <span style={{ fontSize:10, color:c, ...mono }}>{strength.toFixed(2)}</span>
                      </div>
                      <ProgressBar value={Math.min(100, strength * 50)} color={c} height={3}/>
                    </div>
                  )
              })}
            </Card>

            <Card>
              <SectionTitle title="Agenti Attivi"/>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {(flowData && flowData.active_agents || []).map(a => (
                  <span key={a} style={{ padding:'4px 10px', borderRadius:20, fontSize:10, fontWeight:700,
                    background:(AGENT_COLORS[a]||C.accent) + '18',
                    border:'1px solid ' + (AGENT_COLORS[a]||C.accent) + '44',
                    color:AGENT_COLORS[a]||C.accent, ...mono }}>
                    {a}
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
