/**
 * DashboardPage — 3 tabs:
 *   Overview    — existing KPI strip, equity curve, agent returns
 *   P&L Live    — unrealized P&L per position, real-time update
 *   Risk Monitor— RMG status, drawdown gauge, alerts, global stop toggle
 */
import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts'
import { C, Card, SectionTitle, Badge, ProgressBar, Spinner, StatChip, pct, fmt, mono, TT } from '../components/UI'
import { ReportButton } from '../components/ReportButton'
import api from '../lib/api'

const TABS = [
  { id:'overview', label:'Overview',     icon:'⬛' },
  { id:'pnl',      label:'P&L Live',     icon:'📊' },
  { id:'risk',     label:'Risk Monitor', icon:'🛡' },
]

// ── Overview tab ──────────────────────────────────────────────────────────────
function OverviewTab({ portfolio, agents, trades, prices, onOrder }) {
  const [eqData,   setEqData]   = useState([])
  const [risk,     setRisk]     = useState(null)
  const [ensemble, setEnsemble] = useState(null)

  useEffect(() => {
    api.equity(100).then(d => d && setEqData(d))
    api.risk().then(d => d && setRisk(d))
    api.ensemble().then(d => d && setEnsemble(d))
  }, [])

  const ret  = portfolio.total_return || 0
  const eq   = portfolio.equity || 100000
  const pnl  = portfolio.daily_pnl || 0
  const live = agents.filter(a => a.state === 'Live').length
  const sectors = [
    { name:'Equities', pct:42, color:C.accent },
    { name:'Tech',     pct:28, color:C.cyan   },
    { name:'Bonds',    pct:14, color:C.green  },
    { name:'Crypto',   pct:10, color:C.yellow },
    { name:'Commodities',pct:6,color:C.purple },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:900, margin:0, letterSpacing:-.5 }}>
            Portfolio Overview
            <span style={{ fontSize:13, fontWeight:500, color:C.muted, marginLeft:12 }}>
              {live}/{agents.length} agents live
            </span>
          </h1>
          {portfolio.global_stop && (
            <div style={{ marginTop:6, padding:'5px 12px', borderRadius:7, display:'inline-flex',
              alignItems:'center', gap:6, background:`${C.red}18`, border:`1px solid ${C.red}44` }}>
              <span style={{ color:C.red, fontWeight:700, fontSize:12 }}>🚨 GLOBAL STOP ACTIVE</span>
              <span style={{ color:C.muted, fontSize:10 }}>new orders blocked by RMG</span>
            </div>
          )}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <ReportButton page="dashboard"/>
          <button onClick={onOrder} style={{
            padding:'9px 20px', borderRadius:10, cursor:'pointer',
            background: portfolio.global_stop
              ? C.dim : `linear-gradient(135deg,${C.accent},${C.purple})`,
            border:'none', color:'white', fontSize:12, fontWeight:700,
            opacity: portfolio.global_stop ? 0.4 : 1,
          }} disabled={portfolio.global_stop}>
            ⚡ New Trade
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:12, marginBottom:20 }}>
        {[
          { l:'Total Equity',  v:`$${(eq/1000).toFixed(1)}k`,    c:C.text,  icon:'💰' },
          { l:'YTD Return',    v:pct(ret),                        c:ret>=0?C.green:C.red, icon:'📈' },
          { l:'Daily P&L',     v:`$${pnl.toFixed(0)}`,            c:pnl>=0?C.green:C.red, icon:'⚡' },
          { l:'Unrealized',    v:`$${(portfolio.unrealized_pnl||0).toFixed(0)}`,
                                                                   c:(portfolio.unrealized_pnl||0)>=0?C.green:C.red, icon:'⏳' },
          { l:'Sharpe Ratio',  v:(portfolio.sharpe||0).toFixed(2), c:C.cyan,  icon:'🎯' },
          { l:'Win Rate',      v:`${(portfolio.win_rate||0).toFixed(1)}%`, c:C.green, icon:'🏆' },
        ].map(({ l, v, c, icon }) => (
          <Card key={l} glow={c !== C.text && c !== C.cyan ? c : null}
            style={{ padding:'16px 18px', position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:10, right:12, fontSize:18, opacity:.15 }}>{icon}</div>
            <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:1.2, marginBottom:6 }}>{l}</div>
            <div className="num" style={{ fontSize:22, fontWeight:900, color:c }}>{v}</div>
          </Card>
        ))}
      </div>

      {/* Main grid */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16, marginBottom:16 }}>
        {/* Equity curve */}
        <Card>
          <SectionTitle title="Equity Curve" sub="Strategy vs benchmarks"/>
          {eqData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={eqData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                <XAxis dataKey="i" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false} domain={['auto','auto']}/>
                <Tooltip {...TT}/>
                <Line type="monotone" dataKey="portfolio" stroke={C.accent} strokeWidth={2.5} dot={false} isAnimationActive={false}/>
                <Line type="monotone" dataKey="sp500" stroke={C.muted} strokeWidth={1.2} dot={false} strokeDasharray="4 4" isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          ) : <Spinner/>}
        </Card>

        {/* Ensemble + risk */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <Card glow={ensemble?.action==='BUY'?C.green:ensemble?.action==='SELL'?C.red:null}>
            <SectionTitle title="Ensemble Signal"/>
            {ensemble ? (
              <div style={{ textAlign:'center', padding:'8px 0' }}>
                <div className="num" style={{ fontSize:32, fontWeight:900,
                  color:ensemble.action==='BUY'?C.green:ensemble.action==='SELL'?C.red:C.muted,
                  textShadow:`0 0 20px ${ensemble.action==='BUY'?C.green:ensemble.action==='SELL'?C.red:C.muted}66` }}>
                  {ensemble.action}
                </div>
                <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>
                  {Math.round((ensemble.confidence||0)*100)}% conf · regime: {ensemble.regime||'—'}
                </div>
              </div>
            ) : <Spinner size={20}/>}
          </Card>
          <Card>
            <SectionTitle title="Risk Snapshot"/>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {[
                ['Sharpe',  (risk?.sharpe  || portfolio.sharpe  || 0).toFixed(2), C.cyan  ],
                ['Max DD',  `${(risk?.max_drawdown || portfolio.max_drawdown || 0).toFixed(1)}%`, C.red],
                ['Beta',    (risk?.beta    || 0.72).toFixed(2), C.text  ],
                ['Alpha',   pct(portfolio.alpha || 9.3),         C.green ],
              ].map(([l,v,c]) => (
                <div key={l} style={{ background:`${c}08`, borderRadius:8, padding:'9px 10px',
                                      border:`1px solid ${c}22` }}>
                  <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:3 }}>{l}</div>
                  <div className="num" style={{ fontSize:15, fontWeight:800, color:c }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Agent returns + sector */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16, marginBottom:16 }}>
        <Card>
          <SectionTitle title="Agent Returns YTD"/>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={agents.map(a => ({ n:a.abbr, p:a.perf||0 }))} barSize={26}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
              <XAxis dataKey="n" tick={{fontSize:10,fill:C.muted}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
              <Tooltip {...TT} formatter={v=>[pct(v),'Return']}/>
              <Bar dataKey="p" radius={[5,5,0,0]} label={{position:'top',fontSize:9,fill:C.muted,formatter:v=>`${v>=0?'+':''}${v.toFixed(1)}%`}}>
                {agents.map((a,i) => <Cell key={i} fill={a.color||C.accent} fillOpacity={0.85}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionTitle title="Sector Exposure"/>
          {sectors.map(s => (
            <div key={s.name} style={{ marginBottom:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                <span style={{ fontSize:11, color:C.muted }}>{s.name}</span>
                <span className="num" style={{ fontSize:11, color:s.color }}>{s.pct}%</span>
              </div>
              <ProgressBar value={s.pct} color={s.color} height={5}/>
            </div>
          ))}
        </Card>
      </div>

      {/* Live trades */}
      <Card>
        <SectionTitle title="Live Trade Feed" sub="Latest executions"/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:6 }}>
          {trades.slice(0, 12).map((t, i) => {
            const up = t.side === 'BUY'
            return (
              <div key={t.id||i} style={{ display:'flex', gap:8, alignItems:'center',
                padding:'7px 10px', background:C.bg, borderRadius:8, border:`1px solid ${C.border}18` }}>
                <div style={{ width:7, height:7, borderRadius:99, flexShrink:0,
                              background:up?C.green:C.red, boxShadow:`0 0 6px ${up?C.green:C.red}` }}/>
                <span className="num" style={{ color:up?C.green:C.red, fontWeight:700, width:36, fontSize:11 }}>{t.side}</span>
                <span className="num" style={{ color:C.text, fontWeight:700, flex:1, fontSize:11 }}>{t.symbol||t.sym}</span>
                <span style={{ color:C.muted, fontSize:10 }}>{t.agent_abbr}</span>
                <span className="num" style={{ color:(t.pnl||0)>=0?C.green:C.red, fontWeight:700, fontSize:11 }}>
                  {(t.pnl||0)>=0?'+':''}{(t.pnl||0).toFixed(2)}%
                </span>
              </div>
            )
          })}
          {!trades.length && <div style={{ color:C.muted, fontSize:11, padding:'12px 0' }}>No trades yet</div>}
        </div>
      </Card>
    </div>
  )
}

// ── P&L Live tab ──────────────────────────────────────────────────────────────
function PnlLiveTab({ pnlSummary, lastTick }) {
  const [positions, setPositions] = useState({})
  const [history,   setHistory]   = useState([])

  useEffect(() => {
    api.allPositions().then(d => d && setPositions(d))
    api.equity(80).then(d => d && setHistory(d))
  }, [])

  // Update from WS tick
  useEffect(() => {
    if (lastTick?.pnl_summary?.by_position) {
      setPositions(prev => {
        const next = { ...prev }
        Object.entries(lastTick.pnl_summary.by_position).forEach(([abbr, pos]) => {
          next[abbr] = pos
        })
        return next
      })
    }
  }, [lastTick])

  const totalUnreal  = pnlSummary?.total_unrealized_pnl || 0
  const totalMktVal  = pnlSummary?.total_market_value   || 0
  const totalCost    = pnlSummary?.total_cost_basis     || 0
  const openCount    = Object.values(positions).reduce((n,p) => n + Object.keys(p).length, 0)

  return (
    <div>
      {/* Summary KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
        {[
          ['Unrealized P&L',   `$${totalUnreal.toFixed(2)}`,     totalUnreal>=0?C.green:C.red],
          ['Market Value',     `$${totalMktVal.toFixed(2)}`,     C.text],
          ['Cost Basis',       `$${totalCost.toFixed(2)}`,       C.muted],
          ['Open Positions',   openCount,                         C.accent],
        ].map(([l,v,c]) => (
          <Card key={l} glow={l==='Unrealized P&L'?(totalUnreal>=0?C.green:C.red):null}
            style={{ padding:16 }}>
            <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>{l}</div>
            <div className="num" style={{ fontSize:22, fontWeight:800, color:c }}>{v}</div>
          </Card>
        ))}
      </div>

      {/* Per-agent P&L */}
      {openCount === 0 ? (
        <Card>
          <div style={{ padding:'40px 0', textAlign:'center' }}>
            <div style={{ fontSize:36, marginBottom:12 }}>📊</div>
            <div style={{ color:C.text, fontWeight:600, marginBottom:6 }}>No Open Positions</div>
            <div style={{ color:C.muted, fontSize:11 }}>Execute trades to see live P&L tracking here</div>
          </div>
        </Card>
      ) : (
        Object.entries(positions).map(([abbr, agentPos]) => {
          if (!Object.keys(agentPos).length) return null
          const agentUnreal = Object.values(agentPos).reduce((s,p) => s + (p.unrealized_pnl||0), 0)
          return (
            <Card key={abbr} style={{ marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span className="num" style={{ fontSize:14, fontWeight:800, color:C.accent }}>{abbr}</span>
                  <span style={{ fontSize:10, color:C.muted }}>{Object.keys(agentPos).length} positions</span>
                </div>
                <span className="num" style={{ fontSize:14, fontWeight:700,
                  color:agentUnreal>=0?C.green:C.red }}>
                  {agentUnreal>=0?'+':''}{agentUnreal.toFixed(2)}
                </span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:8 }}>
                {Object.entries(agentPos).map(([sym, pos]) => {
                  const upnl = pos.unrealized_pnl || 0
                  const upct = pos.unrealized_pct || 0
                  const c    = upnl >= 0 ? C.green : C.red
                  return (
                    <div key={sym} style={{ background:C.bg, borderRadius:9, padding:'10px 14px',
                      border:`1px solid ${c}33` }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                        <span className="num" style={{ fontWeight:800, fontSize:14, color:C.text }}>{sym}</span>
                        <span className="num" style={{ fontSize:13, fontWeight:700, color:c }}>
                          {upnl>=0?'+':''}{upnl.toFixed(2)}
                        </span>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:C.muted }}>
                        <span>qty: <span className="num">{(pos.qty||0).toFixed(4)}</span></span>
                        <span className="num" style={{ color:c }}>{upct>=0?'+':''}{upct.toFixed(2)}%</span>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:C.dim, marginTop:3 }}>
                        <span>avg: <span className="num">${(pos.avg_cost||0).toFixed(2)}</span></span>
                        <span>now: <span className="num">${(pos.current_price||0).toFixed(2)}</span></span>
                      </div>
                      <div style={{ marginTop:5 }}>
                        <ProgressBar value={Math.min(100, Math.abs(upct) * 10)}
                          color={c} height={3}/>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })
      )}

      {/* Equity history mini */}
      {history.length > 0 && (
        <Card style={{ marginTop:4 }}>
          <SectionTitle title="Portfolio Equity" sub="Historical curve"/>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={history}>
              <defs>
                <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.accent} stopOpacity={0.2}/>
                  <stop offset="95%" stopColor={C.accent} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
              <XAxis dataKey="i" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false} domain={['auto','auto']}/>
              <Tooltip {...TT}/>
              <Area type="monotone" dataKey="portfolio" stroke={C.accent} strokeWidth={2}
                    fill="url(#pnlGrad)" dot={false} isAnimationActive={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  )
}

// ── Risk Monitor tab ──────────────────────────────────────────────────────────
function RiskTab() {
  const [rmg,     setRmg]     = useState(null)
  const [alerts,  setAlerts]  = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      api.get('/api/risk-manager/status'),
      api.get('/api/risk-manager/alerts?limit=30'),
    ])
    if (s) setRmg(s)
    if (a) setAlerts(Array.isArray(a) ? a : [])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const id = setInterval(load, 10000); return () => clearInterval(id) }, [load])

  const resetStop = async () => {
    setLoading(true)
    await api.post('/api/risk-manager/reset-stop', {})
    await load()
    setLoading(false)
  }

  if (!rmg) return <Spinner/>

  const ddPct    = rmg.open_positions > 0 ? 0 : 0   // will come from status in future
  const stopColor = rmg.global_stop ? C.red : C.green

  return (
    <div>
      {/* Global stop banner */}
      {rmg.global_stop && (
        <div style={{ padding:'14px 20px', marginBottom:20, borderRadius:10,
          background:`${C.red}15`, border:`2px solid ${C.red}66`,
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:C.red }}>🚨 GLOBAL STOP ACTIVE</div>
            <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
              New orders are blocked. Portfolio drawdown exceeded {rmg.dd_hard_pct}% threshold.
            </div>
          </div>
          <button onClick={resetStop} disabled={loading} style={{
            padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700,
            background:`${C.yellow}22`, border:`1px solid ${C.yellow}44`, color:C.yellow,
          }}>{loading ? '...' : 'Reset Stop'}</button>
        </div>
      )}

      {/* RMG config KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:20 }}>
        {[
          ['Status',      rmg.global_stop ? 'STOPPED' : 'ACTIVE', stopColor],
          ['DD Warning',  rmg.dd_warn_pct + '%',  C.yellow],
          ['DD Hard Stop',rmg.dd_hard_pct + '%',  C.red],
          ['Pos. Stop',   rmg.pos_stop_pct + '%', C.red],
          ['Open Pos.',   rmg.open_positions,      C.text],
        ].map(([l,v,c]) => (
          <Card key={l} style={{ padding:14 }}>
            <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>{l}</div>
            <div className="num" style={{ fontSize:18, fontWeight:800, color:c }}>{v}</div>
          </Card>
        ))}
      </div>

      {/* Alerts feed */}
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <SectionTitle title="RMG Alert Log" sub="Real-time risk events"/>
          <button onClick={load} style={{ fontSize:10, background:'none',
            border:`1px solid ${C.border}`, borderRadius:5, padding:'3px 8px',
            color:C.muted, cursor:'pointer' }}>↺</button>
        </div>
        {alerts.length === 0 ? (
          <div style={{ padding:'24px 0', textAlign:'center', color:C.muted, fontSize:11 }}>
            ✅ No risk alerts — portfolio within thresholds
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {alerts.map((a, i) => {
              const c = a.level === 'CRITICAL' ? C.red :
                        a.level === 'WARNING'  ? C.yellow : C.green
              return (
                <div key={i} style={{ padding:'9px 12px', borderRadius:8, fontSize:11,
                  background:`${c}0e`, border:`1px solid ${c}33` }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                    <span style={{ fontWeight:700, color:c }}>
                      {a.level === 'CRITICAL' ? '🚨' : a.level === 'WARNING' ? '⚠️' : '✅'} {a.type?.replace(/_/g,' ')}
                    </span>
                    <span style={{ fontSize:9, color:C.dim, fontFamily:'monospace' }}>
                      {new Date(a.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ color:C.muted }}>{a.message}</div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Thresholds info */}
      <Card style={{ marginTop:14 }}>
        <SectionTitle title="Risk Configuration" sub="Set via Render env vars"/>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, fontSize:11 }}>
          {[
            ['PORTFOLIO_DD_WARN',  `${rmg.dd_warn_pct}%`,  'Drawdown warning threshold'],
            ['PORTFOLIO_DD_HARD',  `${rmg.dd_hard_pct}%`,  'Hard stop — blocks all new orders'],
            ['POSITION_DD_HARD',   `${rmg.pos_stop_pct}%`, 'Auto-close individual position'],
            ['RMG_CHECK_INTERVAL', '15s',                   'How often RMG checks positions'],
          ].map(([key, val, desc]) => (
            <div key={key} style={{ background:C.bg, borderRadius:7, padding:'10px 12px',
                                    border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:10, fontFamily:'monospace', color:C.accent, marginBottom:3 }}>{key}</div>
              <div className="num" style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:3 }}>{val}</div>
              <div style={{ fontSize:9, color:C.dim }}>{desc}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ── Root DashboardPage ────────────────────────────────────────────────────────
export default function DashboardPage({
  portfolio = {}, agents = [], trades = [], prices = {},
  pnlSummary = {}, lastTick = null, onOrder,
}) {
  const [tab, setTab] = useState('overview')

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display:'flex', gap:5, marginBottom:20 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:'8px 18px', borderRadius:9, fontSize:12, cursor:'pointer',
            fontWeight: tab===t.id ? 700 : 400,
            background: tab===t.id ? `${C.accent}22` : C.surface,
            border:`1px solid ${tab===t.id?`${C.accent}66`:C.border}`,
            color: tab===t.id ? C.accent : C.muted,
            display:'flex', alignItems:'center', gap:6,
          }}>
            <span>{t.icon}</span><span>{t.label}</span>
            {t.id === 'pnl' && (pnlSummary.total_unrealized_pnl !== 0) && (
              <span style={{ fontSize:9, fontFamily:'monospace', marginLeft:2,
                color:(pnlSummary.total_unrealized_pnl||0)>=0?C.green:C.red }}>
                {(pnlSummary.total_unrealized_pnl||0)>=0?'+':''}{(pnlSummary.total_unrealized_pnl||0).toFixed(0)}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab portfolio={portfolio} agents={agents} trades={trades}
                     prices={prices} onOrder={onOrder}/>
      )}
      {tab === 'pnl' && (
        <PnlLiveTab pnlSummary={pnlSummary} lastTick={lastTick}/>
      )}
      {tab === 'risk' && <RiskTab/>}
    </div>
  )
}
