/**
 * Training Lab — 4 tabs:
 *   Models      -> registry of all saved .pkl files with OOS metrics
 *   Backtest    -> run + view vectorized backtest results
 *   Universe    -> manage the 60-symbol training universe
 *   Data        -> CSV upload, custom data sources
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { C, Card, SectionTitle, Badge, ProgressBar, Spinner, TT } from '../components/UI'
import api from '../lib/api'

const TABS     = ['models','backtest','universe','data','health']
const TAB_ICON = { models:'🧠', backtest:'📈', universe:'🌍', data:'📂', health:'🩺' }

const AGENTS   = ['MOM','MRV','PPO','DQN','MAC','SEN','VOL','REG','OPT']
const HORIZONS = ['scalping','day','swing','position']
const SECTORS  = ['All','ETF','Technology','Finance','Healthcare','Energy','Consumer','Bonds','Crypto','Commodities','Volatility','Custom']

const AGENT_COLORS = {
  MOM:'#06b6d4',MRV:'#8b5cf6',PPO:'#3b82f6',DQN:'#ec4899',MAC:'#f59e0b',
  SEN:'#f97316',VOL:'#ef4444',REG:'#14b8a6',OPT:'#10b981',
}

// ── Sub-component helpers ─────────────────────────────────────────────────────
function AccBadge({ v }) {
  const c = v >= 65 ? C.green : v >= 55 ? C.yellow : C.red
  return <span style={{ color:c, fontFamily:'monospace', fontWeight:700, fontSize:13 }}>{v?.toFixed?.(1) ?? '—'}%</span>
}

function OverfitBadge({ gap, flag }) {
  if (!gap && gap !== 0) return null
  const c = flag ? C.red : Math.abs(gap) < 5 ? C.green : C.yellow
  return (
    <span style={{ background:`${c}18`, border:`1px solid ${c}44`, borderRadius:4,
                   padding:'1px 6px', fontSize:10, color:c, fontFamily:'monospace' }}>
      {gap > 0 ? '+' : ''}{gap?.toFixed?.(1)}%
    </span>
  )
}

// ── MODELS TAB ────────────────────────────────────────────────────────────────
function ModelsTab() {
  const [models,   setModels]   = useState([])
  const [stats,    setStats]    = useState(null)
  const [verify,   setVerify]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)
  const [horizon,  setHorizon]  = useState('swing')
  const [filterA,  setFilterA]  = useState('All')

  const load = useCallback(async () => {
    setLoading(true)
    const [m, s, v] = await Promise.all([
      api.models(), api.trainingStats(), api.verifyModels(horizon)
    ])
    if (m) setModels(m)
    if (s) setStats(s)
    if (v) setVerify(v)
    setLoading(false)
  }, [horizon])

  useEffect(() => { load() }, [load])

  const filtered = models.filter(m => filterA === 'All' || m.abbr === filterA)

  return (
    <div>
      {/* Stats row */}
      {stats && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:20 }}>
          {[
            ['Total Models',   stats.total_models,         C.text],
            ['Trained',        stats.trained_models,       C.green],
            ['Avg OOS Acc',    stats.avg_oos_accuracy+'%', C.accent],
            ['Avg Overfit',    stats.avg_overfit_gap+'%',  stats.avg_overfit_gap > 10 ? C.red : C.green],
            ['Overfit Models', stats.overfit_count,        stats.overfit_count > 0 ? C.red : C.green],
            ['Backtests Run',  stats.backtests_run,        C.cyan],
          ].map(([l,v,c]) => (
            <Card key={l} style={{ padding:14 }}>
              <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>{l}</div>
              <div style={{ fontSize:20, fontWeight:800, color:c, fontFamily:'monospace' }}>{v}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Coverage bar */}
      {verify && (
        <Card style={{ marginBottom:16, padding:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={{ fontSize:12, color:C.text, fontWeight:600 }}>
              Model Coverage — {horizon} horizon
            </span>
            <span style={{ fontSize:12, color:C.accent, fontFamily:'monospace' }}>
              {verify.summary?.present}/{verify.summary?.total} models
            </span>
          </div>
          <ProgressBar value={verify.summary?.coverage || 0} color={C.green} height={8}/>
          <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
            {verify.present?.map(p => (
              <span key={p.abbr+p.symbol} style={{
                fontSize:10, padding:'2px 8px', borderRadius:4,
                background:`${C.green}18`, border:`1px solid ${C.green}44`, color:C.green, fontFamily:'monospace',
              }}>{p.abbr}</span>
            ))}
            {verify.missing?.map(p => (
              <span key={p.abbr+p.symbol} style={{
                fontSize:10, padding:'2px 8px', borderRadius:4,
                background:`${C.red}18`, border:`1px solid ${C.red}44`, color:C.red, fontFamily:'monospace',
              }}>{p.abbr} ✗</span>
            ))}
          </div>
        </Card>
      )}

      {/* Filters */}
      <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        {['All',...AGENTS].map(a => (
          <button key={a} onClick={() => setFilterA(a)} style={{
            padding:'5px 11px', borderRadius:7, fontSize:11, cursor:'pointer',
            background:  filterA===a ? `${AGENT_COLORS[a]||C.accent}22` : C.surface,
            border:`1px solid ${filterA===a?`${AGENT_COLORS[a]||C.accent}66`:C.border}`,
            color: filterA===a ? (AGENT_COLORS[a]||C.accent) : C.muted,
          }}>{a}</button>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', gap:5 }}>
          {HORIZONS.map(h => (
            <button key={h} onClick={() => setHorizon(h)} style={{
              padding:'5px 10px', borderRadius:7, fontSize:10, cursor:'pointer',
              background: horizon===h ? `${C.purple}22` : C.surface,
              border:`1px solid ${horizon===h?`${C.purple}66`:C.border}`,
              color: horizon===h ? C.purple : C.muted,
            }}>{h}</button>
          ))}
          <button onClick={load} style={{ padding:'5px 10px', borderRadius:7, fontSize:10,
            cursor:'pointer', background:C.surface, border:`1px solid ${C.border}`, color:C.muted }}>↺</button>
        </div>
      </div>

      {/* Models table */}
      {loading ? <Spinner/> : (
        <Card>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead><tr>
                {['Agent','Symbol','Horizon','OOS Acc','Train Acc','CV Mean','Overfit Δ','Samples','F1','File','Trained At',''].map(h => (
                  <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted,
                    fontSize:9, textTransform:'uppercase', letterSpacing:.8,
                    borderBottom:`1px solid ${C.border}`, whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={12} style={{ padding:24, textAlign:'center', color:C.muted }}>
                    No trained models yet — go to Ecosystem -> Train All
                  </td></tr>
                )}
                {filtered.map((m, i) => (
                  <tr key={i} onClick={() => setSelected(selected?.abbr===m.abbr&&selected?.symbol===m.symbol?null:m)}
                    style={{ borderBottom:`1px solid ${C.border}22`, cursor:'pointer',
                             background: selected?.abbr===m.abbr&&selected?.symbol===m.symbol?`${C.accent}08`:'transparent' }}>
                    <td style={{ padding:'9px 12px' }}>
                      <span style={{ color:AGENT_COLORS[m.abbr]||C.text, fontFamily:'monospace', fontWeight:700 }}>{m.abbr}</span>
                    </td>
                    <td style={{ padding:'9px 12px', color:C.text, fontFamily:'monospace' }}>{m.symbol}</td>
                    <td style={{ padding:'9px 12px' }}>
                      <Badge label={m.horizon} color={C.purple}/>
                    </td>
                    <td style={{ padding:'9px 12px' }}><AccBadge v={m.accuracy_oos}/></td>
                    <td style={{ padding:'9px 12px', color:C.muted, fontFamily:'monospace', fontSize:11 }}>{m.accuracy_train?.toFixed(1)}%</td>
                    <td style={{ padding:'9px 12px', color:C.cyan, fontFamily:'monospace', fontSize:11 }}>{m.cv_mean?.toFixed(1)}%</td>
                    <td style={{ padding:'9px 12px' }}><OverfitBadge gap={m.overfit_gap} flag={m.overfit_flag}/></td>
                    <td style={{ padding:'9px 12px', color:C.muted, fontFamily:'monospace', fontSize:10 }}>
                      {m.samples_train}+{m.samples_test}
                    </td>
                    <td style={{ padding:'9px 12px', color:C.text, fontFamily:'monospace', fontSize:11 }}>
                      {m.oos_metrics?.f1?.toFixed(3) ?? (m.oos_metrics?.r2?.toFixed(3) ?? '—')}
                    </td>
                    <td style={{ padding:'9px 12px' }}>
                      <Badge label={m.model_exists?`${m.file_size_kb}kb`:'missing'}
                             color={m.model_exists?C.green:C.red}/>
                    </td>
                    <td style={{ padding:'9px 12px', color:C.muted, fontSize:10, fontFamily:'monospace', whiteSpace:'nowrap' }}>
                      {m.trained_at ? new Date(m.trained_at).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding:'9px 12px', color:C.accent, fontSize:10 }}>▶</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Selected model detail */}
      {selected && (
        <div style={{ marginTop:16, display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          {/* OOS metrics */}
          <Card>
            <SectionTitle title={`${selected.abbr} / ${selected.symbol} / ${selected.horizon}`}
                          sub="Out-of-sample test metrics"/>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom:12 }}>
              {Object.entries(selected.oos_metrics || {})
                .filter(([k]) => k !== 'confusion_matrix')
                .map(([k,v]) => (
                  <div key={k} style={{ background:C.bg, borderRadius:7, padding:'9px 11px' }}>
                    <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:3 }}>{k}</div>
                    <div style={{ fontSize:15, fontWeight:700, color:C.text, fontFamily:'monospace' }}>{Number(v).toFixed(4)}</div>
                  </div>
              ))}
            </div>
            {selected.oos_metrics?.confusion_matrix && (
              <div>
                <div style={{ fontSize:10, color:C.muted, marginBottom:6 }}>Confusion Matrix</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5, maxWidth:200 }}>
                  {['TN','FP','FN','TP'].map((label, i) => {
                    const row  = Math.floor(i/2), col = i%2
                    const v    = selected.oos_metrics.confusion_matrix[row]?.[col] || 0
                    const isGood = (label === 'TN' || label === 'TP')
                    return (
                      <div key={label} style={{ background: isGood?`${C.green}18`:`${C.red}18`,
                        border:`1px solid ${isGood?C.green:C.red}44`,
                        borderRadius:6, padding:'8px 12px', textAlign:'center' }}>
                        <div style={{ fontSize:9, color:C.muted }}>{label}</div>
                        <div style={{ fontSize:18, fontWeight:800, color:isGood?C.green:C.red, fontFamily:'monospace' }}>{v}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* Feature importance */}
          <Card>
            <SectionTitle title="Feature Importance" sub="Top 10 by model weight"/>
            {Object.entries(selected.feature_importance || {}).slice(0,10).map(([feat, imp]) => (
              <div key={feat} style={{ marginBottom:6 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                  <span style={{ fontSize:11, color:C.muted, fontFamily:'monospace' }}>{feat}</span>
                  <span style={{ fontSize:10, color:AGENT_COLORS[selected.abbr]||C.accent, fontFamily:'monospace' }}>
                    {(imp*100).toFixed(1)}%
                  </span>
                </div>
                <ProgressBar value={(imp/Object.values(selected.feature_importance)[0])*100}
                             color={AGENT_COLORS[selected.abbr]||C.accent} height={4}/>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  )
}

// ── BACKTEST TAB ──────────────────────────────────────────────────────────────
function BacktestTab() {
  const [form,     setForm]     = useState({ abbr:'MOM', symbol:'SPY', horizon:'swing', initial_capital:10000 })
  const [running,  setRunning]  = useState(false)
  const [result,   setResult]   = useState(null)
  const [history,  setHistory]  = useState([])
  const [multiSym, setMultiSym] = useState('')
  const [multiRes, setMultiRes] = useState(null)

  useEffect(() => { api.backtestResults().then(d => d && setHistory(d)) }, [])

  const set = (k,v) => setForm(f => ({...f,[k]:v}))

  const runSingle = async () => {
    setRunning(true); setResult(null)
    const r = await api.runBacktest({ ...form, symbol: form.symbol.toUpperCase() })
    if (r && !r.error) {
      setResult(r)
      setHistory(prev => [r,...prev].slice(0,50))
    } else {
      setResult({ error: r?.error || r?.detail || 'Backtest failed' })
    }
    setRunning(false)
  }

  const runMulti = async () => {
    const syms = multiSym.split(/[\s,;]+/).map(s=>s.trim().toUpperCase()).filter(Boolean)
    if (!syms.length) return
    setRunning(true); setMultiRes(null)
    const r = await api.runMultiBt({ abbr:form.abbr, symbols:syms, horizon:form.horizon })
    if (r) setMultiRes(r)
    setRunning(false)
  }

  const alpha_c = v => v > 0 ? C.green : v < 0 ? C.red : C.muted

  return (
    <div>
      {/* Config row */}
      <Card style={{ marginBottom:16, padding:16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr) auto', gap:12, alignItems:'flex-end' }}>
          {/* Agent */}
          <div>
            <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Agent</div>
            <select value={form.abbr} onChange={e => set('abbr',e.target.value)}
              style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`,
                       borderRadius:7, color:C.text, padding:'8px 10px', fontSize:12, outline:'none' }}>
              {AGENTS.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
          {/* Symbol */}
          <div>
            <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Symbol</div>
            <input value={form.symbol} onChange={e => set('symbol',e.target.value.toUpperCase())}
              style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`,
                       borderRadius:7, color:C.text, padding:'8px 10px', fontSize:12,
                       outline:'none', fontFamily:'monospace', fontWeight:700 }}/>
          </div>
          {/* Horizon */}
          <div>
            <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Horizon</div>
            <select value={form.horizon} onChange={e => set('horizon',e.target.value)}
              style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`,
                       borderRadius:7, color:C.text, padding:'8px 10px', fontSize:12, outline:'none' }}>
              {HORIZONS.map(h => <option key={h}>{h}</option>)}
            </select>
          </div>
          {/* Capital */}
          <div>
            <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Capital ($)</div>
            <input type="number" value={form.initial_capital} onChange={e => set('initial_capital',Number(e.target.value))}
              style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`,
                       borderRadius:7, color:C.text, padding:'8px 10px', fontSize:12, outline:'none', fontFamily:'monospace' }}/>
          </div>
          <button onClick={runSingle} disabled={running} style={{
            padding:'8px 20px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700,
            background:`${AGENT_COLORS[form.abbr]||C.accent}22`,
            border:`1px solid ${AGENT_COLORS[form.abbr]||C.accent}66`,
            color: AGENT_COLORS[form.abbr]||C.accent,
            opacity: running ? 0.5 : 1, whiteSpace:'nowrap',
          }}>{running ? '⏳ Running…' : '▶ Run'}</button>
        </div>

        {/* Multi-symbol row */}
        <div style={{ marginTop:12, display:'flex', gap:10, alignItems:'center' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:10, color:C.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:.8 }}>
              Multi-Symbol (comma-separated)
            </div>
            <input value={multiSym} onChange={e => setMultiSym(e.target.value)}
              placeholder="SPY, QQQ, AAPL, MSFT, NVDA, TSLA …"
              style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`,
                       borderRadius:7, color:C.text, padding:'8px 10px', fontSize:11, outline:'none', fontFamily:'monospace' }}/>
          </div>
          <button onClick={runMulti} disabled={running||!multiSym.trim()} style={{
            marginTop:18, padding:'8px 16px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:700,
            background:`${C.cyan}18`, border:`1px solid ${C.cyan}44`, color:C.cyan,
            opacity: (running||!multiSym.trim()) ? 0.4 : 1,
          }}>🌍 Run All</button>
        </div>
      </Card>

      {/* Single result */}
      {result && !result.error && (
        <div style={{ marginBottom:16 }}>
          {/* Metrics */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:14 }}>
            {[
              ['Total Return', result.total_return+'%',    alpha_c(result.total_return)],
              ['vs Buy&Hold',  result.benchmark_return+'%', C.muted],
              ['Alpha',        (result.alpha>0?'+':'')+result.alpha+'%', alpha_c(result.alpha)],
              ['Sharpe',       result.sharpe,               C.text],
              ['Max DD',       result.max_drawdown+'%',    C.red],
              ['Win Rate',     result.win_rate+'%',        C.green],
              ['Trades',       result.total_trades,        C.text],
              ['P.Factor',     result.profit_factor,       C.text],
              ['Sortino',      result.sortino,             C.text],
              ['Calmar',       result.calmar,              C.text],
              ['Avg Win',      result.avg_win?.toFixed(4), C.green],
              ['Avg Loss',     result.avg_loss?.toFixed(4),C.red],
            ].map(([l,v,c]) => (
              <Card key={l} style={{ padding:12 }}>
                <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:17, fontWeight:800, color:c, fontFamily:'monospace' }}>{v}</div>
              </Card>
            ))}
          </div>
          {/* Equity chart */}
          <Card>
            <SectionTitle title={`${result.abbr} ${result.symbol} Backtest — ${result.bars} bars`}
                          sub={`${result.start?.slice(0,10)} -> ${result.end?.slice(0,10)}`}/>
            <div style={{ display:'flex', gap:12, marginBottom:8 }}>
              {[['Strategy',AGENT_COLORS[result.abbr]||C.accent],['Buy & Hold',C.muted]].map(([l,c])=>(
                <div key={l} style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <div style={{ width:16, height:2, background:c, borderRadius:99 }}/>
                  <span style={{ fontSize:10, color:C.muted }}>{l}</span>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={result.equity_curve}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                <XAxis dataKey="i" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false} domain={['auto','auto']}/>
                <Tooltip {...TT} formatter={(v,n) => [`$${v.toFixed(2)}`,n]}/>
                <Line type="monotone" dataKey="equity" stroke={AGENT_COLORS[result.abbr]||C.accent}
                      strokeWidth={2} dot={false} name="Strategy" isAnimationActive={false}/>
                <Line type="monotone" dataKey="bh" stroke={C.dim}
                      strokeWidth={1} strokeDasharray="4 4" dot={false} name="Buy&Hold" isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          </Card>
          {/* Trade log */}
          {result.trades?.length > 0 && (
            <Card style={{ marginTop:14 }}>
              <SectionTitle title={`Last ${result.trades.length} Trades`}/>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead><tr>
                    {['Date','Side','Price','Entry','P&L','P&L%'].map(h=>(
                      <th key={h} style={{ textAlign:'left', padding:'6px 11px', color:C.muted,
                        fontSize:9, textTransform:'uppercase', letterSpacing:.8,
                        borderBottom:`1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {result.trades.slice(-20).reverse().map((t,i)=>(
                      <tr key={i} style={{ borderBottom:`1px solid ${C.border}22` }}>
                        <td style={{ padding:'6px 11px', color:C.muted, fontFamily:'monospace', fontSize:10 }}>{t.ts?.slice(0,10)}</td>
                        <td style={{ padding:'6px 11px' }}>
                          <span style={{ color:t.side==='SELL'?C.red:t.side==='BUY'?C.green:C.muted,
                            fontFamily:'monospace', fontWeight:700, fontSize:10 }}>{t.side}</span>
                        </td>
                        <td style={{ padding:'6px 11px', color:C.text, fontFamily:'monospace' }}>${t.price?.toFixed(2)}</td>
                        <td style={{ padding:'6px 11px', color:C.muted, fontFamily:'monospace' }}>${t.entry?.toFixed(2)}</td>
                        <td style={{ padding:'6px 11px', color:(t.pnl||0)>=0?C.green:C.red, fontFamily:'monospace', fontWeight:700 }}>
                          {t.pnl>=0?'+':''}{t.pnl?.toFixed(2)}
                        </td>
                        <td style={{ padding:'6px 11px', color:(t.pnl_pct||0)>=0?C.green:C.red, fontFamily:'monospace' }}>
                          {t.pnl_pct>=0?'+':''}{(t.pnl_pct*100)?.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
      {result?.error && (
        <div style={{ padding:'12px 16px', borderRadius:9, background:`${C.red}15`,
                      border:`1px solid ${C.red}44`, color:C.red, marginBottom:16 }}>❌ {result.error}</div>
      )}

      {/* Multi-symbol result */}
      {multiRes && (
        <Card style={{ marginBottom:16 }}>
          <SectionTitle title={`Multi-Symbol: ${multiRes.abbr} / ${multiRes.horizon}`}
                        sub={`${multiRes.symbols_ok}/${multiRes.symbols_tested} symbols · avg alpha ${multiRes.avg_alpha}%`}/>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:14 }}>
            {[['Avg Return',multiRes.avg_return+'%',alpha_c(multiRes.avg_return)],
              ['Avg Alpha',  multiRes.avg_alpha+'%', alpha_c(multiRes.avg_alpha)],
              ['Avg Sharpe', multiRes.avg_sharpe,    C.text],
              ['Avg DD',     multiRes.avg_drawdown+'%', C.red],
            ].map(([l,v,c]) => (
              <Card key={l} style={{ padding:12 }}>
                <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:18, fontWeight:800, color:c, fontFamily:'monospace' }}>{v}</div>
              </Card>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={multiRes.rows?.filter(r=>!r.error).sort((a,b)=>(b.alpha||0)-(a.alpha||0)).slice(0,20)} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
              <XAxis dataKey="symbol" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
              <Tooltip {...TT}/>
              <Bar dataKey="alpha" name="Alpha %" fill={C.accent} radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ overflowX:'auto', marginTop:14 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead><tr>
                {['Symbol','Return','Alpha','Sharpe','Max DD','Win%','Trades','P.Factor'].map(h=>(
                  <th key={h} style={{ textAlign:'left', padding:'6px 11px', color:C.muted,
                    fontSize:9, textTransform:'uppercase', letterSpacing:.8, borderBottom:`1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {multiRes.rows?.sort((a,b)=>(b.alpha||0)-(a.alpha||0)).map((r,i)=>(
                  <tr key={i} style={{ borderBottom:`1px solid ${C.border}22` }}>
                    <td style={{ padding:'7px 11px', color:C.text, fontFamily:'monospace', fontWeight:700 }}>{r.symbol}</td>
                    {r.error ? (
                      <td colSpan={7} style={{ padding:'7px 11px', color:C.red, fontSize:10 }}>{r.error}</td>
                    ) : <>
                      <td style={{ padding:'7px 11px', color:alpha_c(r.total_return), fontFamily:'monospace' }}>{r.total_return?.toFixed(1)}%</td>
                      <td style={{ padding:'7px 11px', color:alpha_c(r.alpha), fontFamily:'monospace', fontWeight:700 }}>{r.alpha?.toFixed(1)}%</td>
                      <td style={{ padding:'7px 11px', color:C.text, fontFamily:'monospace' }}>{r.sharpe?.toFixed(2)}</td>
                      <td style={{ padding:'7px 11px', color:C.red, fontFamily:'monospace' }}>{r.max_drawdown?.toFixed(1)}%</td>
                      <td style={{ padding:'7px 11px', color:C.green, fontFamily:'monospace' }}>{r.win_rate?.toFixed(1)}%</td>
                      <td style={{ padding:'7px 11px', color:C.muted, fontFamily:'monospace' }}>{r.total_trades}</td>
                      <td style={{ padding:'7px 11px', color:C.text, fontFamily:'monospace' }}>{r.profit_factor?.toFixed(2)}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Backtest history */}
      {history.length > 0 && (
        <Card>
          <SectionTitle title="Backtest History" sub={`${history.length} saved results`}/>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead><tr>
                {['Agent','Symbol','Horizon','Return','Alpha','Sharpe','Max DD','Win%','Date'].map(h=>(
                  <th key={h} style={{ textAlign:'left', padding:'6px 11px', color:C.muted,
                    fontSize:9, textTransform:'uppercase', letterSpacing:.8, borderBottom:`1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {history.slice(0,30).map((r,i)=>(
                  <tr key={i} style={{ borderBottom:`1px solid ${C.border}22` }}>
                    <td style={{ padding:'7px 11px', color:AGENT_COLORS[r.abbr]||C.text, fontFamily:'monospace', fontWeight:700 }}>{r.abbr}</td>
                    <td style={{ padding:'7px 11px', color:C.text, fontFamily:'monospace' }}>{r.symbol}</td>
                    <td style={{ padding:'7px 11px' }}><Badge label={r.horizon} color={C.purple}/></td>
                    <td style={{ padding:'7px 11px', color:alpha_c(r.total_return), fontFamily:'monospace' }}>{r.total_return?.toFixed(1)}%</td>
                    <td style={{ padding:'7px 11px', color:alpha_c(r.alpha), fontFamily:'monospace', fontWeight:700 }}>{r.alpha?.toFixed(1)}%</td>
                    <td style={{ padding:'7px 11px', color:C.text, fontFamily:'monospace' }}>{r.sharpe?.toFixed(2)}</td>
                    <td style={{ padding:'7px 11px', color:C.red, fontFamily:'monospace' }}>{r.max_drawdown?.toFixed(1)}%</td>
                    <td style={{ padding:'7px 11px', color:C.green, fontFamily:'monospace' }}>{r.win_rate?.toFixed(1)}%</td>
                    <td style={{ padding:'7px 11px', color:C.muted, fontSize:10, fontFamily:'monospace' }}>{r.backtest_at?.slice(0,10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ── UNIVERSE TAB ──────────────────────────────────────────────────────────────
function UniverseTab() {
  const [universe, setUniverse] = useState({ symbols:[], sectors:[], total:0 })
  const [sector,   setSector]   = useState('All')
  const [search,   setSearch]   = useState('')
  const [newSym,   setNewSym]   = useState({ symbol:'', name:'', sector:'Custom', type:'stock' })
  const [loading,  setLoading]  = useState(true)
  const [trainCfg, setTrainCfg] = useState({ abbr:'MOM', horizon:'swing', force:false })
  const [trainMsg, setTrainMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const d = await api.universe(sector === 'All' ? null : sector)
    if (d) setUniverse(d)
    setLoading(false)
  }, [sector])

  useEffect(() => { load() }, [load])

  const addSym = async () => {
    if (!newSym.symbol.trim()) return
    await api.addSymbol(newSym)
    setNewSym({ symbol:'', name:'', sector:'Custom', type:'stock' })
    await load()
  }

  const removeSym = async (sym) => {
    await api.removeSymbol(sym)
    await load()
  }

  const trainAll = async () => {
    const syms = filtered.map(s => s.symbol)
    if (!syms.length) return
    setTrainMsg(`Queueing ${syms.length} training jobs…`)
    const r = await api.trainMulti({ ...trainCfg, symbols: syms })
    setTrainMsg(r ? `✅ Queued ${r.queued} jobs for ${trainCfg.abbr}` : '❌ Error queuing')
    setTimeout(() => setTrainMsg(''), 5000)
  }

  const filtered = (universe.symbols || []).filter(s =>
    (sector === 'All' || s.sector === sector) &&
    (search === '' || s.symbol.toLowerCase().includes(search.toLowerCase()) ||
     s.name.toLowerCase().includes(search.toLowerCase()))
  )

  const sectorCounts = {}
  ;(universe.symbols || []).forEach(s => {
    sectorCounts[s.sector] = (sectorCounts[s.sector]||0)+1
  })

  return (
    <div>
      {/* Sector pills */}
      <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:16 }}>
        {['All',...(universe.sectors||[])].map(s => (
          <button key={s} onClick={() => setSector(s)} style={{
            padding:'5px 11px', borderRadius:20, fontSize:11, cursor:'pointer',
            background: sector===s ? `${C.accent}22` : C.surface,
            border:`1px solid ${sector===s?`${C.accent}66`:C.border}`,
            color: sector===s ? C.accent : C.muted,
          }}>
            {s} {s!=='All'?<span style={{ fontSize:9, color:C.dim }}>({sectorCounts[s]||0})</span>:''}
          </button>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16 }}>
        {/* Symbol list */}
        <div>
          <div style={{ display:'flex', gap:8, marginBottom:12, alignItems:'center' }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search symbols…"
              style={{ flex:1, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8,
                       color:C.text, padding:'7px 12px', fontSize:12, outline:'none' }}/>
            <span style={{ fontSize:11, color:C.muted }}>{filtered.length} symbols</span>
          </div>
          <Card>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, maxHeight:420, overflowY:'auto' }}>
              {loading ? <div style={{ gridColumn:'1/-1' }}><Spinner/></div> :
                filtered.map(s => (
                  <div key={s.symbol} style={{
                    padding:'8px 10px', borderRadius:7, background:C.bg, border:`1px solid ${C.border}`,
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                  }}>
                    <div>
                      <div style={{ fontFamily:'monospace', fontWeight:700, fontSize:12, color:C.text }}>{s.symbol}</div>
                      <div style={{ fontSize:9, color:C.muted, marginTop:1 }}>{s.sector}</div>
                    </div>
                    {s.custom && (
                      <button onClick={() => removeSym(s.symbol)} title="Remove"
                        style={{ background:'none', border:'none', color:C.red, cursor:'pointer', fontSize:12 }}>✕</button>
                    )}
                  </div>
                ))
              }
            </div>
          </Card>
        </div>

        {/* Right panel */}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {/* Add symbol */}
          <Card>
            <SectionTitle title="Add Symbol" sub="Manually add any ticker"/>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {[['symbol','Ticker','NVDA'],['name','Company','Nvidia Corp'],['sector','Sector','Technology']].map(([k,l,p]) => (
                <div key={k}>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:3 }}>{l}</div>
                  <input value={newSym[k]} onChange={e => setNewSym(s=>({...s,[k]:e.target.value}))}
                    placeholder={p}
                    style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                             color:C.text, padding:'7px 10px', fontSize:12, outline:'none',
                             fontFamily: k==='symbol'?'monospace':'inherit', fontWeight: k==='symbol'?700:400 }}/>
                </div>
              ))}
              <select value={newSym.type} onChange={e => setNewSym(s=>({...s,type:e.target.value}))}
                style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                         color:C.muted, padding:'7px 10px', fontSize:12, outline:'none' }}>
                {['stock','etf','crypto','index','custom'].map(t => <option key={t}>{t}</option>)}
              </select>
              <button onClick={addSym} disabled={!newSym.symbol.trim()} style={{
                padding:'8px 0', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700,
                background:`${C.green}22`, border:`1px solid ${C.green}44`, color:C.green,
              }}>+ Add to Universe</button>
            </div>
          </Card>

          {/* Bulk train */}
          <Card>
            <SectionTitle title="Train on Universe" sub="Queue jobs for all filtered symbols"/>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <select value={trainCfg.abbr} onChange={e=>setTrainCfg(c=>({...c,abbr:e.target.value}))}
                style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                         color:C.text, padding:'8px 10px', fontSize:12, outline:'none' }}>
                {AGENTS.map(a => <option key={a}>{a}</option>)}
              </select>
              <select value={trainCfg.horizon} onChange={e=>setTrainCfg(c=>({...c,horizon:e.target.value}))}
                style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                         color:C.muted, padding:'8px 10px', fontSize:12, outline:'none' }}>
                {HORIZONS.map(h => <option key={h}>{h}</option>)}
              </select>
              <button onClick={trainAll} style={{
                padding:'9px 0', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700,
                background:`${AGENT_COLORS[trainCfg.abbr]||C.accent}22`,
                border:`1px solid ${AGENT_COLORS[trainCfg.abbr]||C.accent}66`,
                color: AGENT_COLORS[trainCfg.abbr]||C.accent,
              }}>⚡ Train {trainCfg.abbr} on {filtered.length} symbols</button>
              {trainMsg && <div style={{ fontSize:11, color:C.green, textAlign:'center' }}>{trainMsg}</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ── DATA TAB ──────────────────────────────────────────────────────────────────
function DataTab() {
  const [symbol,   setSymbol]   = useState('')
  const [csvText,  setCsvText]  = useState('')
  const [result,   setResult]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [uploads,  setUploads]  = useState([])
  const fileRef = useRef(null)

  useEffect(() => { api.listUploads().then(d => d && setUploads(d)) }, [])

  const readFile = (file) => {
    const r = new FileReader()
    r.onload = e => setCsvText(e.target.result)
    r.readAsText(file)
  }

  const upload = async () => {
    if (!symbol.trim() || !csvText.trim()) return
    setLoading(true); setResult(null)
    const r = await api.uploadCsv({ symbol: symbol.toUpperCase(), content: csvText })
    setResult(r)
    if (!r?.error) {
      api.listUploads().then(d => d && setUploads(d))
    }
    setLoading(false)
  }

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        {/* Upload */}
        <Card>
          <SectionTitle title="Upload OHLCV CSV" sub="Any format — auto-detected"/>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div>
              <div style={{ fontSize:10, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>Symbol</div>
              <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
                placeholder="MYSTOCK"
                style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:7,
                         color:C.text, padding:'8px 10px', fontSize:13, fontFamily:'monospace',
                         fontWeight:700, outline:'none' }}/>
            </div>

            {/* Drop zone */}
            <div
              onClick={() => fileRef.current?.click()}
              onDrop={e => { e.preventDefault(); readFile(e.dataTransfer.files[0]) }}
              onDragOver={e => e.preventDefault()}
              style={{ border:`2px dashed ${csvText?C.green:C.border}`, borderRadius:10,
                       padding:'28px 20px', textAlign:'center', cursor:'pointer',
                       background: csvText?`${C.green}08`:C.bg, transition:'all .2s' }}>
              <div style={{ fontSize:28, marginBottom:6 }}>{csvText ? '✅' : '📄'}</div>
              <div style={{ fontSize:12, color:C.text, fontWeight:600 }}>
                {csvText ? `${csvText.split('\n').length} rows loaded` : 'Drop CSV file here'}
              </div>
              <div style={{ fontSize:10, color:C.muted, marginTop:3 }}>or click to browse</div>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt"
                style={{ display:'none' }} onChange={e => readFile(e.target.files[0])}/>
            </div>

            {csvText && (
              <div style={{ background:C.bg, borderRadius:7, padding:10, border:`1px solid ${C.border}` }}>
                <div style={{ fontSize:9, color:C.muted, marginBottom:5, textTransform:'uppercase', letterSpacing:.8 }}>
                  Preview (first 4 lines)
                </div>
                <pre style={{ fontSize:10, color:C.muted, fontFamily:'monospace',
                              overflow:'auto', maxHeight:80, margin:0 }}>
                  {csvText.split('\n').slice(0,4).join('\n')}
                </pre>
              </div>
            )}

            <button onClick={upload} disabled={loading||!symbol.trim()||!csvText.trim()} style={{
              padding:'10px 0', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700,
              background:`${C.accent}22`, border:`1px solid ${C.accent}66`, color:C.accent,
              opacity: (loading||!symbol.trim()||!csvText.trim()) ? 0.4 : 1,
            }}>{loading ? '⏳ Parsing…' : '⬆ Upload & Register'}</button>

            {result && (
              <div style={{ padding:'12px 14px', borderRadius:9,
                background: result.error?`${C.red}15`:`${C.green}15`,
                border:`1px solid ${result.error?C.red:C.green}44` }}>
                {result.error ? (
                  <div style={{ color:C.red, fontSize:12 }}>❌ {result.error}</div>
                ) : (
                  <>
                    <div style={{ color:C.green, fontWeight:700, marginBottom:6 }}>✅ {result.symbol} registered</div>
                    {[['Rows',result.rows],['From',result.date_from?.slice(0,10)],['To',result.date_to?.slice(0,10)]].map(([l,v])=>(
                      <div key={l} style={{ fontSize:11, color:C.muted, marginBottom:2 }}>
                        <span>{l}: </span><span style={{ color:C.text, fontFamily:'monospace' }}>{v}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Info + uploads */}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <Card>
            <SectionTitle title="Supported CSV Formats"/>
            <div style={{ fontSize:11, color:C.muted, lineHeight:1.9 }}>
              <div style={{ background:C.bg, borderRadius:7, padding:'10px 12px', marginBottom:10, fontFamily:'monospace', fontSize:10 }}>
                date,open,high,low,close,volume<br/>
                2024-01-02,189.30,191.56,188.82,185.20,74000000<br/>
                2024-01-03,185.20,186.74,183.43,184.25,58000000
              </div>
              ✅ Auto-detects separators (comma, semicolon, tab)<br/>
              ✅ Auto-maps column aliases (Close->close, Adj Close->close)<br/>
              ✅ Parses any date format<br/>
              ✅ Missing OHLC filled from close if absent<br/>
              ✅ Saved to disk, reused in all training jobs<br/>
              ✅ Symbol auto-added to universe<br/><br/>
              <strong style={{ color:C.text }}>Tips for better training:</strong><br/>
              • More history = better (ideally 2+ years)<br/>
              • Higher frequency trains faster (daily is ideal)<br/>
              • Upload multiple symbols for cross-training
            </div>
          </Card>

          <Card>
            <SectionTitle title={`Uploaded Files (${uploads.length})`}/>
            {uploads.length === 0 ? (
              <div style={{ color:C.muted, fontSize:11, textAlign:'center', padding:'16px 0' }}>No uploads yet</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {uploads.map(u => (
                  <div key={u.symbol} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                    padding:'7px 10px', background:C.bg, borderRadius:7, border:`1px solid ${C.border}` }}>
                    <div>
                      <span style={{ fontFamily:'monospace', fontWeight:700, color:C.text, fontSize:12 }}>{u.symbol}</span>
                      <span style={{ fontSize:9, color:C.muted, marginLeft:8 }}>{u.file}</span>
                    </div>
                    <span style={{ fontSize:10, color:C.muted, fontFamily:'monospace' }}>{u.size_kb}kb</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ── HEALTH TAB ────────────────────────────────────────────────────────────────
function HealthTab() {
  const [h, setH] = useState(null)
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)

  const [writeTest, setWriteTest] = useState(null)

  const load = async () => {
    setLoading(true)
    const [health, data] = await Promise.all([api.health(), api.healthData()])
    if (health) setH(health)
    if (data)   setD(data)
    setLoading(false)
  }

  const testWrite = async () => {
    setWriteTest({ loading: true })
    const r = await api.get('/api/health/supabase/test-write')
    setWriteTest(r || { write_ok: false, error: 'No response' })
  }
  useEffect(() => { load() }, [])

  const Row = ({ label, ok, detail, note }) => (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 14px',
                  borderRadius:8, background:C.bg, border:`1px solid ${ok?C.green:C.red}33`, marginBottom:7 }}>
      <div style={{ width:10, height:10, borderRadius:'50%', flexShrink:0,
                    background: ok ? C.green : C.red,
                    boxShadow: `0 0 8px ${ok ? C.green : C.red}88` }}/>
      <div style={{ flex:1 }}>
        <span style={{ fontSize:12, fontWeight:700, color:C.text }}>{label}</span>
        {detail && <span style={{ fontSize:11, color:C.muted, marginLeft:10 }}>{detail}</span>}
      </div>
      {note && <span style={{ fontSize:10, color: ok ? C.green : C.yellow }}>{note}</span>}
    </div>
  )

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:16, fontWeight:700, margin:0, color:C.text }}>System Health</h2>
        <button onClick={load} style={{ padding:'6px 14px', borderRadius:7, cursor:'pointer',
          background:`${C.accent}22`, border:`1px solid ${C.accent}44`, color:C.accent, fontSize:11 }}>
          {loading ? '⏳' : '↺ Refresh'}
        </button>
      </div>

      {loading && <Spinner/>}

      {h && !loading && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase',
                          letterSpacing:1, marginBottom:10 }}>Backend</div>
            <Row label="API Server"  ok={true} detail={`v${h.version}`} note="running"/>
            <Row label="WebSocket"   ok={true} detail="ws/live" note="active"/>
            <Row label={`Agents (${h.agents})`} ok={h.agents > 0} detail="" note={`${h.queue} queued`}/>
            <Row label="Supabase DB"
                 ok={h.supabase?.connected}
                 detail={h.supabase?.connected ? 'Connected' : (h.supabase?.error || 'not connected')}
                 note={h.supabase?.connected ? 'ok' : 'check env vars'}/>
            {h.supabase?.connected && (
              <div style={{ marginBottom:7 }}>
                <button onClick={testWrite} style={{
                  padding:'5px 12px', borderRadius:6, cursor:'pointer', fontSize:10, fontWeight:700,
                  background:`${C.accent}18`, border:`1px solid ${C.accent}44`, color:C.accent,
                }}>🔬 Test DB Write (INSERT)</button>
                {writeTest && !writeTest.loading && (
                  <div style={{ marginTop:5, padding:'7px 10px', borderRadius:6, fontSize:10,
                    background: writeTest.write_ok ? `${C.green}15` : `${C.red}15`,
                    border:`1px solid ${writeTest.write_ok ? C.green : C.red}44`,
                    color: writeTest.write_ok ? C.green : C.red }}>
                    {writeTest.write_ok ? '✅ ' + writeTest.message : '❌ ' + writeTest.error}
                    {!writeTest.write_ok && writeTest.hint && (
                      <div style={{ color:C.yellow, marginTop:3 }}>{writeTest.hint}</div>
                    )}
                  </div>
                )}
              </div>
            )}
            <Row label="Environment" ok={true} detail={h.environment} note=""/>
          </div>

          {d && (
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase',
                            letterSpacing:1, marginBottom:10 }}>Data Sources</div>
              <Row label="yfinance"
                   ok={d.yfinance?.ok}
                   detail={d.yfinance?.status}
                   note={d.yfinance?.ok ? 'live data' : 'blocked'}/>
              <Row label="Synthetic Data"
                   ok={d.synthetic?.ok}
                   detail="Always available (deterministic)"
                   note="fallback"/>
              <Row label={`Custom CSV (${d.custom_uploads?.count || 0})`}
                   ok={true}
                   detail={d.custom_uploads?.count > 0 ? d.custom_uploads.files?.map(f=>f.symbol).join(', ') : 'no uploads yet'}
                   note=""/>
              <div style={{ marginTop:14, padding:'12px 14px', borderRadius:8,
                background: (d.use_synthetic || !d.yfinance?.ok) ? `${C.yellow}10` : `${C.green}10`,
                border:`1px solid ${(d.use_synthetic || !d.yfinance?.ok) ? C.yellow : C.green}44` }}>
                <div style={{ fontSize:12, fontWeight:700,
                  color: (d.use_synthetic || !d.yfinance?.ok) ? C.yellow : C.green, marginBottom:4 }}>
                  {(d.use_synthetic || !d.yfinance?.ok) ? '⚠ Using Synthetic Data' : '✅ Using Live Market Data'}
                </div>
                <div style={{ fontSize:11, color:C.muted, lineHeight:1.7 }}>
                  {(d.use_synthetic || !d.yfinance?.ok)
                    ? 'Yahoo Finance is blocked on this server (common on cloud platforms). Training uses realistic synthetic OHLCV data — agents still train properly. To use real data, set USE_SYNTHETIC_DATA=false and optionally upload CSV files.'
                    : 'Real Yahoo Finance data is being fetched. Agents train on live historical prices.'}
                </div>
                {!d.yfinance?.ok && (
                  <div style={{ marginTop:10, padding:'8px 12px', borderRadius:6,
                    background:C.bg, fontFamily:'monospace', fontSize:10, color:C.muted }}>
                    To force real data: set USE_SYNTHETIC_DATA=false in Render env<br/>
                    To upload custom data: go to Data tab
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Supabase setup instructions */}
      {h && !h.supabase?.connected && (
        <Card style={{ marginTop:16 }}>
          <SectionTitle title="Supabase Setup Required"
                        sub="Set these 3 env vars in Render Dashboard -> Environment"/>
          <div style={{ fontFamily:'monospace', fontSize:11, lineHeight:2, color:C.muted }}>
            {[
              ['SUPABASE_URL',              'https://YOUR_PROJECT.supabase.co'],
              ['SUPABASE_KEY',              'your-anon-public-key'],
              ['SUPABASE_SERVICE_ROLE_KEY', 'your-service-role-key (needed for writes)'],
            ].map(([k,v]) => (
              <div key={k} style={{ display:'flex', gap:14, padding:'4px 0',
                                    borderBottom:`1px solid ${C.border}22` }}>
                <span style={{ color:C.accent, minWidth:240 }}>{k}</span>
                <span style={{ color:C.dim }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop:12, fontSize:11, color:C.muted }}>
            Then run SQL migrations: <span style={{ color:C.accent }}>supabase/migrations/001_init.sql</span> and{' '}
            <span style={{ color:C.accent }}>002_model_versions.sql</span> in Supabase SQL Editor.
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Root page ─────────────────────────────────────────────────────────────────
export default function TrainingLabPage() {
  const [tab, setTab] = useState('models')

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>🧪 Training Lab</h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>
            Model registry · Backtesting · Symbol universe · Custom data
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:5, marginBottom:20 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding:'9px 18px', borderRadius:9, fontSize:12, cursor:'pointer',
            fontWeight: tab===t ? 700 : 400,
            background: tab===t ? `${C.accent}22` : C.surface,
            border:`1px solid ${tab===t?`${C.accent}66`:C.border}`,
            color: tab===t ? C.accent : C.muted,
            display:'flex', alignItems:'center', gap:6,
          }}>
            <span>{TAB_ICON[t]}</span>
            <span style={{ textTransform:'capitalize' }}>{t}</span>
          </button>
        ))}
      </div>

      {tab === 'models'   && <ModelsTab/>}
      {tab === 'backtest' && <BacktestTab/>}
      {tab === 'universe' && <UniverseTab/>}
      {tab === 'data'     && <DataTab/>}
      {tab === 'health'   && <HealthTab/>}
    </div>
  )
}
