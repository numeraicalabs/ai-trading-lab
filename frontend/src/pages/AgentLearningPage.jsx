/**
 * Agent Learning Monitor — apprendimento individuale per ogni agente.
 *
 * Per ogni agente mostra:
 *   - Curva accuracy OOS nel tempo
 *   - Trend: miglioramento / degradazione
 *   - Comparazione train vs OOS (overfit detector)
 *   - Feature importance evolution
 *   - Scheduler status + retrain log
 */
import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { C, Card, SectionTitle, Badge, ProgressBar, Spinner, TT } from '../components/UI'
import api from '../lib/api'

const AGENTS = ['MOM','MRV','PPO','DQN','MAC','SEN','VOL','REG','OPT','SCOUT']
const AGENT_COLORS = {
  MOM:'#06b6d4',MRV:'#8b5cf6',PPO:'#3b82f6',DQN:'#ec4899',MAC:'#f59e0b',
  SEN:'#f97316',VOL:'#ef4444',REG:'#14b8a6',OPT:'#10b981',SCOUT:'#f0abfc',
}

function TrendArrow({ trend }) {
  if (!trend && trend !== 0) return null
  const c = trend > 0 ? C.green : trend < 0 ? C.red : C.muted
  return (
    <span style={{ color:c, fontFamily:'monospace', fontSize:12, fontWeight:700 }}>
      {trend > 0 ? '▲' : trend < 0 ? '▼' : '─'} {Math.abs(trend).toFixed(1)}%
    </span>
  )
}

