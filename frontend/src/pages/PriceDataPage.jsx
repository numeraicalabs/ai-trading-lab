/**
 * PriceDataPage — Manage price history for 200+ tickers:
 *   Universe     — browse/add/remove symbols by sector
 *   Data Cache   — status of local cache per symbol
 *   Bulk Fetch   — download & store OHLCV for all symbols
 *   Price Chart  — mini chart for any symbol
 */
import { useState, useEffect, useCallback } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { C, Card, SectionTitle, Badge, ProgressBar, Spinner, TT } from '../components/UI'
import api from '../lib/api'

const SECTORS = ['ETF','Technology','Finance','Healthcare','Energy','Consumer',
                 'Discretionary','Industrial','Real Estate','Bonds','Commodities',
                 'Crypto','Volatility','Leveraged','International','Semis',
                 'Biotech','Communications','Utilities','Growth']

const HORIZONS = ['swing','day','scalping','position']

const mono = { fontFamily:"'JetBrains Mono','Fira Code',monospace" }

function SectorBadge({ sector }) {
  const COLORS = {
    ETF:'#3b82f6', Technology:'#06b6d4', Finance:'#10b981', Healthcare:'#22c55e',
    Energy:'#f97316', Consumer:'#f59e0b', Discretionary:'#f59e0b', Industrial:'#94a3b8',
    Bonds:'#8b5cf6', Commodities:'#f59e0b', Crypto:'#f0abfc', Volatility:'#ef4444',
    Semis:'#06b6d4', Biotech:'#10b981', Communications:'#3b82f6',
  }
  const c = COLORS[sector] || C.muted
  return (
    <span style={{ fontSize:8, padding:'1px 6px', borderRadius:3, fontWeight:700,
      background:`${c}18`, color:c, border:`1px solid ${c}33`, whiteSpace:'nowrap' }}>
      {sector}
    </span>
  )
}

