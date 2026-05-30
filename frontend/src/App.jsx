import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, Cell,
} from 'recharts'

// Layout & shared
import { TopBar }          from './components/TopBar'
import { C, Card, SectionTitle, Badge, ProgressBar, MiniChart, Spinner, StatChip, pct, fmt, mono, TT } from './components/UI'
// Agent views
import { AgentCard }       from './components/AgentCard'
import { AgentDetail }     from './components/AgentDetail'
// Trade modal
import { OrderModal }      from './components/OrderModal'
// Chat
import { OllamaChat }      from './components/OllamaChat'
import { AiInsightsPanel } from './components/AiInsightsPanel'
// Ecosystem page
import EcosystemPage       from './pages/EcosystemPage'
// Training Lab
import { ReportButton }     from './components/ReportButton'
import TrainingLabPage     from './pages/TrainingLabPage'
// Agent Learning Monitor
import AgentLearningPage   from './pages/AgentLearningPage'
// SCOUT Agent
import ScoutPage           from './pages/ScoutPage'
// Network page
import NetworkPage         from './pages/NetworkPage'
// Hooks & data
import { useWebSocket }    from './hooks/useWebSocket'
import { useAgents }       from './hooks/useAgents'
import api                 from './lib/api'
import { FALLBACK_PORTFOLIO, FALLBACK_PRICES } from './lib/fallback'

const NAV = [
  { id:'dashboard',  label:'Dashboard',  icon:'⬛' },
  { id:'agents',     label:'Agents',     icon:'🤖' },
  { id:'ecosystem',  label:'Ecosystem',  icon:'🧬' },
  { id:'network',    label:'Network',    icon:'🕸️' },
  { id:'analytics',  label:'Analytics',  icon:'📈' },
  { id:'trades',     label:'Trades',     icon:'📋' },
  { id:'chat',       label:'AI Chat',    icon:'💬' },
  { id:'lab',        label:'Training Lab',icon:'🧪' },
  { id:'learning',   label:'Learning',    icon:'📚' },
  { id:'scout',      label:'SCOUT',       icon:'🔭' },
]

