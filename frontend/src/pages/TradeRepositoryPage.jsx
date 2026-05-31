/**
 * TradeRepositoryPage — 4 tabs:
 *   Trades     — filtered searchable trade list with full memo
 *   Analytics  — per-agent deep metrics: equity curve, drawdown, P&L by tag
 *   Strategy   — side-by-side agent comparison leaderboard
 *   Backtests  — run IS/OOS, Walk-Forward, Monte Carlo on many tickers + LLM post-mortem
 */
import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ScatterChart, Scatter, ReferenceLine,
} from 'recharts'
import { C, Card, SectionTitle, Badge, ProgressBar, Spinner, TT, pct, mono } from '../components/UI'
import api from '../lib/api'

const TABS = [
  { id:'trades',    label:'Trade Log',   icon:'📋' },
  { id:'analytics', label:'Analytics',   icon:'📊' },
  { id:'strategy',  label:'Strategy',    icon:'🏆' },
  { id:'backtest',  label:'Backtesting', icon:'🔬' },
]

const HORIZONS    = ['scalping','day','swing','position']
const RISK_LEVELS = ['LOW','MEDIUM','HIGH']
const SIDES       = ['BUY','SELL','HOLD']
const AGENTS      = ['MOM','MRV','PPO','DQN','MAC','SEN','VOL','REG','OPT','SCOUT']
const AGENT_CLR   = {MOM:C.cyan,MRV:C.purple,PPO:C.accent,DQN:'#ec4899',MAC:C.yellow,
                     SEN:'#f97316',VOL:C.red,REG:'#14b8a6',OPT:C.green,SCOUT:C.pink}

const BT_SYMBOLS = ['SPY','QQQ','AAPL','MSFT','NVDA','META','TSLA','AMZN','GLD','TLT',
                    'IWM','EEM','XLE','XLF','AMD','JPM','V','COST','WMT','NFLX']

// ── Small helpers ─────────────────────────────────────────────────────────────
function Chip({ label, value, color = C.text, sub }) {
  return (
    <div style={{ background:C.bg, borderRadius:8, padding:'10px 14px',
                  border:`1px solid ${C.border}`, minWidth:110 }}>
      <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase',
                    letterSpacing:1, marginBottom:4 }}>{label}</div>
      <div className="num" style={{ fontSize:17, fontWeight:800, color }}>{value}</div>
      {sub && <div style={{ fontSize:9, color:C.dim, marginTop:2 }}>{sub}</div>}
    </div>
  )
}

function OutcomeTag({ outcome }) {
  const c = outcome === 'WIN' ? C.green : outcome === 'LOSS' ? C.red : C.yellow
  return (
    <span style={{ background:`${c}18`, color:c, border:`1px solid ${c}44`,
                   borderRadius:4, padding:'2px 7px', fontSize:9, fontWeight:700 }}>
      {outcome}
    </span>
  )
}