function AgentLearningCard({ abbr, history, onClick, selected }) {
  const color   = AGENT_COLORS[abbr] || C.accent
  const entries = history?.entries || []
  const latest  = history?.latest_acc || 0
  const best    = history?.best_acc   || 0
  const trend   = history?.trend      || 0
  const runs    = history?.total_runs || 0

  // Sparkline data (last 15 entries)
  const spark = entries.slice(0,15).reverse().map((e,i) => ({ i, v: e.accuracy }))

  const accColor = latest >= 65 ? C.green : latest >= 55 ? C.yellow : C.red

  return (
    <div onClick={() => onClick(abbr)}
      style={{
        background: selected ? `${color}12` : C.card,
        border: `1px solid ${selected ? color : C.border}`,
        borderRadius:12, padding:16, cursor:'pointer',
        boxShadow: selected ? `0 0 20px ${color}20` : 'none',
        transition:'all .2s',
      }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:32, height:32, borderRadius:8, fontSize:16,
                        background:`${color}22`, border:`1px solid ${color}44`,
                        display:'flex', alignItems:'center', justifyContent:'center' }}>
            {abbr === 'SCOUT' ? '🔭' : abbr[0]}
          </div>
          <div>
            <div style={{ fontFamily:'monospace', fontWeight:700, color:color }}>{abbr}</div>
            <div style={{ fontSize:9, color:C.muted }}>{runs} runs</div>
          </div>
        </div>
        <TrendArrow trend={trend}/>
      </div>

      {/* OOS Accuracy */}
      <div style={{ marginBottom:8 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
          <span style={{ fontSize:10, color:C.muted }}>OOS Accuracy</span>
          <span style={{ fontSize:13, fontWeight:800, color:accColor, fontFamily:'monospace' }}>
            {latest.toFixed(1)}%
          </span>
        </div>
        <ProgressBar value={latest} color={accColor} height={5}/>
      </div>

      {/* Sparkline */}
      {spark.length > 1 ? (
        <ResponsiveContainer width="100%" height={44}>
          <AreaChart data={spark}>
            <defs>
              <linearGradient id={`g${abbr}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.25}/>
                <stop offset="95%" stopColor={color} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <ReferenceLine y={50} stroke={C.border} strokeDasharray="3 3"/>
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
                  fill={`url(#g${abbr})`} dot={false} isAnimationActive={false}/>
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height:44, display:'flex', alignItems:'center', justifyContent:'center',
                      color:C.dim, fontSize:10 }}>
          No training history yet
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'space-between', marginTop:6 }}>
        <span style={{ fontSize:9, color:C.muted }}>Best: <span style={{ color:C.green, fontFamily:'monospace' }}>{best.toFixed(1)}%</span></span>
        <span style={{ fontSize:9, color:C.muted }}>Latest: <span style={{ color:accColor, fontFamily:'monospace' }}>{latest.toFixed(1)}%</span></span>
      </div>
    </div>
  )
}

function AgentLearningDetail({ abbr, history }) {
  const color   = AGENT_COLORS[abbr] || C.accent
  const entries = (history?.entries || []).slice(0, 40)

  if (!entries.length) {
    return (
      <Card>
        <div style={{ padding:'30px 0', textAlign:'center', color:C.muted, fontSize:12 }}>
          No training history for {abbr} yet.<br/>
          <span style={{ fontSize:11 }}>Go to Ecosystem and click Train to generate history.</span>
        </div>
      </Card>
    )
  }

  const chartData = [...entries].reverse().map((e, i) => ({
    i,
    oos:     e.accuracy,
    train:   e.accuracy_train || e.train_acc || 0,
    cv:      e.cv_mean || 0,
    overfit: e.overfit || 0,
    f1:      Math.round((e.f1 || 0) * 100),
    label:   new Date(e.ts).toLocaleDateString(),
  }))

  const fiData = entries[0]
    ? Object.entries(entries[0]).filter(([k]) =>
        !['ts','abbr','symbol','horizon','accuracy','train_acc','cv_mean','cv_std','overfit','samples','f1','precision','recall'].includes(k)
      ).slice(0, 8)
    : []

  const latest = entries[0] || {}

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* KPI row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10 }}>
        {[
          ['OOS Acc',      latest.accuracy?.toFixed(1)+'%',      latest.accuracy>=65?C.green:latest.accuracy>=55?C.yellow:C.red],
          ['Train Acc',    latest.train_acc?.toFixed(1)+'%' || '—',   C.text],
          ['CV Mean',      latest.cv_mean?.toFixed(1)+'%'  || '—',    C.cyan],
          ['Overfit Gap',  (latest.overfit >= 0 ? '+' : '') + (latest.overfit?.toFixed(1)||'0')+'%', latest.overfit>15?C.red:C.green],
          ['F1 Score',     latest.f1?.toFixed(3)    || '—',      C.text],
          ['Total Runs',   history?.total_runs || 0,             C.accent],
        ].map(([l,v,c]) => (
          <Card key={l} style={{ padding:12 }}>
            <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:5 }}>{l}</div>
            <div style={{ fontSize:17, fontWeight:800, color:c, fontFamily:'monospace' }}>{v}</div>
          </Card>
        ))}
      </div>

      {/* Learning curves */}
      <Card>
        <SectionTitle title={`${abbr} Learning Curves`} sub="OOS vs Train accuracy over time — gap = overfit"/>
        <div style={{ display:'flex', gap:14, marginBottom:10 }}>
          {[['OOS Accuracy',color],['Train Accuracy',C.dim],['CV Mean',C.cyan]].map(([l,c])=>(
            <div key={l} style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ width:16, height:2, background:c, borderRadius:99 }}/>
              <span style={{ fontSize:10, color:C.muted }}>{l}</span>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
            <XAxis dataKey="label" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
            <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false} domain={[40,100]}/>
            <Tooltip {...TT} formatter={(v,n) => [`${v.toFixed(1)}%`, n]}/>
            <ReferenceLine y={50} stroke={C.red} strokeDasharray="4 4" label={{ value:'50% baseline', fontSize:9, fill:C.red }}/>
            <ReferenceLine y={65} stroke={C.green} strokeDasharray="4 4" label={{ value:'65% target', fontSize:9, fill:C.green }}/>
            <Line type="monotone" dataKey="oos"   name="OOS Accuracy" stroke={color}  strokeWidth={2.5} dot={{r:3}} isAnimationActive={false}/>
            <Line type="monotone" dataKey="train" name="Train Accuracy" stroke={C.dim} strokeWidth={1}   dot={false} strokeDasharray="4 4" isAnimationActive={false}/>
            <Line type="monotone" dataKey="cv"    name="CV Mean" stroke={C.cyan}  strokeWidth={1.5} dot={false} strokeDasharray="2 4" isAnimationActive={false}/>
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Overfit + F1 */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <Card>
          <SectionTitle title="Overfit Gap" sub="Train − OOS (lower = better generalization)"/>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} barSize={14}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
              <XAxis dataKey="label" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
              <Tooltip {...TT} formatter={v=>[`${v.toFixed(1)}%`,'Overfit Gap']}/>
              <ReferenceLine y={15} stroke={C.red} strokeDasharray="3 3"/>
              <Bar dataKey="overfit" name="Overfit Gap"
                   fill={C.yellow} radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionTitle title="F1 Score" sub="Precision × Recall balance (only for classifiers)"/>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="f1g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={color} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis dataKey="label" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
              <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false} domain={[0,100]}/>
              <Tooltip {...TT} formatter={v=>[`${v}%`,'F1']}/>
              <Area type="monotone" dataKey="f1" name="F1" stroke={color} strokeWidth={2}
                    fill="url(#f1g)" dot={false} isAnimationActive={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Training run table */}
      <Card>
        <SectionTitle title="Training Run History" sub="All recorded training sessions"/>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead><tr>
              {['Run','Symbol','Horizon','OOS Acc','Train Acc','CV','Overfit','F1','Samples','Date'].map(h=>(
                <th key={h} style={{ textAlign:'left', padding:'6px 11px', color:C.muted,
                  fontSize:9, textTransform:'uppercase', letterSpacing:.8,
                  borderBottom:`1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {entries.map((e,i) => {
                const ac = e.accuracy >= 65 ? C.green : e.accuracy >= 55 ? C.yellow : C.red
                return (
                  <tr key={i} style={{ borderBottom:`1px solid ${C.border}22`,
                                       background: i===0?`${color}08`:'transparent' }}>
                    <td style={{ padding:'7px 11px', color:C.dim, fontFamily:'monospace', fontSize:10 }}>#{i+1}</td>
                    <td style={{ padding:'7px 11px', color:C.text, fontFamily:'monospace', fontWeight:700 }}>{e.symbol}</td>
                    <td style={{ padding:'7px 11px' }}><Badge label={e.horizon} color={C.purple}/></td>
                    <td style={{ padding:'7px 11px', color:ac, fontFamily:'monospace', fontWeight:700 }}>{e.accuracy?.toFixed(1)}%</td>
                    <td style={{ padding:'7px 11px', color:C.muted, fontFamily:'monospace' }}>{e.train_acc?.toFixed(1)||'—'}%</td>
                    <td style={{ padding:'7px 11px', color:C.cyan, fontFamily:'monospace' }}>{e.cv_mean?.toFixed(1)||'—'}%</td>
                    <td style={{ padding:'7px 11px', fontFamily:'monospace',
                                 color: (e.overfit||0) > 15 ? C.red : C.green }}>
                      {(e.overfit||0) > 0 ? '+' : ''}{(e.overfit||0).toFixed(1)}%
                    </td>
                    <td style={{ padding:'7px 11px', color:C.text, fontFamily:'monospace' }}>{e.f1?.toFixed(3)||'—'}</td>
                    <td style={{ padding:'7px 11px', color:C.muted, fontFamily:'monospace', fontSize:10 }}>{e.samples||'—'}</td>
                    <td style={{ padding:'7px 11px', color:C.muted, fontSize:10, whiteSpace:'nowrap' }}>
                      {new Date(e.ts).toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Root page ─────────────────────────────────────────────────────────────────
export default function AgentLearningPage() {
  const [histories,  setHistories]  = useState({})
  const [selected,   setSelected]   = useState('MOM')
  const [scheduler,  setScheduler]  = useState(null)
  const [loading,    setLoading]    = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [hist, sched] = await Promise.all([
      api.get('/api/scheduler/history'),
      api.get('/api/scheduler/status'),
    ])
    if (hist && typeof hist === 'object') {
      // hist is {abbr: {entries, latest_acc, ...}}
      const mapped = {}
      for (const [abbr, data] of Object.entries(hist)) {
        mapped[abbr] = {
          entries: Array.isArray(data) ? data : (data.entries || data || []),
          latest_acc: Array.isArray(data) ? (data[0]?.accuracy||0) : (data.latest_acc||data[0]?.accuracy||0),
          best_acc:   Array.isArray(data) ? Math.max(...data.map(e=>e.accuracy||0)) : (data.best_acc||0),
          trend:      Array.isArray(data) && data.length>=2 ? data[0].accuracy - data[data.length-1].accuracy : 0,
          total_runs: Array.isArray(data) ? data.length : (data.total_runs||data.entries?.length||0),
        }
      }
      setHistories(mapped)
    }
    if (sched) setScheduler(sched)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    // Also load individual detail when selected changes
    const abbr = selected
    api.get(`/api/scheduler/history/${abbr}?limit=50`)
      .then(d => {
        if (d && !d.message) {
          setHistories(prev => ({ ...prev, [abbr]: d }))
        }
      })
  }, [selected])

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>📚 Agent Learning Monitor</h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>
            OOS accuracy · Learning curves · Overfit detection · Auto-scheduler
          </p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {scheduler && (
            <div style={{ padding:'6px 12px', borderRadius:7, fontSize:11,
              background: scheduler.enabled ? `${C.green}18` : `${C.yellow}18`,
              border:`1px solid ${scheduler.enabled ? C.green : C.yellow}44`,
              color: scheduler.enabled ? C.green : C.yellow }}>
              {scheduler.enabled
                ? `⚡ Auto-retrain ON (every ${scheduler.interval_min}min)`
                : '⏸ Auto-retrain OFF'}
            </div>
          )}
          <button onClick={load} style={{ padding:'7px 14px', borderRadius:7, cursor:'pointer',
            background:`${C.accent}22`, border:`1px solid ${C.accent}44`, color:C.accent, fontSize:11 }}>
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* Agent grid */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:12, marginBottom:24 }}>
        {loading ? <Spinner/> :
          AGENTS.map(abbr => (
            <AgentLearningCard
              key={abbr}
              abbr={abbr}
              history={histories[abbr]}
              onClick={setSelected}
              selected={selected === abbr}
            />
          ))
        }
      </div>

      {/* Detail for selected agent */}
      {selected && (
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
            <div style={{ width:8, height:8, borderRadius:'50%',
                          background: AGENT_COLORS[selected]||C.accent }}/>
            <h2 style={{ fontSize:16, fontWeight:800, margin:0, color:AGENT_COLORS[selected]||C.accent }}>
              {selected} — Learning Detail
            </h2>
          </div>
          <AgentLearningDetail abbr={selected} history={histories[selected]}/>
        </div>
      )}

      {/* Scheduler retrain log */}
      {scheduler?.retrain_log?.length > 0 && (
        <Card style={{ marginTop:20 }}>
          <SectionTitle title="Auto-Retrain Log" sub="Triggered by scheduler"/>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead><tr>
                {['Time','Agent','Target','Reason','Triggered By'].map(h=>(
                  <th key={h} style={{ textAlign:'left', padding:'6px 11px', color:C.muted,
                    fontSize:9, textTransform:'uppercase', letterSpacing:.8,
                    borderBottom:`1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {scheduler.retrain_log.map((r,i)=>(
                  <tr key={i} style={{ borderBottom:`1px solid ${C.border}22` }}>
                    <td style={{ padding:'7px 11px', color:C.muted, fontSize:10, fontFamily:'monospace' }}>
                      {new Date(r.ts).toLocaleString()}
                    </td>
                    <td style={{ padding:'7px 11px', color:AGENT_COLORS[r.abbr]||C.text,
                                 fontFamily:'monospace', fontWeight:700 }}>{r.abbr}</td>
                    <td style={{ padding:'7px 11px', color:C.muted, fontFamily:'monospace' }}>
                      {r.symbol}/{r.horizon}
                    </td>
                    <td style={{ padding:'7px 11px', color:C.text }}>{r.reason}</td>
                    <td style={{ padding:'7px 11px' }}>
                      <Badge label={r.triggered_by}
                             color={r.triggered_by==='degradation'?C.red:
                                    r.triggered_by==='staleness'?C.yellow:C.cyan}/>
                    </td>
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