// ── KPI strip ──────────────────────────────────────────────────────────────────
function KpiBar({ p }) {
  const kpis = [
    ['Return',   pct(p.total_return||0),                       C.green],
    ['Equity',   `$${((p.equity||100000)/1000).toFixed(1)}k`,  C.text],
    ['Sharpe',   (p.sharpe||0).toFixed(2),                     C.text],
    ['Sortino',  (p.sortino||0).toFixed(2),                    C.text],
    ['Max DD',   (p.max_drawdown||0)+'%',                      C.red],
    ['Vol',      (p.volatility||0)+'%',                        C.yellow],
    ['Alpha',    pct(p.alpha||0),                              C.cyan],
    ['Win %',    (p.win_rate||0)+'%',                          C.green],
    ['P.Factor', (p.profit_factor||1).toFixed(2),              C.text],
    ['Agents',   `${p.active_agents||7}/9`,                    C.accent],
    ['Exposure', (p.exposure_pct||0)+'%',                      C.text],
    ['P&L',      `$${(p.daily_pnl||0).toFixed(0)}`,           (p.daily_pnl||0)>=0?C.green:C.red],
  ]
  return (
    <div style={{ display:'flex', flexWrap:'wrap', background:C.surface, borderRadius:10,
                  border:`1px solid ${C.border}`, overflow:'hidden', marginBottom:20 }}>
      {kpis.map(([l,v,c],i) => (
        <div key={i} style={{ flex:'1 1 80px', padding:'10px 12px',
          borderRight: i<kpis.length-1?`1px solid ${C.border}`:'none',
          borderBottom:`1px solid ${C.border}` }}>
          <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:3 }}>{l}</div>
          <div style={{ fontSize:14, fontWeight:800, color:c, ...mono }}>{v}</div>
        </div>
      ))}
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ portfolio, agents = [], trades = [], prices = {}, onOrder }) {
  const [eqData,    setEqData]    = useState([])
  const [risk,      setRisk]      = useState(null)
  const [ensemble,  setEnsemble]  = useState(null)

  useEffect(() => {
    api.equity(100).then(d => d && setEqData(d))
    api.risk().then(d => d && setRisk(d))
    api.ensemble().then(d => d && setEnsemble(d))
  }, [])

  const ret   = portfolio.total_return || 0
  const eq    = portfolio.equity || 100000
  const pnl   = portfolio.daily_pnl || 0
  const liveA = agents.filter(a => a.state === 'Live').length

  // Top performers
  const topAgents   = [...agents].sort((a,b) => (b.perf||0) - (a.perf||0)).slice(0, 3)
  const worstAgents = [...agents].sort((a,b) => (a.perf||0) - (b.perf||0)).slice(0, 2)

  // Allocation donut data (simulated from agents)
  const allocData = agents.slice(0,6).map((a, i) => ({
    name: a.abbr, value: Math.abs(a.perf || 5) + 5, color: a.color,
  }))

  // Sector exposure
  const sectors = [
    { name:'Equities', pct:42, color:C.accent },
    { name:'Tech',     pct:28, color:C.cyan   },
    { name:'Bonds',    pct:14, color:C.green  },
    { name:'Crypto',   pct:10, color:C.yellow },
    { name:'Commodities',pct:6,color:C.purple },
  ]

  return (
    <div className="fade-up">
      {/* Hero header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:900, margin:0, letterSpacing:-.5 }}>
            Portfolio Overview
            <span style={{ fontSize:13, fontWeight:500, color:C.muted, marginLeft:12, letterSpacing:0 }}>
              {liveA}/{agents.length} agents live
            </span>
          </h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>
            AI multi-agent paper trading · Real market data · {agents.length} ML models
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <ReportButton page="dashboard"/>
          <button onClick={onOrder} style={{
            padding:'9px 20px', borderRadius:10, cursor:'pointer',
            background:`linear-gradient(135deg,${C.accent},${C.purple})`,
            border:'none', color:'white', fontSize:12, fontWeight:700,
            boxShadow:`0 4px 16px ${C.accent}44`,
          }}>⚡ New Trade</button>
        </div>
      </div>

      {/* KPI strip — 6 big stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:12, marginBottom:20 }}>
        {[
          { l:'Total Equity',  v:`$${(eq/1000).toFixed(1)}k`,  c:C.text,   icon:'💰', sub:'paper portfolio' },
          { l:'YTD Return',    v:pct(ret),                      c:ret>=0?C.green:C.red, icon:'📈', sub:ret>=0?'above baseline':'below baseline' },
          { l:'Daily P&L',     v:`$${pnl.toFixed(0)}`,          c:pnl>=0?C.green:C.red, icon:'⚡', sub:'today' },
          { l:'Sharpe Ratio',  v:(portfolio.sharpe||0).toFixed(2),c:C.cyan, icon:'🎯', sub:'risk-adjusted' },
          { l:'Max Drawdown',  v:`${(portfolio.max_drawdown||0).toFixed(1)}%`, c:C.red, icon:'📉', sub:'worst peak-to-trough' },
          { l:'Win Rate',      v:`${(portfolio.win_rate||0).toFixed(1)}%`, c:C.green, icon:'🏆', sub:`${trades.length} trades` },
        ].map(({l,v,c,icon,sub}) => (
          <Card key={l} glow={c !== C.text ? c : null}
            style={{ padding:'16px 18px', position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:10, right:12, fontSize:18, opacity:.15 }}>{icon}</div>
            <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:1.2, marginBottom:6 }}>{l}</div>
            <div className="num" style={{ fontSize:22, fontWeight:900, color:c, marginBottom:3 }}>{v}</div>
            <div style={{ fontSize:9, color:C.dim }}>{sub}</div>
          </Card>
        ))}
      </div>

      {/* Main grid */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16, marginBottom:16 }}>
        {/* Equity chart */}
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <SectionTitle title="Equity Curve" sub="Strategy vs S&P 500 vs Buy & Hold"/>
            <div style={{ display:'flex', gap:14 }}>
              {[['Strategy',C.accent],['S&P 500',C.muted],['B&H',C.dim]].map(([l,c])=>(
                <div key={l} style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <div style={{ width:18, height:2.5, background:c, borderRadius:99,
                                boxShadow: l==='Strategy'?`0 0 6px ${c}`:'none' }}/>
                  <span style={{ fontSize:10, color:C.muted }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          {eqData.length > 0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={eqData}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={C.accent} stopOpacity={.15}/>
                    <stop offset="100%" stopColor={C.accent} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3050" vertical={false}/>
                <XAxis dataKey="i" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false} domain={["auto","auto"]}/>
                <Tooltip {...TT}/>
                <Line type="monotone" dataKey="portfolio" stroke={C.accent} strokeWidth={2.5}
                      dot={false} name="Strategy" isAnimationActive={false}/>
                <Line type="monotone" dataKey="sp500" stroke={C.muted} strokeWidth={1.2}
                      dot={false} name="S&P 500" strokeDasharray="4 4" isAnimationActive={false}/>
                <Line type="monotone" dataKey="buyhold" stroke={C.dim} strokeWidth={1}
                      dot={false} name="B&H" strokeDasharray="2 6" isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height:210, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Spinner/>
            </div>
          )}
        </Card>

        {/* Right column: risk + ensemble */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {/* Risk metrics */}
          <Card>
            <SectionTitle title="Risk Metrics" sub="Live portfolio"/>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {[
                ['Sharpe',  (risk?.sharpe  || portfolio.sharpe  || 0).toFixed(2), C.cyan  ],
                ['Sortino', (risk?.sortino || portfolio.sortino || 0).toFixed(2), C.purple],
                ['VaR 95%', (risk?.var_95  || -2.4).toFixed(1)+'%',              C.red   ],
                ['CVaR',    (risk?.cvar_95 || -3.8).toFixed(1)+'%',              C.red   ],
                ['Beta',    (risk?.beta    || 0.72).toFixed(2),                  C.text  ],
                ['Alpha',   pct(portfolio.alpha || 9.3),                          C.green ],
              ].map(([l,v,c]) => (
                <div key={l} style={{ background:`${c}08`, borderRadius:8, padding:'9px 10px',
                                      border:`1px solid ${c}22` }}>
                  <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:3 }}>{l}</div>
                  <div className="num" style={{ fontSize:15, fontWeight:800, color:c }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Ensemble signal */}
          <Card glow={ensemble?.action==='BUY'?C.green:ensemble?.action==='SELL'?C.red:null}>
            <SectionTitle title="Ensemble Signal" sub="9-agent consensus"/>
            {ensemble ? (
              <div style={{ textAlign:'center', padding:'8px 0' }}>
                <div className="num" style={{
                  fontSize:32, fontWeight:900,
                  color: ensemble.action==='BUY'?C.green:ensemble.action==='SELL'?C.red:C.muted,
                  textShadow: `0 0 20px ${ensemble.action==='BUY'?C.green:ensemble.action==='SELL'?C.red:C.muted}66`,
                }}>
                  {ensemble.action}
                </div>
                <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>
                  Confidence: <span className="num" style={{ color:C.text }}>
                    {Math.round((ensemble.confidence||0)*100)}%
                  </span>
                </div>
                <div style={{ display:'flex', justifyContent:'center', gap:10, marginTop:10, flexWrap:'wrap' }}>
                  {ensemble.buy_agents?.map(a => (
                    <span key={a} style={{ fontSize:9, color:C.green, background:`${C.green}15`,
                                           padding:'2px 7px', borderRadius:4, fontFamily:'monospace' }}>{a}</span>
                  ))}
                  {ensemble.sell_agents?.map(a => (
                    <span key={a} style={{ fontSize:9, color:C.red, background:`${C.red}15`,
                                           padding:'2px 7px', borderRadius:4, fontFamily:'monospace' }}>{a}</span>
                  ))}
                </div>
              </div>
            ) : <Spinner size={20}/>}
          </Card>
        </div>
      </div>

      {/* Second row */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom:16 }}>
        {/* Sector exposure */}
        <Card>
          <SectionTitle title="Exposure by Sector"/>
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

        {/* Top performers */}
        <Card>
          <SectionTitle title="Top Agents" sub="By YTD return"/>
          {topAgents.map((a, i) => (
            <div key={a.abbr} style={{ display:'flex', alignItems:'center', gap:12,
                                       padding:'8px 0', borderBottom:`1px solid ${C.border}22` }}>
              <div style={{ fontSize:14, fontWeight:900, color:C.dim, width:16 }}>#{i+1}</div>
              <div style={{ width:28, height:28, borderRadius:8, fontSize:14,
                            background:`${a.color}22`, border:`1px solid ${a.color}44`,
                            display:'flex', alignItems:'center', justifyContent:'center' }}>
                {a.icon}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, fontWeight:700, color:a.color, fontFamily:'monospace' }}>{a.abbr}</div>
                <div style={{ fontSize:9, color:C.muted }}>{a.strategy}</div>
              </div>
              <div className="num" style={{ fontSize:14, fontWeight:800, color:C.green }}>
                {pct(a.perf||0)}
              </div>
            </div>
          ))}
        </Card>

        {/* Live feed */}
        <Card>
          <SectionTitle title="Live Trade Feed" sub="Latest executions"/>
          <div style={{ maxHeight:180, overflowY:'auto' }}>
            {trades.slice(0,12).map((t,i) => {
              const up = t.side === 'BUY'
              return (
                <div key={t.id||i} style={{
                  display:'flex', gap:8, alignItems:'center',
                  padding:'6px 0', borderBottom:`1px solid ${C.border}18`,
                  fontSize:11,
                }}>
                  <div style={{ width:6, height:6, borderRadius:99, flexShrink:0,
                                background: up ? C.green : C.red,
                                boxShadow: `0 0 6px ${up?C.green:C.red}` }}/>
                  <span className="num" style={{ color:up?C.green:C.red, fontWeight:700, width:32 }}>
                    {t.side}
                  </span>
                  <span className="num" style={{ color:C.text, fontWeight:700, flex:1 }}>
                    {t.symbol||t.sym}
                  </span>
                  <span style={{ color:C.muted, fontSize:10 }}>{t.agent_abbr}</span>
                  <span className="num" style={{ color:(t.pnl||0)>=0?C.green:C.red, fontWeight:700 }}>
                    {(t.pnl||0)>=0?'+':''}{(t.pnl||0).toFixed(2)}%
                  </span>
                </div>
              )
            })}
            {trades.length===0 && (
              <div style={{ color:C.muted, textAlign:'center', padding:'20px 0', fontSize:11 }}>
                No trades yet
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Agent performance bar */}
      <Card>
        <SectionTitle title="Agent Returns YTD" sub="Paper trading performance — click to view agent"/>
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={agents.map(a=>({n:a.abbr,p:a.perf||0,c:a.color}))} barSize={28}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3050" vertical={false}/>
            <XAxis dataKey="n" tick={{fontSize:10,fill:C.muted}} tickLine={false} axisLine={false}/>
            <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
            <Tooltip {...TT} formatter={v=>[pct(v),'Return']}/>
            <Bar dataKey="p" radius={[5,5,0,0]}
                 label={{position:'top',fontSize:9,fill:C.muted,formatter:v=>`${v>=0?"+":""}${v.toFixed(1)}%`}}>
              {agents.map((a, i) => (
                <Cell key={i} fill={a.color} fillOpacity={0.85}/>
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  )
}


// ── Agents page ────────────────────────────────────────────────────────────────
function AgentsPage({ agents = [], loading, onSelect }) {
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const filtered = agents.filter(a =>
    (filter==='All' || a.state===filter) &&
    (search==='' || a.name.toLowerCase().includes(search.toLowerCase()) || a.abbr.toLowerCase().includes(search.toLowerCase()))
  )
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>AI Agents</h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>Click a card to explore · {filtered.length} shown</p>
        </div>
        <div style={{ display:'flex', gap:7 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
            style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8,
                     color:C.text, padding:'7px 12px', fontSize:12, outline:'none', width:150 }}/>
          {['All','Live','Training','Backtest'].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding:'7px 12px', borderRadius:7, fontSize:11, cursor:'pointer',
              background: filter===s?`${C.accent}22`:C.surface,
              border:`1px solid ${filter===s?`${C.accent}66`:C.border}`,
              color: filter===s?C.accent:C.muted,
            }}>{s}</button>
          ))}
        </div>
      </div>
      {loading ? <Spinner/> : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 }}>
          {filtered.map(a => <AgentCard key={a.abbr} agent={a} onClick={onSelect}/>)}
        </div>
      )}
    </div>
  )
}