// ── Tab 1: Trade Log ──────────────────────────────────────────────────────────
function TradesTab() {
  const [trades,   setTrades]   = useState([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(false)
  const [selected, setSelected] = useState(null)
  const [offset,   setOffset]   = useState(0)
  const [filters,  setFilters]  = useState({
    agent:'', symbol:'', horizon:'', side:'', risk_level:'',
    tag:'', search:'', has_memo:undefined,
    from_date:'', to_date:'', min_pnl:'', max_pnl:'',
  })
  const LIMIT = 50

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    const params = new URLSearchParams({ limit: LIMIT, offset: off })
    Object.entries(filters).forEach(([k,v]) => { if (v !== '' && v !== undefined) params.set(k, v) })
    const r = await api.get(`/api/repository/trades?${params}`)
    if (r) { setTrades(r.trades || []); setTotal(r.total || 0) }
    setOffset(off)
    setLoading(false)
  }, [filters])

  useEffect(() => { load(0) }, [filters])

  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const clearFilters = () => setFilters({ agent:'', symbol:'', horizon:'', side:'',
    risk_level:'', tag:'', search:'', has_memo:undefined,
    from_date:'', to_date:'', min_pnl:'', max_pnl:'' })

  const inpStyle = {
    background: C.bg, border:`1px solid ${C.border}`, borderRadius:6,
    color: C.text, padding:'5px 9px', fontSize:11, outline:'none',
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:16 }}>
      {/* Left: filters + table */}
      <div>
        {/* Filter strip */}
        <Card style={{ marginBottom:12, padding:12 }}>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <input value={filters.search} onChange={e => setF('search', e.target.value)}
              placeholder="🔍 Search thesis, symbol, agent..."
              style={{ ...inpStyle, minWidth:200, flex:1 }}/>
            {[['Agent',AGENTS,'agent'],['Horizon',HORIZONS,'horizon'],
              ['Side',SIDES,'side'],['Risk',RISK_LEVELS,'risk_level']].map(([l,opts,k]) => (
              <select key={k} value={filters[k]} onChange={e => setF(k, e.target.value)}
                style={{ ...inpStyle }}>
                <option value="">All {l}</option>
                {opts.map(o => <option key={o}>{o}</option>)}
              </select>
            ))}
            <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:C.muted }}>
              <input type="checkbox" checked={filters.has_memo === true}
                onChange={e => setF('has_memo', e.target.checked ? true : undefined)}/>
              Memo only
            </label>
            <button onClick={clearFilters} style={{ padding:'5px 10px', borderRadius:6,
              background:`${C.red}18`, border:`1px solid ${C.red}33`, color:C.red,
              fontSize:10, cursor:'pointer' }}>✕ Clear</button>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
            {[['from_date','From','date'],['to_date','To','date'],
              ['min_pnl','Min P&L','number'],['max_pnl','Max P&L','number'],
              ['symbol','Symbol','text']].map(([k,l,t]) => (
              <div key={k} style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ fontSize:10, color:C.dim }}>{l}:</span>
                <input type={t} value={filters[k]} onChange={e => setF(k, e.target.value)}
                  style={{ ...inpStyle, width:t==='date'?120:80 }}/>
              </div>
            ))}
          </div>
        </Card>

        {/* Stats row */}
        <div style={{ display:'flex', gap:5, alignItems:'center', marginBottom:10 }}>
          <span style={{ fontSize:11, color:C.muted }}>{total} trades found</span>
          {offset > 0 && (
            <button onClick={() => load(offset - LIMIT)}
              style={{ padding:'3px 8px', borderRadius:5, background:C.surface,
                border:`1px solid ${C.border}`, color:C.muted, fontSize:10, cursor:'pointer' }}>
              ← Prev
            </button>
          )}
          {offset + LIMIT < total && (
            <button onClick={() => load(offset + LIMIT)}
              style={{ padding:'3px 8px', borderRadius:5, background:C.surface,
                border:`1px solid ${C.border}`, color:C.muted, fontSize:10, cursor:'pointer' }}>
              Next →
            </button>
          )}
          <span style={{ fontSize:10, color:C.dim, marginLeft:'auto' }}>
            {offset+1}–{Math.min(offset+LIMIT, total)} of {total}
          </span>
        </div>

        {/* Table */}
        <Card style={{ padding:0, overflow:'hidden' }}>
          {loading ? <div style={{ padding:40, textAlign:'center' }}><Spinner/></div> : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ background:C.surface }}>
                  {['Time','Agent','Sym','Side','Fill','P&L','Outcome','R:R','Memo','Tags'].map(h => (
                    <th key={h} style={{ textAlign:'left', padding:'7px 11px',
                      color:C.muted, fontSize:9, textTransform:'uppercase', letterSpacing:.8,
                      borderBottom:`1px solid ${C.border}`, whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((t,i) => {
                  const pnl  = t.pnl || 0
                  const pc   = pnl >= 0 ? C.green : C.red
                  const aclr = AGENT_CLR[t.agent_abbr] || C.accent
                  const memo = t.memo || {}
                  const tags = memo.tags || []
                  return (
                    <tr key={i} onClick={() => setSelected(t)}
                      style={{ borderBottom:`1px solid ${C.border}18`, cursor:'pointer',
                        background: selected?.id===t.id ? `${C.accent}08` : i%2===0?'transparent':C.bg }}>
                      <td style={{ padding:'7px 11px', color:C.dim, whiteSpace:'nowrap', fontSize:9 }}>
                        {(t.ts||'').slice(0,16).replace('T',' ')}
                      </td>
                      <td style={{ padding:'7px 11px' }}>
                        <span className="num" style={{ color:aclr, fontWeight:700, fontSize:10 }}>{t.agent_abbr}</span>
                      </td>
                      <td style={{ padding:'7px 11px' }}>
                        <span className="num" style={{ color:C.text, fontWeight:700 }}>{t.symbol}</span>
                      </td>
                      <td style={{ padding:'7px 11px' }}>
                        <span style={{ color:t.side==='BUY'?C.green:t.side==='SELL'?C.red:C.muted,
                                       fontWeight:700 }}>{t.side}</span>
                      </td>
                      <td style={{ padding:'7px 11px', fontFamily:'monospace' }}>${(t.price||0).toFixed(2)}</td>
                      <td style={{ padding:'7px 11px' }}>
                        <span className="num" style={{ color:pc, fontWeight:700 }}>
                          {pnl>=0?'+':''}{pnl.toFixed(2)}
                        </span>
                      </td>
                      <td style={{ padding:'7px 11px' }}><OutcomeTag outcome={t.outcome}/></td>
                      <td style={{ padding:'7px 11px', fontFamily:'monospace', color:C.muted }}>
                        {t.rr_ratio ? `${t.rr_ratio}:1` : '—'}
                      </td>
                      <td style={{ padding:'7px 11px' }}>
                        {(memo.thesis || memo.signal_source) ? (
                          <div style={{ fontSize:9, color:C.muted, maxWidth:140,
                                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {memo.thesis || memo.signal_source}
                          </div>
                        ) : <span style={{ color:C.dim, fontSize:9 }}>—</span>}
                      </td>
                      <td style={{ padding:'7px 11px' }}>
                        <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                          {tags.slice(0,2).map(tag => (
                            <span key={tag} style={{ fontSize:8, padding:'1px 5px',
                              borderRadius:3, background:`${C.accent}15`, color:C.accent }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!trades.length && (
                  <tr><td colSpan={10} style={{ padding:32, textAlign:'center', color:C.muted }}>
                    No trades match the current filters
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </Card>
      </div>

      {/* Right: trade detail */}
      <div style={{ position:'sticky', top:78, alignSelf:'start' }}>
        {selected ? (
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12 }}>
              <span style={{ fontSize:13, fontWeight:800, color:C.text }}>Trade Detail</span>
              <button onClick={() => setSelected(null)}
                style={{ background:'none', border:'none', color:C.muted, cursor:'pointer' }}>✕</button>
            </div>
            {/* Header */}
            <div style={{ padding:'12px 14px', borderRadius:9, marginBottom:12,
              background:`${selected.side==='BUY'?C.green:C.red}12`,
              border:`1px solid ${selected.side==='BUY'?C.green:C.red}44` }}>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <div>
                  <span className="num" style={{ fontSize:20, fontWeight:900,
                    color:selected.side==='BUY'?C.green:C.red }}>{selected.side}</span>
                  <span className="num" style={{ fontSize:16, fontWeight:700,
                    color:C.text, marginLeft:10 }}>{selected.symbol}</span>
                </div>
                <OutcomeTag outcome={selected.outcome}/>
              </div>
              <div className="num" style={{ fontSize:22, fontWeight:900,
                color:(selected.pnl||0)>=0?C.green:C.red, marginTop:6 }}>
                {(selected.pnl||0)>=0?'+':''}{(selected.pnl||0).toFixed(4)}
              </div>
            </div>
            {/* Fields */}
            {[
              ['Agent',      selected.agent_abbr],
              ['Fill Price', `$${(selected.price||0).toFixed(4)}`],
              ['Notional',   `$${(selected.notional||0).toFixed(2)}`],
              ['Fee',        `$${(selected.fee||0).toFixed(4)}`],
              ['R:R Ratio',  selected.rr_ratio ? `${selected.rr_ratio}:1` : '—'],
              ['Hold Time',  selected.hold_hours ? `${selected.hold_hours}h` : '—'],
              ['Horizon',    selected.horizon || '—'],
              ['Confidence', selected.confidence ? `${(selected.confidence*100).toFixed(0)}%` : '—'],
            ].map(([l,v]) => (
              <div key={l} style={{ display:'flex', justifyContent:'space-between',
                padding:'5px 0', borderBottom:`1px solid ${C.border}18`, fontSize:11 }}>
                <span style={{ color:C.muted }}>{l}</span>
                <span className="num" style={{ color:C.text }}>{v}</span>
              </div>
            ))}
            {/* Memo */}
            {selected.memo && (
              <div style={{ marginTop:12, padding:'10px 12px', background:C.bg,
                borderRadius:8, border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.accent, marginBottom:7 }}>
                  📝 Trade Memo
                </div>
                {selected.memo.thesis && (
                  <p style={{ fontSize:11, color:C.text, lineHeight:1.6, marginBottom:8,
                               fontStyle:'italic' }}>"{selected.memo.thesis}"</p>
                )}
                {[['Signal',  selected.memo.signal_source],
                  ['Context', selected.memo.market_context],
                  ['Stop',    selected.memo.stop_loss_price   ? `$${selected.memo.stop_loss_price}`   : null],
                  ['Target',  selected.memo.take_profit_price ? `$${selected.memo.take_profit_price}` : null],
                  ['Risk',    selected.memo.risk_level]].filter(([,v])=>v).map(([l,v]) => (
                  <div key={l} style={{ display:'flex', gap:6, marginBottom:3, fontSize:10 }}>
                    <span style={{ color:C.dim, minWidth:52 }}>{l}:</span>
                    <span style={{ color:C.muted }}>{v}</span>
                  </div>
                ))}
                {(selected.memo.tags||[]).length > 0 && (
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:7 }}>
                    {selected.memo.tags.map(t => (
                      <span key={t} style={{ fontSize:9, padding:'2px 7px', borderRadius:4,
                        background:`${C.accent}18`, color:C.accent }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <div style={{ padding:'40px 20px', textAlign:'center' }}>
              <div style={{ fontSize:32, marginBottom:10 }}>📋</div>
              <div style={{ color:C.text, fontWeight:600, marginBottom:6 }}>Select a trade</div>
              <div style={{ color:C.muted, fontSize:11 }}>Click any row to see full detail and memo</div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// ── Tab 2: Analytics ──────────────────────────────────────────────────────────
function AnalyticsTab() {
  const [selectedAgent, setSelectedAgent] = useState('MOM')
  const [data,    setData]    = useState(null)
  const [portfolio, setPortfolio] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.get('/api/repository/portfolio').then(d => d && setPortfolio(d))
  }, [])

  useEffect(() => {
    setLoading(true)
    api.get(`/api/repository/agent/${selectedAgent}`)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [selectedAgent])

  const eqData  = (data?.equity_curve   || []).map((v,i) => ({ i, v }))
  const ddData  = (data?.drawdown_series || []).map((v,i) => ({ i, v }))
  const tagData = Object.entries(data?.by_tag    || {}).map(([k,v]) => ({ name:k, pnl:v.pnl, count:v.count }))
  const symData = Object.entries(data?.by_symbol || {}).slice(0,8).map(([k,v]) => ({ name:k, pnl:v.pnl }))

  return (
    <div>
      {/* Portfolio summary */}
      {portfolio && (
        <Card style={{ marginBottom:16 }}>
          <SectionTitle title="Portfolio Analytics" sub="Across all agents"/>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:14 }}>
            {[
              ['Total Trades', portfolio.total_trades, C.text],
              ['Total P&L',    `${(portfolio.total_pnl||0)>=0?'+':''}${(portfolio.total_pnl||0).toFixed(2)}`, (portfolio.total_pnl||0)>=0?C.green:C.red],
              ['Win Rate',     `${(portfolio.win_rate||0).toFixed(1)}%`, C.green],
              ['Sharpe',       (portfolio.sharpe||0).toFixed(3),          C.cyan],
              ['Max DD',       `${(portfolio.max_drawdown||0).toFixed(1)}%`, C.red],
              ['Signal Acc.',  `${(portfolio.signal_accuracy||0).toFixed(1)}%`, C.accent],
            ].map(([l,v,c]) => <Chip key={l} label={l} value={v} color={c}/>)}
          </div>
          {/* P&L by horizon */}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {Object.entries(portfolio.by_horizon || {}).map(([h, d]) => (
              <div key={h} style={{ padding:'5px 12px', borderRadius:6, fontSize:10,
                background:`${C.accent}12`, border:`1px solid ${C.border}` }}>
                <span style={{ color:C.muted }}>{h}: </span>
                <span className="num" style={{ color:(d.pnl||0)>=0?C.green:C.red, fontWeight:700 }}>
                  {(d.pnl||0)>=0?'+':''}{(d.pnl||0).toFixed(2)}
                </span>
                <span style={{ color:C.dim }}> ({d.count} trades)</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Agent selector */}
      <div style={{ display:'flex', gap:5, marginBottom:16, flexWrap:'wrap' }}>
        {AGENTS.map(a => (
          <button key={a} onClick={() => setSelectedAgent(a)} style={{
            padding:'6px 12px', borderRadius:7, fontSize:11, cursor:'pointer',
            fontWeight: selectedAgent===a ? 700 : 400,
            background: selectedAgent===a ? `${AGENT_CLR[a]||C.accent}22` : C.surface,
            border:`1px solid ${selectedAgent===a ? (AGENT_CLR[a]||C.accent)+'66' : C.border}`,
            color: selectedAgent===a ? (AGENT_CLR[a]||C.accent) : C.muted,
          }}>{a}</button>
        ))}
      </div>

      {loading ? <Spinner/> : data && data.trades > 0 ? (
        <>
          {/* KPIs */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:16 }}>
            {[
              ['P&L Total',     `${(data.pnl_total||0)>=0?'+':''  }${(data.pnl_total||0).toFixed(2)}`,  (data.pnl_total||0)>=0?C.green:C.red],
              ['Win Rate',      `${(data.win_rate||0).toFixed(1)}%`,      C.green],
              ['Profit Factor', `${(data.profit_factor||0).toFixed(2)}x`, C.text],
              ['Sharpe',        (data.sharpe||0).toFixed(3),               C.cyan],
              ['Max DD',        `${(data.max_drawdown||0).toFixed(1)}%`,  C.red],
            ].map(([l,v,c]) => <Chip key={l} label={l} value={v} color={c}/>)}
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16, marginBottom:16 }}>
            {/* Equity curve */}
            <Card>
              <SectionTitle title={`${selectedAgent} Equity Curve`} sub="Cumulative P&L from trades"/>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={eqData}>
                  <defs>
                    <linearGradient id="eqG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={AGENT_CLR[selectedAgent]||C.accent} stopOpacity={.25}/>
                      <stop offset="95%" stopColor={AGENT_CLR[selectedAgent]||C.accent} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                  <XAxis dataKey="i" tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false}/>
                  <YAxis tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false} domain={['auto','auto']}/>
                  <Tooltip {...TT} formatter={v=>[v.toFixed(2),'Equity']}/>
                  <ReferenceLine y={100} stroke={C.border} strokeDasharray="3 3"/>
                  <Area type="monotone" dataKey="v" stroke={AGENT_CLR[selectedAgent]||C.accent}
                    strokeWidth={2} fill="url(#eqG)" dot={false} isAnimationActive={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* Rolling windows */}
            <Card>
              <SectionTitle title="Rolling Windows"/>
              {[['7 days', data.rolling_7d], ['30 days', data.rolling_30d], ['90 days', data.rolling_90d]].map(([l, r]) => (
                <div key={l} style={{ padding:'8px 0', borderBottom:`1px solid ${C.border}22` }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                    <span style={{ fontSize:10, color:C.muted }}>{l}</span>
                    <span className="num" style={{ fontSize:11, fontWeight:700,
                      color:(r?.pnl||0)>=0?C.green:C.red }}>
                      {(r?.pnl||0)>=0?'+':''}{(r?.pnl||0).toFixed(2)}
                    </span>
                  </div>
                  <div style={{ display:'flex', gap:8, fontSize:9, color:C.dim }}>
                    <span>{r?.trades} trades</span>
                    <span>{(r?.win_rate||0).toFixed(0)}% win</span>
                  </div>
                </div>
              ))}
            </Card>
          </div>

          {/* P&L by tag + by symbol */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <Card>
              <SectionTitle title="P&L by Tag" sub="Strategy tag breakdown"/>
              {tagData.length ? (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={tagData} layout="vertical" barSize={12}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false}/>
                    <XAxis type="number" tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false}/>
                    <YAxis dataKey="name" type="category" tick={{fontSize:9,fill:C.muted}} width={68} axisLine={false} tickLine={false}/>
                    <Tooltip {...TT} formatter={v=>[v.toFixed(2),'P&L']}/>
                    <Bar dataKey="pnl" radius={[0,3,3,0]}>
                      {tagData.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? C.green : C.red} fillOpacity={0.75}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div style={{ padding:'24px 0', textAlign:'center', color:C.muted, fontSize:11 }}>No tagged trades</div>}
            </Card>

            <Card>
              <SectionTitle title="P&L by Symbol" sub="Top 8 symbols"/>
              {symData.length ? (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={symData} barSize={18}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                    <XAxis dataKey="name" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                    <YAxis tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false}/>
                    <Tooltip {...TT} formatter={v=>[v.toFixed(2),'P&L']}/>
                    <ReferenceLine y={0} stroke={C.border}/>
                    <Bar dataKey="pnl" radius={[3,3,0,0]}>
                      {symData.map((entry,i) => (
                        <Cell key={i} fill={entry.pnl>=0?C.green:C.red} fillOpacity={0.75}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div style={{ padding:'24px 0', textAlign:'center', color:C.muted, fontSize:11 }}>No symbol data</div>}
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <div style={{ padding:'40px 0', textAlign:'center', color:C.muted }}>
            <div style={{ fontSize:32, marginBottom:10 }}>📊</div>
            <div>{selectedAgent} has no trades yet. Execute some paper trades to see analytics.</div>
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Tab 3: Strategy Comparison ────────────────────────────────────────────────
function StrategyTab() {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState('composite_score')

  useEffect(() => {
    setLoading(true)
    api.get('/api/repository/agents').then(d => { if (d) setRows(d) }).finally(() => setLoading(false))
  }, [])

  const sorted = [...rows].sort((a,b) => (b[sortKey]||0) - (a[sortKey]||0))

  const COLS = [
    { k:'rank',           l:'#',           w:30  },
    { k:'abbr',           l:'Agent',       w:60  },
    { k:'trades',         l:'Trades',      w:60  },
    { k:'pnl_total',      l:'P&L',         w:75  },
    { k:'win_rate',       l:'Win %',       w:65  },
    { k:'profit_factor',  l:'P. Factor',   w:75  },
    { k:'sharpe',         l:'Sharpe',      w:65  },
    { k:'max_drawdown',   l:'Max DD',      w:70  },
    { k:'rolling_30d_pnl',l:'30d P&L',     w:75  },
    { k:'memo_coverage',  l:'Memo %',      w:70  },
    { k:'composite_score',l:'Score',       w:70  },
  ]

  return (
    <div>
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <SectionTitle title="Strategy Leaderboard" sub="All agents ranked by composite score"/>
          <button onClick={() => { setLoading(true); api.get('/api/repository/agents').then(d=>{if(d)setRows(d)}).finally(()=>setLoading(false)) }}
            style={{ padding:'5px 12px', borderRadius:6, background:`${C.accent}18`,
              border:`1px solid ${C.accent}44`, color:C.accent, fontSize:10, cursor:'pointer' }}>
            ↺ Refresh
          </button>
        </div>
        {loading ? <Spinner/> : rows.length === 0 ? (
          <div style={{ padding:'40px 0', textAlign:'center', color:C.muted }}>
            <div style={{ fontSize:32, marginBottom:10 }}>🏆</div>
            Execute trades with multiple agents to see the leaderboard
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ background:C.surface }}>
                  {COLS.map(c => (
                    <th key={c.k} onClick={() => setSortKey(c.k)}
                      style={{ textAlign:'left', padding:'7px 11px', color:sortKey===c.k?C.accent:C.muted,
                        fontSize:9, textTransform:'uppercase', letterSpacing:.8,
                        borderBottom:`1px solid ${C.border}`, cursor:'pointer',
                        minWidth:c.w, whiteSpace:'nowrap' }}>
                      {c.l} {sortKey===c.k ? '▼' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r,i) => {
                  const aclr = AGENT_CLR[r.abbr] || C.accent
                  const pnlc = (r.pnl_total||0) >= 0 ? C.green : C.red
                  const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':''
                  return (
                    <tr key={r.abbr} style={{ borderBottom:`1px solid ${C.border}18`,
                      background: i===0?`${aclr}08`:'transparent' }}>
                      <td style={{ padding:'8px 11px', color:C.dim, fontFamily:'monospace' }}>{medal||r.rank}</td>
                      <td style={{ padding:'8px 11px' }}>
                        <span className="num" style={{ color:aclr, fontWeight:800 }}>{r.abbr}</span>
                      </td>
                      <td style={{ padding:'8px 11px', fontFamily:'monospace', color:C.muted }}>{r.trades}</td>
                      <td style={{ padding:'8px 11px' }}>
                        <span className="num" style={{ color:pnlc, fontWeight:700 }}>
                          {(r.pnl_total||0)>=0?'+':''}{(r.pnl_total||0).toFixed(2)}
                        </span>
                      </td>
                      <td style={{ padding:'8px 11px', fontFamily:'monospace', color:(r.win_rate||0)>=55?C.green:C.red }}>
                        {(r.win_rate||0).toFixed(1)}%
                      </td>
                      <td style={{ padding:'8px 11px', fontFamily:'monospace' }}>{(r.profit_factor||0).toFixed(2)}x</td>
                      <td style={{ padding:'8px 11px', fontFamily:'monospace', color:(r.sharpe||0)>=1?C.green:C.muted }}>
                        {(r.sharpe||0).toFixed(3)}
                      </td>
                      <td style={{ padding:'8px 11px', fontFamily:'monospace', color:C.red }}>{(r.max_drawdown||0).toFixed(1)}%</td>
                      <td style={{ padding:'8px 11px' }}>
                        <span className="num" style={{ color:(r.rolling_30d_pnl||0)>=0?C.green:C.red }}>
                          {(r.rolling_30d_pnl||0)>=0?'+':''}{(r.rolling_30d_pnl||0).toFixed(2)}
                        </span>
                      </td>
                      <td style={{ padding:'8px 11px' }}>
                        <ProgressBar value={r.memo_coverage||0} color={C.accent} height={4}/>
                        <span style={{ fontSize:9, color:C.dim }}>{(r.memo_coverage||0).toFixed(0)}%</span>
                      </td>
                      <td style={{ padding:'8px 11px' }}>
                        <span style={{ background:`${aclr}22`, color:aclr,
                          padding:'3px 10px', borderRadius:5, fontSize:10, fontWeight:700, fontFamily:'monospace' }}>
                          {(r.composite_score||0).toFixed(0)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Tab 4: Backtesting ─────────────────────────────────────────────────────────
function BacktestTab() {
  const [form, setForm] = useState({
    abbr: 'MOM', horizon: 'swing', mode: 'is_oos',
    n_folds: 5, n_sims: 500, multi: false,
    symbols: ['SPY','QQQ','AAPL','MSFT','NVDA','META','GLD','TLT','IWM','XLE'],
    single_symbol: 'SPY', capital: 10000,
  })
  const [result,  setResult]  = useState(null)
  const [running, setRunning] = useState(false)
  const [llmStatus, setLlmStatus] = useState(null)

  useEffect(() => {
    api.get('/api/llm/status').then(d => d && setLlmStatus(d))
  }, [])

  const setF = (k,v) => setForm(f => ({...f, [k]:v}))

  const run = async () => {
    setRunning(true); setResult(null)
    let r
    if (form.multi) {
      r = await api.post('/api/backtest/multi', {
        abbr: form.abbr, symbols: form.symbols, horizon: form.horizon,
        initial_capital: form.capital, mode: form.mode,
      })
    } else {
      r = await api.post('/api/backtest/run', {
        abbr: form.abbr, symbol: form.single_symbol, horizon: form.horizon,
        initial_capital: form.capital, mode: form.mode,
        n_folds: form.n_folds, n_sims: form.n_sims,
      })
    }
    if (r) setResult(r)
    setRunning(false)
  }

  const inpStyle = { background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                     color:C.text, padding:'7px 11px', fontSize:12, outline:'none', width:'100%' }

  return (
    <div>
      {/* LLM status */}
      {llmStatus && (
        <div style={{ marginBottom:14, padding:'8px 14px', borderRadius:8, fontSize:11,
          background:C.surface, border:`1px solid ${C.border}`,
          display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ color:C.muted, fontWeight:700 }}>🤖 LLM Provider:</span>
          {Object.entries(llmStatus.providers || {}).map(([name,s]) => (
            <span key={name} style={{ padding:'2px 8px', borderRadius:4,
              background:`${s.ok?C.green:C.red}18`, color:s.ok?C.green:C.red, fontSize:10,
              border:`1px solid ${s.ok?C.green:C.red}33` }}>
              {name} {s.ok ? '✓' : '✗'}
            </span>
          ))}
          <span style={{ marginLeft:'auto', color:C.cyan, fontSize:10 }}>
            Using: <strong>{llmStatus.recommendation}</strong>
          </span>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'300px 1fr', gap:16 }}>
        {/* Config panel */}
        <Card>
          <SectionTitle title="Backtest Config"/>

          {/* Agent */}
          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:10, color:C.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:.8 }}>Agent</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:3 }}>
              {AGENTS.map(a => (
                <button key={a} onClick={() => setF('abbr',a)} style={{
                  padding:'5px 0', borderRadius:5, cursor:'pointer', fontSize:9, fontWeight:700,
                  background: form.abbr===a ? `${AGENT_CLR[a]||C.accent}22` : C.surface,
                  border:`1px solid ${form.abbr===a?(AGENT_CLR[a]||C.accent)+'66':C.border}`,
                  color: form.abbr===a ? (AGENT_CLR[a]||C.accent) : C.muted,
                }}>{a}</button>
              ))}
            </div>
          </div>

          {/* Mode */}
          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:10, color:C.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:.8 }}>Mode</div>
            {[['is_oos','IS/OOS (70/30)'],['walk_forward','Walk-Forward'],['monte_carlo','Monte Carlo']].map(([id,label]) => (
              <button key={id} onClick={() => setF('mode',id)} style={{
                display:'block', width:'100%', marginBottom:4, padding:'7px 10px', borderRadius:7,
                cursor:'pointer', textAlign:'left', fontSize:11,
                background: form.mode===id ? `${C.accent}18` : C.surface,
                border:`1px solid ${form.mode===id?`${C.accent}55`:C.border}`,
                color: form.mode===id ? C.accent : C.muted,
              }}>{label}</button>
            ))}
          </div>

          {/* Horizon */}
          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:10, color:C.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:.8 }}>Horizon</div>
            <div style={{ display:'flex', gap:4 }}>
              {HORIZONS.map(h => (
                <button key={h} onClick={() => setF('horizon',h)} style={{
                  flex:1, padding:'5px 0', borderRadius:5, cursor:'pointer', fontSize:9,
                  background: form.horizon===h ? `${C.accent}22` : C.surface,
                  border:`1px solid ${form.horizon===h?`${C.accent}66`:C.border}`,
                  color: form.horizon===h ? C.accent : C.muted,
                }}>{h}</button>
              ))}
            </div>
          </div>

          {/* Multi-ticker toggle */}
          <div style={{ marginBottom:12 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
              <input type="checkbox" checked={form.multi} onChange={e => setF('multi',e.target.checked)}
                style={{ accentColor:C.accent }}/>
              <span style={{ fontSize:11, color:C.muted }}>Multi-ticker (run on all symbols below)</span>
            </label>
          </div>

          {/* Single symbol */}
          {!form.multi && (
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Symbol</div>
              <input value={form.single_symbol} onChange={e => setF('single_symbol', e.target.value.toUpperCase())}
                style={inpStyle}/>
            </div>
          )}

          {/* Symbol grid for multi */}
          {form.multi && (
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:5 }}>Symbols ({form.symbols.length})</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:3, maxHeight:120, overflowY:'auto' }}>
                {BT_SYMBOLS.map(s => {
                  const on = form.symbols.includes(s)
                  return (
                    <button key={s} onClick={() => setF('symbols',
                      on ? form.symbols.filter(x=>x!==s) : [...form.symbols,s])} style={{
                      padding:'2px 7px', borderRadius:4, cursor:'pointer', fontSize:9,
                      background: on ? `${C.accent}22` : C.surface,
                      border:`1px solid ${on?`${C.accent}55`:C.border}`,
                      color: on ? C.accent : C.muted,
                    }}>{s}</button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Walk-forward params */}
          {form.mode === 'walk_forward' && (
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Folds: {form.n_folds}</div>
              <input type="range" min={3} max={10} value={form.n_folds}
                onChange={e => setF('n_folds', +e.target.value)}
                style={{ width:'100%', accentColor:C.accent }}/>
            </div>
          )}

          {form.mode === 'monte_carlo' && (
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>Simulations: {form.n_sims}</div>
              <input type="range" min={100} max={1000} step={100} value={form.n_sims}
                onChange={e => setF('n_sims', +e.target.value)}
                style={{ width:'100%', accentColor:C.accent }}/>
            </div>
          )}

          <button onClick={run} disabled={running} style={{
            width:'100%', padding:'11px 0', borderRadius:9, cursor:'pointer',
            fontSize:13, fontWeight:800, border:'none', color:'white',
            background:`linear-gradient(135deg,${C.accent},${C.purple})`,
            opacity: running ? 0.5 : 1,
          }}>
            {running ? '⏳ Running…' : '🔬 Run Backtest'}
          </button>

          {running && (
            <div style={{ marginTop:10, fontSize:10, color:C.muted, textAlign:'center' }}>
              {form.multi ? `Scanning ${form.symbols.length} symbols…` :
               form.mode === 'monte_carlo' ? `Running ${form.n_sims} simulations…` :
               'Simulating strategy…'}
            </div>
          )}
        </Card>

        {/* Results */}
        <div>
          {!result && !running && (
            <Card>
              <div style={{ padding:'60px 20px', textAlign:'center' }}>
                <div style={{ fontSize:52, marginBottom:14 }}>🔬</div>
                <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>
                  Configure &amp; Run a Backtest
                </div>
                <div style={{ fontSize:11, color:C.muted, maxWidth:400, margin:'0 auto' }}>
                  IS/OOS splits data 70/30 to measure generalization.<br/>
                  Walk-Forward retrains on each fold for realistic simulation.<br/>
                  Monte Carlo bootstraps trade sequences for distribution analysis.
                </div>
              </div>
            </Card>
          )}

          {result && !result.error && (
            <>
              {/* IS/OOS results */}
              {result.mode === 'is_oos' && (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
                    {[['In-Sample', result.is, C.yellow],
                      ['Out-of-Sample', result.oos, C.accent],
                      ['Full Period', result.full, C.green]].map(([l,d,c]) => d && (
                      <Card key={l} glow={l==='Out-of-Sample'?C.accent:null}>
                        <div style={{ fontSize:10, fontWeight:700, color:c, marginBottom:10,
                                      textTransform:'uppercase', letterSpacing:.8 }}>{l}</div>
                        {[['Return', `${(d.total_return||0)>=0?'+':''}${(d.total_return||0).toFixed(2)}%`, d.total_return>=0?C.green:C.red],
                          ['Alpha',  `${(d.alpha||0)>=0?'+':''}${(d.alpha||0).toFixed(2)}%`, d.alpha>=0?C.green:C.red],
                          ['Sharpe', (d.sharpe||0).toFixed(3), C.cyan],
                          ['Max DD', `${(d.max_drawdown||0).toFixed(1)}%`, C.red],
                          ['Win %',  `${(d.win_rate||0).toFixed(1)}%`, C.green],
                        ].map(([lbl,val,vc]) => (
                          <div key={lbl} style={{ display:'flex', justifyContent:'space-between',
                            padding:'4px 0', borderBottom:`1px solid ${C.border}18`, fontSize:11 }}>
                            <span style={{ color:C.muted }}>{lbl}</span>
                            <span className="num" style={{ color:vc, fontWeight:700 }}>{val}</span>
                          </div>
                        ))}
                        <div style={{ marginTop:8, fontSize:9, color:C.dim }}>
                          {d.bars} bars · {d.total_trades} trades
                        </div>
                      </Card>
                    ))}
                  </div>

                  {/* Equity curves */}
                  {result.oos?.equity_curve && (
                    <Card style={{ marginBottom:16 }}>
                      <SectionTitle title="OOS Equity Curve" sub="Out-of-sample performance vs benchmark"/>
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={result.oos.equity_curve}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                          <XAxis dataKey="i" tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false}/>
                          <YAxis tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false} domain={['auto','auto']}/>
                          <Tooltip {...TT}/>
                          <Line type="monotone" dataKey="v" stroke={C.accent} strokeWidth={2} dot={false} name="Strategy" isAnimationActive={false}/>
                          <Line type="monotone" dataKey="bh" stroke={C.dim} strokeWidth={1.2} strokeDasharray="4 4" dot={false} name="B&H" isAnimationActive={false}/>
                        </LineChart>
                      </ResponsiveContainer>
                    </Card>
                  )}

                  <div style={{ display:'flex', gap:12, marginBottom:12, flexWrap:'wrap', fontSize:11 }}>
                    <div style={{ padding:'7px 12px', borderRadius:7, background:`${C.cyan}12`,
                      border:`1px solid ${C.cyan}33` }}>
                      IC: <span className="num" style={{ color:C.cyan }}>{result.ic||0}</span>
                    </div>
                    <div style={{ padding:'7px 12px', borderRadius:7,
                      background:`${result.generalization_score>=0.7?C.green:C.red}12`,
                      border:`1px solid ${result.generalization_score>=0.7?C.green:C.red}33` }}>
                      Generalization: <span className="num" style={{
                        color:result.generalization_score>=0.7?C.green:C.red }}>
                        {(result.generalization_score||0).toFixed(3)}
                      </span>
                      <span style={{ fontSize:9, color:C.dim, marginLeft:6 }}>
                        {result.generalization_score>=0.7 ? '(good)' : '(overfitted)'}
                      </span>
                    </div>
                  </div>
                </>
              )}

              {/* Walk-forward results */}
              {result.mode === 'walk_forward' && result.folds && (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:14 }}>
                    {[['Avg Return', `${(result.avg_return||0)>=0?'+':''}${(result.avg_return||0).toFixed(2)}%`, (result.avg_return||0)>=0?C.green:C.red],
                      ['Avg Sharpe', (result.avg_sharpe||0).toFixed(3), C.cyan],
                      ['Positive Folds', `${result.positive_folds}/${result.n_folds}`, result.positive_folds>=Math.ceil(result.n_folds/2)?C.green:C.red],
                      ['Avg Alpha', `${(result.avg_alpha||0)>=0?'+':''}${(result.avg_alpha||0).toFixed(2)}%`, (result.avg_alpha||0)>=0?C.green:C.red],
                    ].map(([l,v,c]) => <Chip key={l} label={l} value={v} color={c}/>)}
                  </div>
                  <Card>
                    <SectionTitle title="Fold Performance"/>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={result.folds.map((f,i) => ({ name:`F${i+1}`, ret:f.total_return, sharpe:f.sharpe }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                        <XAxis dataKey="name" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                        <YAxis tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false}/>
                        <Tooltip {...TT}/>
                        <ReferenceLine y={0} stroke={C.border}/>
                        <Bar dataKey="ret" radius={[3,3,0,0]} name="Return %">
                          {result.folds.map((f,i) => (
                            <Cell key={i} fill={f.total_return>=0?C.green:C.red} fillOpacity={0.75}/>
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </>
              )}

              {/* Monte Carlo */}
              {result.mode === 'monte_carlo' && (
                <>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:14 }}>
                    {[['Prob. Positive',`${result.prob_positive||0}%`, C.green],
                      ['Return Median',`${(result.return_median||0)>=0?'+':''}${(result.return_median||0).toFixed(1)}%`,(result.return_median||0)>=0?C.green:C.red],
                      ['VaR (95%)',    `${(result.return_var||0).toFixed(1)}%`, C.red],
                      ['DD P95',       `${(result.drawdown_p95||0).toFixed(1)}%`, C.red],
                    ].map(([l,v,c]) => <Chip key={l} label={l} value={v} color={c}/>)}
                  </div>
                  {result.distribution && (
                    <Card>
                      <SectionTitle title="Return Distribution" sub={`${result.n_sims} Monte Carlo simulations`}/>
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={(result.distribution.return_edges||[]).slice(0,-1).map((e,i)=>({
                          x: e.toFixed(1), count: result.distribution.return_hist[i] || 0
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                          <XAxis dataKey="x" tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false}/>
                          <YAxis tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false}/>
                          <Tooltip {...TT}/>
                          <Bar dataKey="count" fill={C.accent} fillOpacity={0.75} radius={[2,2,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    </Card>
                  )}
                </>
              )}

              {/* Multi-ticker results */}
              {result.mode && result.rows && (
                <Card>
                  <SectionTitle title={`Multi-Ticker: ${result.abbr} on ${result.symbols_tested} symbols`}
                    sub={`Best: ${result.best_symbol} · Avg Sharpe: ${result.avg_oos_sharpe}`}/>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                      <thead>
                        <tr style={{ background:C.surface }}>
                          {['Symbol','OOS Return','OOS Alpha','OOS Sharpe','Max DD','Win %','IC'].map(h => (
                            <th key={h} style={{ textAlign:'left', padding:'6px 10px', color:C.muted,
                              fontSize:9, textTransform:'uppercase', borderBottom:`1px solid ${C.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.filter(r => !r.error).sort((a,b) => (b.oos_sharpe||0)-(a.oos_sharpe||0)).map((r,i) => (
                          <tr key={i} style={{ borderBottom:`1px solid ${C.border}18` }}>
                            <td style={{ padding:'7px 10px', fontWeight:700, fontFamily:'monospace', color:C.text }}>{r.symbol}</td>
                            <td style={{ padding:'7px 10px' }}>
                              <span className="num" style={{ color:(r.oos_return||0)>=0?C.green:C.red, fontWeight:700 }}>
                                {(r.oos_return||0)>=0?'+':''}{(r.oos_return||0).toFixed(1)}%
                              </span>
                            </td>
                            <td style={{ padding:'7px 10px' }}>
                              <span className="num" style={{ color:(r.oos_alpha||0)>=0?C.green:C.red }}>
                                {(r.oos_alpha||0)>=0?'+':''}{(r.oos_alpha||0).toFixed(1)}%
                              </span>
                            </td>
                            <td style={{ padding:'7px 10px', fontFamily:'monospace', color:(r.oos_sharpe||0)>=1?C.green:C.muted }}>
                              {(r.oos_sharpe||0).toFixed(3)}
                            </td>
                            <td style={{ padding:'7px 10px', fontFamily:'monospace', color:C.red }}>{(r.oos_drawdown||0).toFixed(1)}%</td>
                            <td style={{ padding:'7px 10px', fontFamily:'monospace' }}>{(r.oos_win_rate||0).toFixed(1)}%</td>
                            <td style={{ padding:'7px 10px', fontFamily:'monospace', color:C.cyan }}>{(r.ic||0).toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {/* LLM post-mortem */}
              {(result.llm_postmortem || result.llm_comparison) && (
                <Card style={{ marginTop:14, border:`1px solid ${C.purple}44` }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                    <span style={{ fontSize:18 }}>🤖</span>
                    <span style={{ fontSize:12, fontWeight:700, color:C.purple }}>
                      LLM Analysis — {llmStatus?.recommendation || 'AI'}
                    </span>
                  </div>
                  <p style={{ fontSize:12, color:C.muted, lineHeight:1.8,
                               fontStyle:'italic', borderLeft:`3px solid ${C.purple}44`,
                               paddingLeft:12 }}>
                    "{result.llm_postmortem || result.llm_comparison}"
                  </p>
                </Card>
              )}
            </>
          )}

          {result?.error && (
            <Card>
              <div style={{ padding:'24px 0', textAlign:'center', color:C.red }}>
                ❌ {result.error}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Root page ─────────────────────────────────────────────────────────────────
export default function TradeRepositoryPage() {
  const [tab, setTab] = useState('trades')

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:900, margin:0 }}>📋 Trade Repository</h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>
            Full trade log · Strategy analytics · IS/OOS backtest · LLM commentary
          </p>
        </div>
      </div>

      {/* Tabs */}
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
          </button>
        ))}
      </div>

      {tab === 'trades'    && <TradesTab/>}
      {tab === 'analytics' && <AnalyticsTab/>}
      {tab === 'strategy'  && <StrategyTab/>}
      {tab === 'backtest'  && <BacktestTab/>}
    </div>
  )
}