export default function PriceDataPage() {
  const [universe,    setUniverse]    = useState({})
  const [cacheStats,  setCacheStats]  = useState(null)
  const [stored,      setStored]      = useState([])
  const [sectorFilter,setSectorFilter]= useState('')
  const [typeFilter,  setTypeFilter]  = useState('')
  const [search,      setSearch]      = useState('')
  const [horizon,     setHorizon]     = useState('swing')
  const [fetching,    setFetching]    = useState(false)
  const [fetchProgress,setFetchProgress] = useState(null)
  const [selectedSym, setSelectedSym] = useState(null)
  const [priceChart,  setPriceChart]  = useState(null)
  const [chartLoading,setChartLoading]= useState(false)
  const [section,     setSection]     = useState('universe')  // universe | cache | fetch
  const [newSym,      setNewSym]      = useState({ sym:'', name:'', sector:'Other', type:'stock' })
  const [adding,      setAdding]      = useState(false)

  const load = useCallback(async () => {
    const [u, cs, st] = await Promise.all([
      api.get('/api/universe'),
      api.get('/api/prices/cache/stats'),
      api.get('/api/prices/stored'),
    ])
    if (u?.universe) setUniverse(u.universe)
    else if (typeof u === 'object') setUniverse(u)
    if (cs)          setCacheStats(cs)
    if (st?.symbols) setStored(st.symbols)
  }, [])

  useEffect(() => { load() }, [load])

  const loadChart = async (sym) => {
    setSelectedSym(sym); setPriceChart(null); setChartLoading(true)
    const r = await api.get(`/api/prices/history/${sym}/${horizon}`)
    if (r?.data) {
      setPriceChart(r.data.map(d => ({ date:d.date, v:d.close })))
    }
    setChartLoading(false)
  }

  const runPrefetch = async (symbols) => {
    setFetching(true); setFetchProgress({ done:0, total:symbols.length, results:{} })
    const r = await api.post('/api/prices/prefetch', { symbols, horizon })
    if (r?.results) {
      const ok     = Object.values(r.results).filter(v=>['ok','cached'].includes(v)).length
      const errors = Object.values(r.results).filter(v=>v.startsWith('error')||v==='no_data').length
      setFetchProgress({ done:r.total, total:r.total, ok, errors, results:r.results })
    }
    setFetching(false)
    await load()
  }

  const addSymbol = async () => {
    if (!newSym.sym.trim()) return
    setAdding(true)
    await api.post('/api/universe/add', newSym)
    setNewSym({ sym:'', name:'', sector:'Other', type:'stock' })
    await load()
    setAdding(false)
  }

  const removeSymbol = async (sym) => {
    if (!window.confirm(`Remove ${sym} from universe?`)) return
    await api.post('/api/universe/remove', { symbol: sym })
    await load()
  }

  // Filtered universe
  const allSymbols = Object.entries(universe)
  const filtered   = allSymbols.filter(([sym, info]) => {
    if (sectorFilter && info.sector !== sectorFilter) return false
    if (typeFilter   && info.type   !== typeFilter)   return false
    if (search && !sym.toLowerCase().includes(search.toLowerCase()) &&
        !info.name?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const sectors     = [...new Set(allSymbols.map(([,i])=>i.sector))].sort()
  const storedSet   = new Set(stored.map(s=>`${s.symbol}_${s.horizon}`))
  const cachedLocal = cacheStats?.total_files || 0

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:900, margin:0 }}>📈 Price Data</h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>
            {allSymbols.length} tickers · {cachedLocal} locally cached · {stored.length} in Supabase Storage
          </p>
        </div>
        <div style={{ display:'flex', gap:7 }}>
          {HORIZONS.map(h => (
            <button key={h} onClick={() => setHorizon(h)} style={{
              padding:'5px 10px', borderRadius:7, fontSize:10, cursor:'pointer',
              background:horizon===h?`${C.accent}22`:C.surface,
              border:`1px solid ${horizon===h?`${C.accent}55`:C.border}`,
              color:horizon===h?C.accent:C.muted }}>
              {h}
            </button>
          ))}
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display:'flex', gap:5, marginBottom:20 }}>
        {[['universe','🌐 Universe'],['cache','💾 Cache'],['fetch','⬇️ Bulk Fetch']].map(([id,label])=>(
          <button key={id} onClick={()=>setSection(id)} style={{
            padding:'8px 16px', borderRadius:9, fontSize:12, cursor:'pointer',
            fontWeight:section===id?700:400,
            background:section===id?`${C.accent}22`:C.surface,
            border:`1px solid ${section===id?`${C.accent}66`:C.border}`,
            color:section===id?C.accent:C.muted }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Universe ──────────────────────────────────────────────────────── */}
      {section === 'universe' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:16 }}>
          <div>
            {/* Filters */}
            <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="🔍 Search symbol or name..."
                style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                  color:C.text, padding:'7px 11px', fontSize:12, outline:'none', flex:1 }}/>
              <select value={sectorFilter} onChange={e=>setSectorFilter(e.target.value)}
                style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                  color:C.muted, padding:'7px 10px', fontSize:11, outline:'none' }}>
                <option value="">All Sectors</option>
                {sectors.map(s=><option key={s}>{s}</option>)}
              </select>
              <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}
                style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                  color:C.muted, padding:'7px 10px', fontSize:11, outline:'none' }}>
                <option value="">All Types</option>
                {['stock','etf','crypto','index'].map(t=><option key={t}>{t}</option>)}
              </select>
              <span style={{ fontSize:11, color:C.muted, alignSelf:'center' }}>
                {filtered.length} / {allSymbols.length}
              </span>
            </div>

            {/* Sector quick-filter */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:12 }}>
              <button onClick={()=>setSectorFilter('')}
                style={{ padding:'3px 10px', borderRadius:20, cursor:'pointer', fontSize:9,
                  background:!sectorFilter?`${C.accent}22`:C.surface,
                  border:`1px solid ${!sectorFilter?`${C.accent}55`:C.border}`,
                  color:!sectorFilter?C.accent:C.muted }}>All</button>
              {sectors.map(s => (
                <button key={s} onClick={()=>setSectorFilter(s===sectorFilter?'':s)}
                  style={{ padding:'3px 10px', borderRadius:20, cursor:'pointer', fontSize:9,
                    background:sectorFilter===s?`${C.accent}22`:C.surface,
                    border:`1px solid ${sectorFilter===s?`${C.accent}55`:C.border}`,
                    color:sectorFilter===s?C.accent:C.muted }}>
                  {s}
                </button>
              ))}
            </div>

            {/* Symbol grid */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:6 }}>
              {filtered.map(([sym, info]) => {
                const isCached = storedSet.has(`${sym}_${horizon}`) ||
                                 storedSet.has(`${sym}_swing`)
                return (
                  <div key={sym}
                    onClick={() => loadChart(sym)}
                    style={{ background:selectedSym===sym?`${C.accent}12`:C.card,
                      border:`1px solid ${selectedSym===sym?`${C.accent}55`:C.border}`,
                      borderRadius:9, padding:'10px 12px', cursor:'pointer',
                      transition:'all .15s' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ ...mono, fontWeight:800, fontSize:13, color:C.text }}>{sym}</span>
                      <div style={{ display:'flex', gap:3, alignItems:'center' }}>
                        {isCached && (
                          <span style={{ fontSize:9, color:C.green }} title="Cached in Storage">💾</span>
                        )}
                        <button onClick={e=>{e.stopPropagation();removeSymbol(sym)}}
                          style={{ background:'none', border:'none', color:C.dim,
                            cursor:'pointer', fontSize:11, padding:0, lineHeight:1 }}>✕</button>
                      </div>
                    </div>
                    <div style={{ fontSize:10, color:C.muted, marginBottom:4,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {info.name}
                    </div>
                    <SectorBadge sector={info.sector}/>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right panel: chart + add */}
          <div style={{ position:'sticky', top:78, alignSelf:'start',
                        display:'flex', flexDirection:'column', gap:14 }}>
            {/* Price chart */}
            <Card>
              {!selectedSym ? (
                <div style={{ padding:'30px 0', textAlign:'center' }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>📈</div>
                  <div style={{ color:C.muted, fontSize:11 }}>Click a symbol to see price chart</div>
                </div>
              ) : chartLoading ? <Spinner/> : (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                    <span style={{ fontSize:13, fontWeight:800, color:C.accent, ...mono }}>
                      {selectedSym}
                    </span>
                    <button onClick={() => runPrefetch([selectedSym])}
                      style={{ padding:'3px 9px', borderRadius:5, cursor:'pointer', fontSize:9,
                        background:`${C.green}18`, border:`1px solid ${C.green}44`, color:C.green }}>
                      ⬇️ Cache
                    </button>
                  </div>
                  {priceChart && priceChart.length > 0 ? (
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={priceChart}>
                        <defs>
                          <linearGradient id="pcg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={C.accent} stopOpacity={.2}/>
                            <stop offset="95%" stopColor={C.accent} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                        <XAxis dataKey="date" tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false}
                               tickFormatter={d=>(d||'').slice(5)}/>
                        <YAxis tick={{fontSize:8,fill:C.muted}} tickLine={false} axisLine={false} domain={['auto','auto']}/>
                        <Tooltip {...TT} formatter={v=>[`$${v.toFixed(2)}`,'Close']}/>
                        <Area type="monotone" dataKey="v" stroke={C.accent} strokeWidth={2}
                              fill="url(#pcg)" dot={false} isAnimationActive={false}/>
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : <div style={{ color:C.muted, fontSize:11, textAlign:'center', padding:'20px 0' }}>No data cached — click ⬇️ Cache</div>}
                </>
              )}
            </Card>

            {/* Add symbol */}
            <Card>
              <SectionTitle title="Add Symbol"/>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  ['Ticker', 'sym',    'text',   'SPY'],
                  ['Name',   'name',   'text',   'S&P 500 ETF'],
                ].map(([l,k,t,ph]) => (
                  <div key={k}>
                    <div style={{ fontSize:9, color:C.muted, marginBottom:3, textTransform:'uppercase', letterSpacing:.8 }}>{l}</div>
                    <input type={t} value={newSym[k]} placeholder={ph}
                      onChange={e => setNewSym(s=>({...s,[k]:e.target.value}))}
                      style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`,
                        borderRadius:6, color:C.text, padding:'6px 9px', fontSize:12, outline:'none', ...mono }}/>
                  </div>
                ))}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                  {[['sector','Sector',SECTORS],['type','Type',['stock','etf','crypto','index']]].map(([k,l,opts])=>(
                    <div key={k}>
                      <div style={{ fontSize:9, color:C.muted, marginBottom:3, textTransform:'uppercase', letterSpacing:.8 }}>{l}</div>
                      <select value={newSym[k]} onChange={e=>setNewSym(s=>({...s,[k]:e.target.value}))}
                        style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:6,
                          color:C.muted, padding:'6px 8px', fontSize:11, outline:'none' }}>
                        {opts.map(o=><option key={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <button onClick={addSymbol} disabled={adding||!newSym.sym.trim()}
                  style={{ padding:'8px 0', borderRadius:7, cursor:'pointer', fontSize:12,
                    fontWeight:700, border:'none', color:'white',
                    background:`linear-gradient(135deg,${C.accent},${C.purple})`,
                    opacity:adding?0.5:1 }}>
                  {adding ? 'Adding…' : '+ Add Symbol'}
                </button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── Cache ─────────────────────────────────────────────────────────── */}
      {section === 'cache' && cacheStats && (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
            {[
              ['Local Files',  cacheStats.total_files, C.text],
              ['Cache Size',   `${cacheStats.total_kb}kb`, C.muted],
              ['Swing cached', cacheStats.by_horizon?.swing||0, C.accent],
              ['Supabase',     stored.length, C.green],
            ].map(([l,v,c]) => (
              <Card key={l} style={{ padding:14 }}>
                <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>{l}</div>
                <div style={{ fontSize:20, fontWeight:800, color:c, ...mono }}>{v}</div>
              </Card>
            ))}
          </div>

          {/* By horizon */}
          {Object.keys(cacheStats.by_horizon || {}).length > 0 && (
            <Card style={{ marginBottom:14 }}>
              <SectionTitle title="Local Cache by Horizon"/>
              {Object.entries(cacheStats.by_horizon).map(([h,count]) => (
                <div key={h} style={{ marginBottom:8 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                    <span style={{ fontSize:11, color:C.muted }}>{h}</span>
                    <span style={{ fontSize:11, color:C.accent, ...mono }}>{count} symbols</span>
                  </div>
                  <ProgressBar value={(count/allSymbols.length)*100} color={C.accent} height={5}/>
                </div>
              ))}
            </Card>
          )}

          {/* Supabase stored list */}
          {stored.length > 0 && (
            <Card>
              <SectionTitle title="Supabase Storage" sub="OHLCV files in price-data bucket"/>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:6 }}>
                {stored.map((s,i) => (
                  <div key={i} style={{ background:C.bg, borderRadius:7, padding:'8px 10px',
                    border:`1px solid ${C.border}18`, fontSize:11 }}>
                    <span style={{ ...mono, fontWeight:700, color:C.text }}>{s.symbol}</span>
                    <span style={{ color:C.muted }}> / {s.horizon}</span>
                    <span style={{ fontSize:9, color:C.dim, marginLeft:6 }}>{s.size_kb}kb</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Bulk Fetch ────────────────────────────────────────────────────── */}
      {section === 'fetch' && (
        <div style={{ display:'grid', gridTemplateColumns:'280px 1fr', gap:16 }}>
          <div>
            <Card style={{ marginBottom:14 }}>
              <SectionTitle title="Bulk Download"/>
              <div style={{ fontSize:11, color:C.muted, marginBottom:14, lineHeight:1.7 }}>
                Download OHLCV price history for symbols in the universe and save to:<br/>
                1. Local disk cache<br/>
                2. Supabase Storage bucket (price-data)
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  { l:'All symbols',     syms:allSymbols.map(([s])=>s) },
                  { l:'ETFs only',       syms:allSymbols.filter(([,i])=>i.type==='etf').map(([s])=>s) },
                  { l:'Tech stocks',     syms:allSymbols.filter(([,i])=>i.sector==='Technology').map(([s])=>s) },
                  { l:'Crypto',          syms:allSymbols.filter(([,i])=>i.sector==='Crypto').map(([s])=>s) },
                  { l:'Bonds & Macro',   syms:allSymbols.filter(([,i])=>['Bonds','Commodities'].includes(i.sector)).map(([s])=>s) },
                ].map(({ l, syms }) => (
                  <button key={l} onClick={() => runPrefetch(syms)} disabled={fetching}
                    style={{ padding:'9px 14px', borderRadius:8, cursor:'pointer', textAlign:'left',
                      fontSize:11, fontWeight:600,
                      background:fetching?C.dim:`${C.accent}18`,
                      border:`1px solid ${fetching?C.dim:`${C.accent}44`}`,
                      color:fetching?C.muted:C.accent, opacity:fetching?0.5:1 }}>
                    ⬇️ {l} ({syms.length})
                  </button>
                ))}
              </div>
            </Card>
          </div>

          {/* Progress */}
          <div>
            {!fetchProgress && !fetching && (
              <Card>
                <div style={{ padding:'50px 20px', textAlign:'center' }}>
                  <div style={{ fontSize:48, marginBottom:14 }}>💾</div>
                  <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:8 }}>
                    Price History Storage
                  </div>
                  <div style={{ fontSize:11, color:C.muted, maxWidth:400, margin:'0 auto' }}>
                    Click a download button to fetch OHLCV history for a group of symbols.
                    Data is compressed with gzip and stored in Supabase Storage for persistence
                    across redeployments.
                  </div>
                </div>
              </Card>
            )}

            {fetching && (
              <Card>
                <div style={{ padding:'30px 0', textAlign:'center' }}>
                  <div className="spin" style={{ width:40, height:40, borderRadius:'50%', margin:'0 auto 16px',
                    border:`3px solid ${C.border}`, borderTopColor:C.accent }}/>
                  <div style={{ color:C.accent, fontWeight:700, marginBottom:6 }}>Downloading price data…</div>
                  <div style={{ color:C.muted, fontSize:11 }}>
                    Fetching from market data, saving to local cache + Supabase Storage
                  </div>
                </div>
              </Card>
            )}

            {fetchProgress && !fetching && (
              <Card>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:14 }}>
                  <SectionTitle title="Download Complete"/>
                  <div style={{ display:'flex', gap:10 }}>
                    <span style={{ color:C.green, fontSize:12, fontWeight:700 }}>
                      ✅ {fetchProgress.ok} ok
                    </span>
                    {fetchProgress.errors > 0 && (
                      <span style={{ color:C.red, fontSize:12, fontWeight:700 }}>
                        ❌ {fetchProgress.errors} errors
                      </span>
                    )}
                  </div>
                </div>
                <ProgressBar value={((fetchProgress.ok||0)/Math.max(fetchProgress.total,1))*100}
                  color={C.green} height={6}/>
                <div style={{ marginTop:14, maxHeight:400, overflowY:'auto' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:5 }}>
                    {Object.entries(fetchProgress.results || {}).map(([sym,status]) => {
                      const ok = ['ok','cached'].includes(status)
                      const c  = ok ? C.green : status==='no_data' ? C.yellow : C.red
                      return (
                        <div key={sym} style={{ display:'flex', gap:6, alignItems:'center',
                          padding:'4px 8px', borderRadius:5, background:C.bg,
                          border:`1px solid ${c}22` }}>
                          <span style={{ fontSize:10 }}>{ok?'✅':status==='no_data'?'⚠️':'❌'}</span>
                          <span style={{ fontSize:10, ...mono, fontWeight:700, color:C.text }}>{sym}</span>
                          <span style={{ fontSize:9, color:C.dim }}>{status}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
