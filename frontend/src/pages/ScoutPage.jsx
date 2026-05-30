/**
 * SCOUT — Senior Trader & Macro Analyst AI
 *
 * Interfaccia per:
 *   - Avviare uno screen su universo di simboli
 *   - Vedere ranking con score multi-factor
 *   - Leggere thesis AI generata da Ollama
 *   - Filtrare per conviction / settore / direzione
 */
import { useState, useEffect, useCallback } from 'react'
import { ReportButton } from '../components/ReportButton'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis,
         BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { C, Card, SectionTitle, Badge, ProgressBar, Spinner, TT } from '../components/UI'
import api from '../lib/api'

const HORIZONS   = ['scalping','day','swing','position']
const CONV_COLOR = { HIGH: C.green, MEDIUM: C.yellow, LOW: C.red }
const DIR_COLOR  = { LONG: C.green, SHORT: C.red, NEUTRAL: C.muted }
const SCREEN_GROUPS = ['mega_tech','growth','value','macro','crypto']

function ScoreMeter({ value, label, color }) {
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:9, color:C.muted, marginBottom:3, textTransform:'uppercase', letterSpacing:.8 }}>{label}</div>
      <div style={{ position:'relative', width:44, height:44, margin:'0 auto' }}>
        <svg viewBox="0 0 44 44" style={{ transform:'rotate(-90deg)' }}>
          <circle cx="22" cy="22" r="18" fill="none" stroke={C.border} strokeWidth="4"/>
          <circle cx="22" cy="22" r="18" fill="none" stroke={color} strokeWidth="4"
                  strokeDasharray={`${(value/100)*113} 113`} strokeLinecap="round"/>
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
                      justifyContent:'center', fontSize:11, fontWeight:800, color, fontFamily:'monospace' }}>
          {Math.round(value)}
        </div>
      </div>
    </div>
  )
}

function PickCard({ pick, onSelect, selected }) {
  const conv_c = CONV_COLOR[pick.conviction]  || C.muted
  const dir_c  = DIR_COLOR[pick.direction]   || C.muted
  const score  = pick.composite

  const radarData = [
    { m:'Tech',      v: pick.breakdown?.technical || 50 },
    { m:'Macro',     v: pick.breakdown?.macro     || 50 },
    { m:'Quality',   v: pick.breakdown?.quality   || 50 },
    { m:'Relative',  v: pick.breakdown?.relative  || 50 },
  ]

  return (
    <div onClick={() => onSelect(pick)}
      style={{
        background: selected ? `${conv_c}12` : C.card,
        border: `1px solid ${selected ? conv_c : C.border}`,
        borderRadius:12, padding:16, cursor:'pointer',
        transition:'all .2s',
        boxShadow: selected ? `0 4px 24px ${conv_c}20` : 'none',
      }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
        <div>
          <div style={{ fontFamily:'monospace', fontWeight:800, fontSize:18, color:C.text }}>{pick.symbol}</div>
          <div style={{ fontSize:10, color:C.muted }}>{pick.sector}</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:22, fontWeight:900, color:conv_c, fontFamily:'monospace', lineHeight:1 }}>
            {score}
          </div>
          <div style={{ fontSize:9, color:C.muted }}>score</div>
        </div>
      </div>

      {/* Direction + conviction */}
      <div style={{ display:'flex', gap:6, marginBottom:10 }}>
        <span style={{ background:`${dir_c}22`, border:`1px solid ${dir_c}44`,
                       borderRadius:5, padding:'3px 10px', fontSize:11, fontWeight:800, color:dir_c }}>
          {pick.direction}
        </span>
        <Badge label={pick.conviction} color={conv_c}/>
        {pick.sector && <Badge label={pick.sector} color={C.purple}/>}
      </div>

      {/* Score bars */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5, marginBottom:10 }}>
        {[
          ['Technical',  pick.breakdown?.technical, C.cyan],
          ['Macro',      pick.breakdown?.macro,     C.yellow],
          ['Quality',    pick.breakdown?.quality,   C.green],
          ['Relative',   pick.breakdown?.relative,  C.accent],
        ].map(([l,v,c]) => (
          <div key={l}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
              <span style={{ fontSize:9, color:C.muted }}>{l}</span>
              <span style={{ fontSize:9, color:c, fontFamily:'monospace' }}>{Math.round(v||0)}</span>
            </div>
            <ProgressBar value={v||0} color={c} height={3}/>
          </div>
        ))}
      </div>

      {/* AI Thesis preview */}
      {pick.thesis && (
        <div style={{ fontSize:10, color:C.muted, lineHeight:1.6, fontStyle:'italic',
                      borderTop:`1px solid ${C.border}22`, paddingTop:8 }}>
          {typeof pick.thesis === 'object'
            ? pick.thesis.thesis?.slice(0, 100) + '…'
            : String(pick.thesis).slice(0, 100) + '…'}
        </div>
      )}
    </div>
  )
}

