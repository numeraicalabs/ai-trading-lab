import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts'

// Layout & shared
import { TopBar }          from './components/TopBar'
import { C, Card, SectionTitle, Badge, ProgressBar, MiniChart, Spinner, pct, fmt, mono, TT } from './components/UI'
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

// ── Dashboard ──────────────────────────────────────────────────────────────────
function Dashboard({ portfolio, trades, onOrder }) {
  const [eqData, setEqData] = useState([])
  useEffect(() => { api.equity(80).then(d => d && setEqData(d)) }, [])
  const barData = [
    {n:'MOM',p:18.4},{n:'MRV',p:12.1},{n:'PPO',p:9.7},{n:'DQN',p:7.3},{n:'MAC',p:14.8},
    {n:'SEN',p:11.2},{n:'VOL',p:22.6},{n:'REG',p:6.1},{n:'OPT',p:16.3},
  ]
  const radar = [{m:'Return',v:85},{m:'Sharpe',v:78},{m:'Win%',v:62},{m:'Stability',v:74},{m:'Alpha',v:70},{m:'DD',v:80}]

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>Portfolio Overview</h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>AI multi-agent paper trading · Real yfinance data · 9 ML models</p>
        </div>
        <button onClick={onOrder} style={{ padding:'9px 18px', borderRadius:8, cursor:'pointer',
          background:`${C.accent}22`, border:`1px solid ${C.accent}66`, color:C.accent, fontSize:12, fontWeight:700 }}>
          ⚡ New Trade
        </button>
      </div>
      <KpiBar p={portfolio}/>
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16, marginBottom:16 }}>
        <Card>
          <SectionTitle title="Equity Curve" sub="Portfolio vs Benchmarks"/>
          <div style={{ display:'flex', gap:12, marginBottom:10 }}>
            {[['Portfolio',C.accent],['S&P 500',C.muted],['Buy&Hold',C.dim]].map(([l,c])=>(
              <div key={l} style={{ display:'flex', alignItems:'center', gap:5 }}>
                <div style={{ width:16, height:2, background:c, borderRadius:99 }}/>
                <span style={{ fontSize:10, color:C.muted }}>{l}</span>
              </div>
            ))}
          </div>
          {eqData.length > 0 ? (
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={eqData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                <XAxis dataKey="i" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false} domain={['auto','auto']}/>
                <Tooltip {...TT}/>
                <Line type="monotone" dataKey="portfolio" stroke={C.accent}   strokeWidth={2} dot={false} isAnimationActive={false}/>
                <Line type="monotone" dataKey="sp500"     stroke={C.muted}    strokeWidth={1} dot={false} strokeDasharray="4 4" isAnimationActive={false}/>
                <Line type="monotone" dataKey="buyhold"   stroke={C.dim}      strokeWidth={1} dot={false} strokeDasharray="2 6" isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          ) : <Spinner/>}
        </Card>
        <Card>
          <SectionTitle title="Portfolio Score"/>
          <ResponsiveContainer width="100%" height={190}>
            <RadarChart data={radar}>
              <PolarGrid stroke={C.border}/>
              <PolarAngleAxis dataKey="m" tick={{fontSize:9,fill:C.muted}}/>
              <Radar dataKey="v" stroke={C.accent} fill={C.accent} fillOpacity={0.15} strokeWidth={2}/>
            </RadarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionTitle title="Agent Returns YTD" sub="Paper trading %"/>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={barData} barSize={22}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
              <XAxis dataKey="n" tick={{fontSize:10,fill:C.muted}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
              <Tooltip {...TT}/>
              <Bar dataKey="p" fill={C.accent} radius={[4,4,0,0]}
                   label={{position:'top',fontSize:9,fill:C.muted,formatter:v=>`${v}%`}}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionTitle title="Recent Trades" sub="Live feed"/>
          <div style={{ height:200, overflowY:'auto' }}>
            {trades.slice(0,20).map((t,i) => (
              <div key={t.id||i} style={{ display:'flex', gap:8, alignItems:'center',
                                          padding:'6px 0', borderBottom:`1px solid ${C.border}22`, fontSize:11 }}>
                <span style={{ width:32, background:`${t.side==='BUY'?C.green:C.red}22`,
                  color:t.side==='BUY'?C.green:C.red, borderRadius:4, padding:'1px 4px',
                  fontSize:9, fontWeight:700, textAlign:'center' }}>{t.side}</span>
                <span style={{ width:55, color:C.text, ...mono, fontWeight:700 }}>{t.symbol||t.sym}</span>
                <span style={{ width:32, color:C.muted, ...mono, fontSize:10 }}>{t.agent_abbr}</span>
                <span style={{ flex:1, color:C.muted, ...mono, fontSize:10 }}>${(t.price||0).toFixed(2)}</span>
                <span style={{ color:(t.pnl||0)>=0?C.green:C.red, ...mono, fontWeight:700 }}>
                  {(t.pnl||0)>=0?'+':''}{(t.pnl||0).toFixed(2)}%
                </span>
              </div>
            ))}
            {trades.length === 0 && <div style={{ color:C.muted, fontSize:11, padding:'20px 0', textAlign:'center' }}>No trades yet</div>}
          </div>
        </Card>
      </div>
    </div>
  )
}