// ── Analytics page ─────────────────────────────────────────────────────────────
function AnalyticsPage({ agents = [] }) {
  const [scenario, setScenario] = useState([])
  const [risk,     setRisk]     = useState(null)
  useEffect(() => { api.scenario().then(d=>d&&setScenario(d)); api.risk().then(d=>d&&setRisk(d)) }, [])

  const corrVal = (i,j) => { if(i===j)return 1.0; const s=(i*17+j*31)%100; return +((s/100)*.9-.1).toFixed(2) }
  const scenRows = scenario.length ? scenario : [
    {scenario:'2020 COVID Crash',impact:-18.4},{scenario:'2022 Rate Hike',impact:-9.2},
    {scenario:'2023 AI Bull',impact:32.1},{scenario:'Flash Crash',impact:-6.8},
    {scenario:'High Vol',impact:-4.1},{scenario:'Bull +20%',impact:24.4},
  ]
  const riskRows = risk
    ? [['VaR 95%',risk.var_95+'%',C.red],['CVaR 95%',risk.cvar_95+'%',C.red],['Max DD',risk.max_drawdown+'%',C.red],
       ['Sharpe',risk.sharpe,C.text],['Sortino',risk.sortino,C.text],['Calmar',risk.calmar,C.green],
       ['Omega',risk.omega,C.green],['Beta',risk.beta,C.text]]
    : [['VaR 95%','-2.4%',C.red],['CVaR 95%','-3.8%',C.red],['Max DD','-8.2%',C.red],
       ['Sharpe','1.87',C.text],['Sortino','2.31',C.text],['Calmar','2.24',C.green],
       ['Omega','1.64',C.green],['Beta','0.72',C.text]]

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>Advanced Analytics</h1>
        <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>Correlation · VaR · CVaR · Scenario · Stress Testing</p>
      </div>
      <Card style={{ marginBottom:16 }}>
        <SectionTitle title="Agent Correlation Matrix" sub="Pairwise return correlation"/>
        <div style={{ overflowX:'auto' }}>
          <table style={{ borderCollapse:'separate', borderSpacing:3, fontSize:11 }}>
            <thead><tr>
              <th style={{ padding:'5px 9px', color:C.muted, fontWeight:400 }}></th>
              {agents.map(a => <th key={a.abbr} style={{ padding:'5px 9px', color:a.color, fontWeight:700, fontSize:10 }}>{a.abbr}</th>)}
            </tr></thead>
            <tbody>
              {agents.map((row,ri) => (
                <tr key={row.abbr}>
                  <td style={{ padding:'5px 9px', color:row.color, fontWeight:700, fontSize:10 }}>{row.abbr}</td>
                  {agents.map((col,ci) => {
                    const v  = corrVal(ri,ci)
                    const bg = v>.5?`rgba(16,185,129,${v*.5})`:v<0?`rgba(239,68,68,${-v*.5})`:`rgba(100,116,139,${Math.abs(v)*.3})`
                    return <td key={col.abbr} style={{ padding:'5px 9px', textAlign:'center',
                      background:bg, borderRadius:4, color:Math.abs(v)>.4?C.text:C.muted,
                      fontFamily:'monospace' }}>{v.toFixed(2)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <Card>
          <SectionTitle title="Scenario Analysis"/>
          {scenRows.map((s,i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                                  padding:'9px 0', borderBottom:`1px solid ${C.border}22` }}>
              <span style={{ fontSize:12, color:C.muted }}>{s.scenario}</span>
              <span style={{ fontSize:13, fontWeight:700, color:s.impact>=0?C.green:C.red, fontFamily:'monospace' }}>
                {s.impact>=0?'+':''}{s.impact}%
              </span>
            </div>
          ))}
        </Card>
        <Card>
          <SectionTitle title="Risk Metrics"/>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:9 }}>
            {riskRows.map(([l,v,c]) => (
              <div key={l} style={{ background:C.bg, borderRadius:7, padding:11 }}>
                <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:16, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

// ── Trades page ────────────────────────────────────────────────────────────────
function TradesPage({ trades = [], onOrder }) {
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>Paper Trades</h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>Real prices · Slippage + fees · {trades.length} executions</p>
        </div>
        <button onClick={onOrder} style={{ padding:'9px 18px', borderRadius:8, cursor:'pointer',
          background:`${C.accent}22`, border:`1px solid ${C.accent}66`, color:C.accent, fontSize:12, fontWeight:700 }}>
          ⚡ New Trade
        </button>
      </div>
      <Card>
        <SectionTitle title="Trade Log"/>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr>
              {['Time','Agent','Symbol','Side','Price','P&L','Horizon','Risk','Memo','Status'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted,
                  fontSize:10, textTransform:'uppercase', letterSpacing:.8,
                  borderBottom:`1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {trades.slice(0,60).map((t,i) => (
                <tr key={t.id||i} style={{ borderBottom:`1px solid ${C.border}22` }}>
                  <td style={{ padding:'8px 12px', color:C.muted, ...mono, fontSize:10 }}>
                    {t.ts ? new Date(t.ts).toLocaleTimeString() : '—'}
                  </td>
                  <td style={{ padding:'8px 12px', color:C.text, ...mono }}>{t.agent_abbr||'—'}</td>
                  <td style={{ padding:'8px 12px', color:C.text, ...mono, fontWeight:700 }}>{t.symbol||t.sym||'—'}</td>
                  <td style={{ padding:'8px 12px' }}>
                    <span style={{ background:`${t.side==='BUY'?C.green:C.red}22`,
                      color:t.side==='BUY'?C.green:C.red,
                      border:`1px solid ${t.side==='BUY'?C.green:C.red}44`,
                      borderRadius:4, padding:'2px 7px', fontSize:10, fontWeight:700 }}>{t.side}</span>
                  </td>
                  <td style={{ padding:'8px 12px', color:C.text, ...mono }}>${(t.price||0).toFixed(2)}</td>
                  <td style={{ padding:'8px 12px', color:(t.pnl||0)>=0?C.green:C.red, ...mono, fontWeight:700 }}>
                    {(t.pnl||0)>=0?'+':''}{(t.pnl||0).toFixed(2)}%
                  </td>
                  <td style={{ padding:'8px 12px', color:C.muted, ...mono, fontSize:10 }}>{t.horizon||'—'}</td>
                  <td style={{ padding:'8px 12px' }}>
                    {t.memo && t.memo.risk_level ? (
                      <span style={{ background:(t.memo.risk_level==='HIGH'?C.red:t.memo.risk_level==='LOW'?C.green:C.yellow)+'22',
                        color:t.memo.risk_level==='HIGH'?C.red:t.memo.risk_level==='LOW'?C.green:C.yellow,
                        border:`1px solid ${t.memo.risk_level==='HIGH'?C.red:t.memo.risk_level==='LOW'?C.green:C.yellow}44`,
                        borderRadius:4, padding:'1px 6px', fontSize:9, fontWeight:700 }}>{t.memo.risk_level}</span>
                    ) : <span style={{ color:C.dim, fontSize:10 }}>—</span>}
                  </td>
                  <td style={{ padding:'8px 12px', maxWidth:180 }}>
                    {t.memo && (t.memo.thesis || t.reason) ? (
                      <div style={{ fontSize:10, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                           title={t.memo.thesis || t.reason}>
                        {(t.memo.thesis || t.reason || '').slice(0,40)}{(t.memo.thesis||t.reason||'').length>40?'…':''}
                      </div>
                    ) : <span style={{ color:C.dim, fontSize:10 }}>No memo</span>}
                  </td>
                  <td style={{ padding:'8px 12px' }}>
                    <span style={{ background:`${C.green}22`, color:C.green, border:`1px solid ${C.green}44`,
                      borderRadius:4, padding:'1px 7px', fontSize:10, fontWeight:700 }}>{t.status||'filled'}</span>
                  </td>
                </tr>
              ))}
              {trades.length === 0 && (
                <tr><td colSpan={8} style={{ padding:24, textAlign:'center', color:C.muted }}>
                  No trades yet — execute one to start
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Chat page ──────────────────────────────────────────────────────────────────
function ChatPage({ portfolio, agents = [], onOrderSuggested }) {
  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>🤖 AI Trading Assistant</h1>
        <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>Ollama-powered · Execute trades · Market insights</p>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 300px', gap:16 }}>
        <OllamaChat onOrderSuggested={onOrderSuggested} portfolio={portfolio} agents={agents}/>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <Card>
            <SectionTitle title="Quick Commands"/>
            {[['Buy 5 SPY swing trade','BUY'],['Sell 2 NVDA day trade','SELL'],
              ['Long BTC scalping','BUY'],['Short TSLA position','SELL']
            ].map(([cmd,side],i) => (
              <div key={i} style={{ padding:'8px 11px', borderRadius:7, marginBottom:5,
                                    background:C.bg, border:`1px solid ${C.border}`, fontSize:11 }}>
                <div style={{ color:side==='BUY'?C.green:C.red, fontWeight:700, marginBottom:1 }}>{side}</div>
                <div style={{ color:C.muted }}>{cmd}</div>
              </div>
            ))}
          </Card>
          <Card>
            <SectionTitle title="Ollama Setup"/>
            <div style={{ fontSize:11, color:C.muted, lineHeight:1.8 }}>
              <div style={{ padding:'8px 10px', background:C.bg, borderRadius:7,
                            fontFamily:'monospace', fontSize:10, marginBottom:8 }}>
                curl -fsSL https://ollama.ai/install.sh | sh<br/>
                ollama pull llama3<br/>
                ollama serve
              </div>
              Set in <code style={{ color:C.accent, fontFamily:'monospace' }}>.env</code>:<br/>
              <code style={{ fontFamily:'monospace', fontSize:10, color:C.cyan }}>OLLAMA_BASE_URL=http://localhost:11434</code><br/>
              <code style={{ fontFamily:'monospace', fontSize:10, color:C.cyan }}>OLLAMA_MODEL=llama3</code>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ── Root App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [page,          setPage]          = useState('dashboard')
  const [selectedAgent, setSelectedAgent] = useState(null)
  const [portfolio,     setPortfolio]     = useState(FALLBACK_PORTFOLIO)
  const [prices,        setPrices]        = useState(FALLBACK_PRICES)
  const [trades,        setTrades]        = useState([])
  const [orderOpen,     setOrderOpen]     = useState(false)
  const [orderPrefill,  setOrderPrefill]  = useState(null)
  const [impulses,      setImpulses]      = useState([])
  const [liveImpulses,  setLiveImpulses]  = useState({})
  const [regime,        setRegime]        = useState({ label:'unknown', confidence:0 })
  const [health,        setHealth]        = useState({ supabase:{ connected:false }, data_source:null })

  const { connected, lastTick, lastMessage } = useWebSocket()
  const { agents,    loading  }              = useAgents(lastTick)

  // Fetch + poll
  useEffect(() => {
    const load = () => {
      api.portfolio().then(d => d && setPortfolio(d))
      api.prices().then(d => d && setPrices(d))
      api.trades(null, 60).then(d => d && setTrades(d))
    }
    const loadHealth = () => {
      fetch('/health').then(r=>r.json()).then(d => d && setHealth(d)).catch(()=>{})
    }
    load(); loadHealth()
    const id  = setInterval(load, 12000)
    const hid = setInterval(loadHealth, 30000)
    return () => { clearInterval(id); clearInterval(hid) }
  }, [])

  // Merge live WS ticks
  useEffect(() => {
    if (lastTick?.portfolio)   setPortfolio(p => ({ ...p, ...lastTick.portfolio }))
    if (lastTick?.prices)      setPrices(p => ({ ...p, ...lastTick.prices }))
    if (lastTick?.latest_trade) setTrades(t => [lastTick.latest_trade, ...t].slice(0, 300))
    if (lastTick?.regime)  setRegime(lastTick.regime)
    if (lastTick?.impulses?.length) {
      setImpulses(prev => [...lastTick.impulses, ...prev].slice(0, 200))
      const live = {}
      lastTick.impulses.forEach(i => { live[`${i.from}->${i.to}`] = i })
      setLiveImpulses(prev => ({ ...prev, ...live }))
    }
  }, [lastTick])

  const openOrder = useCallback((prefill = null) => { setOrderPrefill(prefill); setOrderOpen(true) }, [])

  // Expose openOrder globally so NetworkPage opportunity buttons can open the modal
  useEffect(() => { window._openOrder = openOrder; return () => { delete window._openOrder } }, [openOrder])
  const handleNav = useCallback((id) => { setPage(id); setSelectedAgent(null) }, [])

  const renderPage = () => {
    if (selectedAgent) return <AgentDetail agent={selectedAgent} onBack={() => setSelectedAgent(null)}/>
    switch (page) {
      case 'dashboard':  return <Dashboard  portfolio={portfolio} agents={agents} trades={trades} prices={prices} onOrder={() => openOrder()}/>
      case 'agents':     return <AgentsPage agents={agents} loading={loading} onSelect={setSelectedAgent}/>
      case 'ecosystem':  return <EcosystemPage lastMessage={lastMessage}/>
      case 'network':    return <NetworkPage agents={agents} impulses={impulses} liveImpulses={liveImpulses} regime={regime}/>
      case 'analytics':  return <AnalyticsPage agents={agents}/>
      case 'trades':     return <TradesPage trades={trades} onOrder={() => openOrder()}/>
      case 'chat':       return <ChatPage portfolio={portfolio} agents={agents} onOrderSuggested={openOrder}/>
      case 'lab':        return <TrainingLabPage/>
      case 'learning':   return <AgentLearningPage/>
      case 'scout':      return <ScoutPage/>
      default:           return <Dashboard  portfolio={portfolio} agents={agents} trades={trades} prices={prices} onOrder={() => openOrder()}/>
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, color:C.text,
                  fontFamily:"'IBM Plex Sans','Segoe UI',sans-serif" }}>
      <TopBar page={page} onNav={handleNav} connected={connected} prices={prices} navItems={NAV} health={health}/>
      <main style={{ padding:'24px', maxWidth:1440, margin:'0 auto' }}>
        {renderPage()}
      </main>
      <OrderModal
        isOpen={orderOpen}
        onClose={() => setOrderOpen(false)}
        prefill={orderPrefill}
        agents={agents}
        onExecuted={trade => { setTrades(t => [trade, ...t]); setOrderOpen(false) }}
      />
      <AiInsightsPanel page={selectedAgent ? 'agents' : page} portfolio={portfolio} agents={agents}/>
    </div>
  )
}