function PickDetail({ pick }) {
  if (!pick) return null
  const conv_c = CONV_COLOR[pick.conviction] || C.muted
  const dir_c  = DIR_COLOR[pick.direction]  || C.muted
  const thesis = pick.thesis || {}
  const f      = pick.fundamental || {}
  const ts     = pick.technical_signals || {}

  const radarData = [
    { m:'Technical', v: pick.breakdown?.technical || 50 },
    { m:'Macro',     v: pick.breakdown?.macro     || 50 },
    { m:'Quality',   v: pick.breakdown?.quality   || 50 },
    { m:'Relative',  v: pick.breakdown?.relative  || 50 },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <h2 style={{ fontSize:28, fontWeight:900, margin:0, fontFamily:'monospace', color:conv_c }}>
            {pick.symbol}
          </h2>
          <p style={{ color:C.muted, margin:'4px 0 0', fontSize:12 }}>
            {pick.sector} · {pick.direction} · {pick.conviction} conviction
          </p>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:36, fontWeight:900, color:conv_c, fontFamily:'monospace', lineHeight:1 }}>
            {pick.composite}
          </div>
          <div style={{ fontSize:10, color:C.muted }}>composite score</div>
        </div>
      </div>

      {/* Scores + Radar */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 200px', gap:16 }}>
        <Card>
          <SectionTitle title="Factor Scores"/>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
            {[
              ['Technical',  pick.breakdown?.technical, C.cyan],
              ['Macro',      pick.breakdown?.macro,     C.yellow],
              ['Quality',    pick.breakdown?.quality,   C.green],
              ['Relative',   pick.breakdown?.relative,  C.accent],
            ].map(([l,v,c]) => (
              <ScoreMeter key={l} label={l} value={v||0} color={c}/>
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle title="Radar"/>
          <ResponsiveContainer width="100%" height={140}>
            <RadarChart data={radarData}>
              <PolarGrid stroke={C.border}/>
              <PolarAngleAxis dataKey="m" tick={{fontSize:8,fill:C.muted}}/>
              <Radar dataKey="v" stroke={conv_c} fill={conv_c} fillOpacity={0.15} strokeWidth={2}/>
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* AI Thesis */}
      {thesis.thesis && (
        <Card style={{ background:`${conv_c}08`, border:`1px solid ${conv_c}33` }}>
          <div style={{ display:'flex', gap:12, marginBottom:12, alignItems:'center' }}>
            <div style={{ width:36, height:36, borderRadius:10, fontSize:20,
                          background:`${conv_c}22`, display:'flex', alignItems:'center', justifyContent:'center' }}>
              🔭
            </div>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:conv_c }}>SCOUT Analysis — Senior Trader</div>
              <div style={{ fontSize:10, color:C.muted }}>AI-generated thesis · Ollama</div>
            </div>
          </div>

          <div style={{ fontSize:13, color:C.text, lineHeight:1.8, marginBottom:14,
                        padding:'12px 14px', background:C.bg, borderRadius:8, fontStyle:'italic' }}>
            "{thesis.thesis}"
          </div>

          {thesis.conviction_narrative && (
            <div style={{ fontSize:12, color:conv_c, fontWeight:600, marginBottom:12 }}>
              PM Brief: "{thesis.conviction_narrative}"
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            {thesis.catalysts?.length > 0 && (
              <div>
                <div style={{ fontSize:10, color:C.green, textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>
                  ▲ Catalysts
                </div>
                {thesis.catalysts.map((c,i) => (
                  <div key={i} style={{ fontSize:11, color:C.muted, padding:'4px 0',
                                        borderBottom:`1px solid ${C.border}22` }}>
                    {i+1}. {c}
                  </div>
                ))}
              </div>
            )}
            {thesis.risks?.length > 0 && (
              <div>
                <div style={{ fontSize:10, color:C.red, textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>
                  ▼ Risks
                </div>
                {thesis.risks.map((r,i) => (
                  <div key={i} style={{ fontSize:11, color:C.muted, padding:'4px 0',
                                        borderBottom:`1px solid ${C.border}22` }}>
                    {i+1}. {r}
                  </div>
                ))}
              </div>
            )}
          </div>

          {thesis.timeframe && (
            <div style={{ marginTop:12, fontSize:11, color:C.yellow,
                          background:`${C.yellow}10`, padding:'6px 12px', borderRadius:6,
                          border:`1px solid ${C.yellow}33` }}>
              ⏱ Timeframe: {thesis.timeframe}
            </div>
          )}
        </Card>
      )}

      {/* Technical + Fundamental */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <Card>
          <SectionTitle title="Technical Signals"/>
          {Object.entries(ts).length > 0 ? (
            Object.entries(ts).map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0',
                                    borderBottom:`1px solid ${C.border}22`, fontSize:11 }}>
                <span style={{ color:C.muted, fontFamily:'monospace' }}>{k}</span>
                <span style={{ color:C.text, fontFamily:'monospace', fontWeight:700 }}>
                  {typeof v === 'boolean' ? (v ? '✅' : '❌') : Number(v).toFixed(2)}
                </span>
              </div>
            ))
          ) : <div style={{ color:C.muted, fontSize:11 }}>No signals computed</div>}
        </Card>
        <Card>
          <SectionTitle title="Fundamentals" sub="Simulated — replace with real API"/>
          {Object.entries(f).filter(([k])=>k!=='sector').map(([k,v]) => (
            <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0',
                                  borderBottom:`1px solid ${C.border}22`, fontSize:11 }}>
              <span style={{ color:C.muted, textTransform:'uppercase', fontSize:9 }}>{k}</span>
              <span style={{ color:C.text, fontFamily:'monospace', fontWeight:700 }}>
                {k==='pe' ? (v ? `${v}x` : 'N/A') :
                 k==='rev_growth' ? `${v}%` :
                 k==='margin' ? `${v}%` :
                 k==='debt_eq' ? `${v}x` : v}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}

// ── Root page ─────────────────────────────────────────────────────────────────
export default function ScoutPage() {
  const [result,    setResult]    = useState(null)
  const [selected,  setSelected]  = useState(null)
  const [running,   setRunning]   = useState(false)
  const [filter,    setFilter]    = useState('ALL')  // ALL / LONG / SHORT / HIGH / MEDIUM
  const [horizon,   setHorizon]   = useState('swing')
  const [customSyms,setCustomSyms]= useState('')

  const load = useCallback(async () => {
    const cached = await api.get('/api/scout/latest')
    if (cached && !cached.message) setResult(cached)
  }, [])

  useEffect(() => { load() }, [load])

  const runScreen = async () => {
    setRunning(true); setResult(null); setSelected(null)
    const syms = customSyms.trim()
      ? customSyms.split(/[\s,;]+/).map(s=>s.trim().toUpperCase()).filter(Boolean)
      : []
    const r = await api.post('/api/scout/screen', { symbols: syms, horizon, top_n:12, force: true })
    if (r) { setResult(r); if (r.longs?.[0]) setSelected(r.longs[0]) }
    setRunning(false)
  }

  const allPicks = result
    ? [
        ...(result.longs  || []).map(p => ({...p, _tab:'long'})),
        ...(result.shorts || []).map(p => ({...p, _tab:'short'})),
      ]
    : []

  const filteredPicks = allPicks.filter(p => {
    if (filter === 'LONG')   return p.direction === 'LONG'
    if (filter === 'SHORT')  return p.direction === 'SHORT'
    if (filter === 'HIGH')   return p.conviction === 'HIGH'
    if (filter === 'MEDIUM') return p.conviction === 'MEDIUM'
    return true
  })

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:4 }}>
            <div style={{ width:44, height:44, borderRadius:12, fontSize:24,
                          background:`${C.purple}22`, border:`1px solid ${C.purple}44`,
                          display:'flex', alignItems:'center', justifyContent:'center' }}>🔭</div>
            <div>
              <h1 style={{ fontSize:22, fontWeight:800, margin:0, color:'#f0abfc' }}>SCOUT Agent</h1>
              <p style={{ color:C.muted, fontSize:12, margin:0 }}>
                Senior Trader & Macro Analyst · Multi-factor stock screening · AI thesis
              </p>
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, flexDirection:'column', alignItems:'flex-end' }}>
          {result && (
            <div style={{ fontSize:10, color:C.muted }}>
              Last screen: {new Date(result.ts).toLocaleString()} · {result.screened} symbols
            </div>
          )}
          <div style={{ display:'flex', gap:7, alignItems:'center' }}>
            {HORIZONS.map(h => (
              <button key={h} onClick={() => setHorizon(h)} style={{
                padding:'5px 10px', borderRadius:7, fontSize:10, cursor:'pointer',
                background: horizon===h ? `${C.purple}22` : C.surface,
                border:`1px solid ${horizon===h?`${C.purple}66`:C.border}`,
                color: horizon===h ? '#f0abfc' : C.muted,
              }}>{h}</button>
            ))}
            <ReportButton page="scout"/>
            <button onClick={runScreen} disabled={running} style={{
              padding:'9px 20px', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:800,
              background:`${'#f0abfc'}22`, border:`1px solid ${'#f0abfc'}66`, color:'#f0abfc',
              opacity: running ? 0.5 : 1,
            }}>{running ? '⏳ Screening…' : '🔭 Run Screen'}</button>
          </div>
        </div>
      </div>

      {/* Custom symbols */}
      <Card style={{ marginBottom:16, padding:14 }}>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:10, color:C.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:.8 }}>
              Custom Symbols (optional — leave empty to screen full universe)
            </div>
            <input value={customSyms} onChange={e=>setCustomSyms(e.target.value)}
              placeholder="AAPL, NVDA, MSFT, TSLA, GLD … or leave blank for full universe (50+ symbols)"
              style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                       color:C.text, padding:'8px 12px', fontSize:12, outline:'none', fontFamily:'monospace' }}/>
          </div>
          <div style={{ fontSize:10, color:C.muted, textAlign:'center', whiteSpace:'nowrap' }}>
            {SCREEN_GROUPS.map(g => (
              <button key={g} onClick={() => setCustomSyms(
                { mega_tech:'AAPL,MSFT,NVDA,GOOGL,META,AMZN,TSLA',
                  growth:'AMD,CRM,ADBE,NOW,SNOW',
                  value:'JPM,BAC,GS,V,MA,WMT,COST',
                  macro:'GLD,TLT,IWM,EEM,XLE',
                  crypto:'BTC-USD,ETH-USD,SOL-USD' }[g]
              )} style={{ display:'block', marginBottom:4, padding:'3px 10px', borderRadius:20,
                fontSize:9, cursor:'pointer', background:`${C.purple}15`, border:`1px solid ${C.purple}33`,
                color:C.muted, textTransform:'capitalize' }}>{g}</button>
            ))}
          </div>
        </div>
      </Card>

      {running && (
        <div style={{ padding:'30px 0', textAlign:'center' }}>
          <div className="spin" style={{ width:32, height:32, borderRadius:'50%', margin:'0 auto 14px',
                                         border:`3px solid ${C.border}`, borderTopColor:'#f0abfc' }}/>
          <div style={{ color:'#f0abfc', fontWeight:600 }}>SCOUT analyzing markets…</div>
          <div style={{ color:C.muted, fontSize:11, marginTop:4 }}>
            Computing technical, macro, quality & relative strength scores
          </div>
        </div>
      )}

      {result && !running && (
        <>
          {/* Summary row */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:20 }}>
            {[
              ['Screened',    result.screened,                        C.text],
              ['Long Picks',  result.longs?.length || 0,             C.green],
              ['Short Ideas', result.shorts?.length || 0,            C.red],
              ['Top Long',    result.top_long  || '—',               C.green],
              ['Top Short',   result.top_short || '—',               C.red],
            ].map(([l,v,c]) => (
              <Card key={l} style={{ padding:12 }}>
                <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:5 }}>{l}</div>
                <div style={{ fontSize:18, fontWeight:800, color:c, fontFamily:'monospace' }}>{v}</div>
              </Card>
            ))}
          </div>

          {/* Regime + filter */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <div style={{ display:'flex', gap:6 }}>
              {['ALL','LONG','SHORT','HIGH','MEDIUM'].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding:'5px 12px', borderRadius:7, fontSize:11, cursor:'pointer',
                  background: filter===f ? `${filter==='LONG'?C.green:filter==='SHORT'?C.red:C.accent}22` : C.surface,
                  border:`1px solid ${filter===f?`${filter==='LONG'?C.green:filter==='SHORT'?C.red:C.accent}66`:C.border}`,
                  color: filter===f ? (filter==='LONG'?C.green:filter==='SHORT'?C.red:C.accent) : C.muted,
                }}>{f}</button>
              ))}
            </div>
            <div style={{ fontSize:11, color:C.muted }}>
              Regime: <span style={{ color:C.cyan, fontWeight:700 }}>{result.regime || 'unknown'}</span>
              {' · '}{filteredPicks.length} picks shown
            </div>
          </div>

          {/* Two-column: picks grid + detail */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            {/* Picks grid */}
            <div style={{ display:'flex', flexDirection:'column', gap:10, maxHeight:720, overflowY:'auto' }}>
              {filteredPicks.map((pick) => (
                <PickCard
                  key={pick.symbol}
                  pick={pick}
                  onSelect={setSelected}
                  selected={selected?.symbol === pick.symbol}
                />
              ))}
              {filteredPicks.length === 0 && (
                <div style={{ padding:'30px 0', textAlign:'center', color:C.muted }}>
                  No picks match the filter
                </div>
              )}
            </div>

            {/* Detail */}
            <div style={{ position:'sticky', top:78, alignSelf:'start' }}>
              {selected
                ? <PickDetail pick={selected}/>
                : (
                  <Card>
                    <div style={{ padding:'40px 20px', textAlign:'center' }}>
                      <div style={{ fontSize:40, marginBottom:12 }}>🔭</div>
                      <div style={{ color:C.text, fontWeight:600, marginBottom:6 }}>Select a pick</div>
                      <div style={{ color:C.muted, fontSize:11 }}>
                        Click any stock card to see the full AI thesis, factor breakdown, and signals
                      </div>
                    </div>
                  </Card>
                )
              }
            </div>
          </div>
        </>
      )}

      {!result && !running && (
        <Card>
          <div style={{ padding:'50px 20px', textAlign:'center' }}>
            <div style={{ fontSize:48, marginBottom:16 }}>🔭</div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>
              SCOUT is ready
            </div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:20, maxWidth:400, margin:'0 auto 20px' }}>
              Click <strong style={{ color:'#f0abfc' }}>Run Screen</strong> to analyze 50+ symbols with
              multi-factor scoring: Technical · Macro · Quality · Relative Strength.
              Top picks get an AI investment thesis from Ollama.
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, maxWidth:500, margin:'0 auto' }}>
              {[
                ['📊','Technical','Momentum, RSI, Bollinger, Volume surge'],
                ['🌐','Macro','Regime, sector rotation, risk-on/off'],
                ['💎','Quality','PEG ratio, margins, revenue growth'],
                ['📈','Relative','Percentile rank vs universe'],
              ].map(([icon,title,desc]) => (
                <div key={title} style={{ background:C.bg, borderRadius:9, padding:14,
                                          border:`1px solid ${C.border}`, textAlign:'center' }}>
                  <div style={{ fontSize:24, marginBottom:6 }}>{icon}</div>
                  <div style={{ fontSize:11, fontWeight:700, color:C.text, marginBottom:3 }}>{title}</div>
                  <div style={{ fontSize:9, color:C.muted }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