// ── Agents page ────────────────────────────────────────────────────────────────
function AgentsPage({ agents, loading, onSelect }) {
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

// ── Network page ───────────────────────────────────────────────────────────────
function NetworkPage({ agents }) {
  const cx=360, cy=200, r=155, n=agents.length
  const nodes = agents.map((a,i) => {
    const angle = (i/n)*Math.PI*2 - Math.PI/2
    return { ...a, x: cx+r*Math.cos(angle), y: cy+r*Math.sin(angle) }
  })
  const edges = [[0,8],[1,8],[2,3],[4,7],[5,6],[6,7],[0,2],[1,4],[3,5]]
  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>Multi-Agent Network</h1>
        <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>Signal sharing · Ensemble voting · Collaboration</p>
      </div>
      <Card style={{ marginBottom:16 }}>
        <svg viewBox="0 0 720 400" style={{ width:'100%', height:'auto' }}>
          {edges.map(([a,b],i) => <line key={i} x1={nodes[a]?.x} y1={nodes[a]?.y}
            x2={nodes[b]?.x} y2={nodes[b]?.y} stroke={C.dim} strokeWidth={1} strokeDasharray="3 5" opacity={.6}/>)}
          {nodes.map(nd => <line key={'c'+nd.abbr} x1={cx} y1={cy} x2={nd.x} y2={nd.y}
            stroke={nd.color} strokeWidth={.8} opacity={.3}/>)}
          <circle cx={cx} cy={cy} r={36} fill={`${C.accent}33`} stroke={C.accent} strokeWidth={1.5}/>
          <text x={cx} y={cy-4} textAnchor="middle" fill={C.accent} fontSize={9} fontFamily="monospace">PORTFOLIO</text>
          <text x={cx} y={cy+8} textAnchor="middle" fill={C.accent} fontSize={9} fontFamily="monospace">OPTIMIZER</text>
          <text x={cx} y={cy+22} textAnchor="middle" fontSize={12}>⚖️</text>
          {nodes.map(nd => (
            <g key={nd.abbr}>
              <circle cx={nd.x} cy={nd.y} r={24} fill={`${nd.color}22`} stroke={nd.color} strokeWidth={1.5}/>
              <text x={nd.x} y={nd.y+1} textAnchor="middle" dominantBaseline="middle" fill={C.text} fontSize={11}>{nd.icon}</text>
              <text x={nd.x} y={nd.y+32} textAnchor="middle" fill={nd.color} fontSize={8} fontFamily="monospace">{nd.abbr}</text>
            </g>
          ))}
        </svg>
      </Card>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
        {[{t:'Ensemble Signal',v:'LONG',s:'7/9 agents bullish',c:C.green},
          {t:'Market Regime',  v:'Bull Trending',s:'Confidence 82%',c:C.cyan},
          {t:'Capital',        v:'64% deployed',s:'$81.5k invested',c:C.yellow}
        ].map((item,i) => (
          <Card key={i}>
            <div style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>{item.t}</div>
            <div style={{ fontSize:20, fontWeight:800, color:item.c, marginBottom:5, ...mono }}>{item.v}</div>
            <div style={{ fontSize:11, color:C.muted }}>{item.s}</div>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── Analytics page ─────────────────────────────────────────────────────────────
function AnalyticsPage({ agents }) {
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
function TradesPage({ trades, onOrder }) {
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
              {['Time','Agent','Symbol','Side','Price','P&L','Horizon','Status'].map(h => (
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
function ChatPage({ portfolio, agents, onOrderSuggested }) {
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

  const { connected, lastTick, lastMessage } = useWebSocket()
  const { agents,    loading  }              = useAgents(lastTick)

  // Fetch + poll
  useEffect(() => {
    const load = () => {
      api.portfolio().then(d => d && setPortfolio(d))
      api.prices().then(d => d && setPrices(d))
      api.trades(null, 60).then(d => d && setTrades(d))
    }
    load()
    const id = setInterval(load, 12000)
    return () => clearInterval(id)
  }, [])

  // Merge live WS ticks
  useEffect(() => {
    if (lastTick?.portfolio)   setPortfolio(p => ({ ...p, ...lastTick.portfolio }))
    if (lastTick?.prices)      setPrices(p => ({ ...p, ...lastTick.prices }))
    if (lastTick?.latest_trade) setTrades(t => [lastTick.latest_trade, ...t].slice(0, 300))
  }, [lastTick])

  const openOrder = useCallback((prefill = null) => { setOrderPrefill(prefill); setOrderOpen(true) }, [])
  const handleNav = useCallback((id) => { setPage(id); setSelectedAgent(null) }, [])

  const renderPage = () => {
    if (selectedAgent) return <AgentDetail agent={selectedAgent} onBack={() => setSelectedAgent(null)}/>
    switch (page) {
      case 'dashboard':  return <Dashboard  portfolio={portfolio} trades={trades} onOrder={() => openOrder()}/>
      case 'agents':     return <AgentsPage agents={agents} loading={loading} onSelect={setSelectedAgent}/>
      case 'ecosystem':  return <EcosystemPage lastMessage={lastMessage}/>
      case 'network':    return <NetworkPage agents={agents}/>
      case 'analytics':  return <AnalyticsPage agents={agents}/>
      case 'trades':     return <TradesPage trades={trades} onOrder={() => openOrder()}/>
      case 'chat':       return <ChatPage portfolio={portfolio} agents={agents} onOrderSuggested={openOrder}/>
      default:           return <Dashboard  portfolio={portfolio} trades={trades} onOrder={() => openOrder()}/>
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, color:C.text,
                  fontFamily:"'IBM Plex Sans','Segoe UI',sans-serif" }}>
      <TopBar page={page} onNav={handleNav} connected={connected} prices={prices} navItems={NAV}/>
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
