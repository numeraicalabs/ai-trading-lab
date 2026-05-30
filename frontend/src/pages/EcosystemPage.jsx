import { useState, useEffect, useCallback, useRef } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { C, Card, SectionTitle, ProgressBar, Badge, Spinner } from '../components/shared'
import api from '../lib/api'

const TT = { contentStyle: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 } }
const HORIZONS = [
  { id:'scalping', label:'Scalping 5m',  color:C.red    },
  { id:'day',      label:'Day 1h',        color:C.yellow },
  { id:'swing',    label:'Swing 1d',      color:C.accent },
  { id:'position', label:'Position 1wk',  color:C.green  },
]

function AgentRow({ agent, onTrain, onCommentary, busy }) {
  const ic = agent.improvement > 0 ? C.green : agent.improvement < 0 ? C.red : C.muted
  const ac = (agent.latest_acc||0) > 65 ? C.green : (agent.latest_acc||0) > 50 ? C.yellow : C.red
  return (
    <tr style={{ borderBottom: `1px solid ${C.border}22` }}>
      <td style={{ padding:'10px 14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:`${agent.color}22`, border:`1px solid ${agent.color}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>{agent.icon}</div>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:C.text }}>{agent.name}</div>
            <div style={{ fontSize:10, color:agent.color, fontFamily:'monospace' }}>{agent.abbr}</div>
          </div>
        </div>
      </td>
      <td style={{ padding:'10px 14px' }}><Badge label={agent.state} color={agent.state==='Live'?C.green:agent.state==='Training'?C.yellow:C.muted}/></td>
      <td style={{ padding:'10px 14px', fontSize:11, color:C.cyan, fontFamily:'monospace' }}>{agent.horizon}</td>
      <td style={{ padding:'10px 14px', fontFamily:'monospace', fontSize:12, color:C.text }}>v{agent.model_version||0}<div style={{ fontSize:10, color:C.muted }}>{agent.versions_count||0} runs</div></td>
      <td style={{ padding:'10px 14px' }}>
        <div style={{ fontSize:14, fontWeight:700, color:ac, fontFamily:'monospace' }}>{(agent.latest_acc||0).toFixed(1)}%</div>
        <div style={{ marginTop:3 }}><ProgressBar value={agent.latest_acc||0} color={ac} height={3}/></div>
      </td>
      <td style={{ padding:'10px 14px', fontFamily:'monospace', fontSize:13, fontWeight:700, color:ic }}>
        {(agent.improvement||0) > 0 ? '▲' : (agent.improvement||0) < 0 ? '▼' : '─'} {Math.abs(agent.improvement||0).toFixed(2)}%
      </td>
      <td style={{ padding:'10px 14px', width:110 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
          <span style={{ fontSize:9, color:C.muted }}>LEARNING</span>
          <span style={{ fontSize:9, color:agent.color, fontFamily:'monospace' }}>{agent.progress||0}%</span>
        </div>
        <ProgressBar value={agent.progress||0} color={agent.color} height={5}/>
      </td>
      <td style={{ padding:'10px 14px' }}>
        <div style={{ display:'flex', gap:5 }}>
          <button onClick={()=>onTrain(agent.abbr,false)} disabled={busy[agent.abbr]} style={{ padding:'5px 9px', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer', background:`${C.accent}22`, border:`1px solid ${C.accent}44`, color:C.accent, opacity:busy[agent.abbr]?0.5:1 }}>⚡ Train</button>
          <button onClick={()=>onTrain(agent.abbr,true)}  disabled={busy[agent.abbr]} style={{ padding:'5px 9px', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer', background:`${C.yellow}22`, border:`1px solid ${C.yellow}44`, color:C.yellow, opacity:busy[agent.abbr]?0.5:1 }}>↺ Force</button>
          <button onClick={()=>onCommentary(agent.abbr)} style={{ padding:'5px 7px', borderRadius:6, fontSize:10, cursor:'pointer', background:`${C.purple}22`, border:`1px solid ${C.purple}44`, color:C.purple }}>🤖</button>
        </div>
      </td>
    </tr>
  )
}

function JobRow({ job }) {
  const sc = { completed:C.green, running:C.yellow, failed:C.red, queued:C.muted, cancelled:C.dim }[job.status] || C.muted
  const elapsed = job.started_at ? Math.round((Date.now()-new Date(job.started_at))/1000) : null
  return (
    <tr style={{ borderBottom:`1px solid ${C.border}22`, fontSize:11 }}>
      <td style={{ padding:'7px 11px', fontFamily:'monospace', color:C.dim, fontSize:10 }}>{job.job_id?.split('-').slice(-1)[0]||'—'}</td>
      <td style={{ padding:'7px 11px', fontWeight:700, color:C.text }}>{job.agent_abbr}</td>
      <td style={{ padding:'7px 11px', color:C.muted, fontFamily:'monospace' }}>{job.symbol}/{job.horizon}</td>
      <td style={{ padding:'7px 11px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Badge label={job.status} color={sc}/>
          {job.status==='running'&&<div style={{ flex:1, minWidth:70 }}><ProgressBar value={job.progress||0} color={C.yellow} height={4}/><div style={{ fontSize:9, color:C.muted, marginTop:1 }}>{job.stage}</div></div>}
        </div>
      </td>
      <td style={{ padding:'7px 11px', color:C.muted, fontFamily:'monospace', fontSize:10 }}>{elapsed!==null?`${elapsed}s`:'—'}</td>
      <td style={{ padding:'7px 11px' }}>
        {job.status==='completed'&&job.result?.accuracy!==undefined&&(
          <span style={{ color:C.green, fontFamily:'monospace', fontSize:11 }}>{(job.result.accuracy*100||0).toFixed(1)}%</span>
        )}
        {job.status==='failed'&&<span style={{ color:C.red, fontSize:10 }}>{job.error?.slice(0,35)}</span>}
      </td>
    </tr>
  )
}

export default function EcosystemPage({ lastMessage }) {
  const [status,setStatus]=useState(null)
  const [jobs,setJobs]=useState([])
  const [busy,setBusy]=useState({})
  const [globalH,setGlobalH]=useState('swing')
  const [commentary,setCommentary]=useState({abbr:'',text:''})
  const [logs,setLogs]=useState([])
  const [autoRefresh,setAutoRefresh]=useState(true)

  const log=(msg,color=C.muted)=>setLogs(l=>[`[${new Date().toLocaleTimeString()}] ${msg}`,...l].slice(0,60))

  const fetchAll=useCallback(async()=>{
    const [s,j]=await Promise.all([api.ecoStatus(),api.trainingJobs()])
    if(s)setStatus(s)
    if(j)setJobs(j)
  },[])

  useEffect(()=>{ fetchAll() },[fetchAll])
  useEffect(()=>{ if(!autoRefresh)return; const id=setInterval(fetchAll,3500); return()=>clearInterval(id) },[autoRefresh,fetchAll])

  useEffect(()=>{
    if(!lastMessage)return
    if(lastMessage.type==='training_progress'){ const j=lastMessage.job; log(`${j.agent_abbr} — ${j.stage} (${j.progress}%)`,C.yellow); setJobs(prev=>{ const idx=prev.findIndex(x=>x.job_id===j.job_id); if(idx>=0){const n=[...prev];n[idx]=j;return n} return [j,...prev] }) }
    if(lastMessage.type==='training_queued') log(`Queued: ${lastMessage.job.agent_abbr} on ${lastMessage.job.symbol}/${lastMessage.job.horizon}`,C.cyan)
    if(lastMessage.type==='training_failed') log(`❌ Failed: ${lastMessage.job.agent_abbr} — ${lastMessage.job.error}`,C.red)
  },[lastMessage])

  const trainAgent=async(abbr,force)=>{
    setBusy(b=>({...b,[abbr]:true})); log(`${force?'Force-retrain':'Training'} ${abbr}…`,C.accent)
    const cfg=status?.agents?.find(a=>a.abbr===abbr); const h=cfg?.horizon||globalH
    const res=await api.trainAgent(abbr,{symbol:'SPY',horizon:h,force_retrain:force})
    if(res?.job_id){log(`Job created: ${res.job_id}`,C.green);setJobs(j=>[res,...j])}
    else log(`Error queuing ${abbr}`,C.red)
    setBusy(b=>({...b,[abbr]:false}))
  }

  const trainAll=async(force)=>{
    log(`Queueing all agents (${globalH}, force=${force})…`,C.accent)
    const res=await api.trainAll({horizon:globalH,force_retrain:force,agents:[]})
    if(res?.queued){log(`✅ Queued ${res.queued} agents`,C.green);await fetchAll()}
    else log('Error',C.red)
  }

  const getCommentary=async(abbr)=>{
    setCommentary({abbr,text:''})
    const res=await api.commentary(abbr)
    setCommentary({abbr,text:res?.commentary||'⚠️ Ollama not running — run: ollama serve'})
    log(`Commentary for ${abbr}`,C.purple)
  }

  const agents=status?.agents||[]
  const running=jobs.filter(j=>j.status==='running')
  const accData=agents.map(a=>({name:a.abbr,acc:a.latest_acc||0}))
  const impData=agents.filter(a=>(a.improvement||0)!==0).map(a=>({name:a.abbr,delta:a.improvement||0}))

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0 }}>🧬 Agent Ecosystem</h1>
          <p style={{ color:C.muted, fontSize:12, margin:'4px 0 0' }}>Train · Monitor · Version · Auto-improve · {status?.total_models||0} models saved to Supabase</p>
        </div>
        <div style={{ display:'flex', gap:7, alignItems:'center', flexWrap:'wrap' }}>
          {HORIZONS.map(h=>(
            <button key={h.id} onClick={()=>setGlobalH(h.id)} style={{ padding:'6px 11px', borderRadius:7, fontSize:11, cursor:'pointer', background:globalH===h.id?`${h.color}22`:C.surface, border:`1px solid ${globalH===h.id?`${h.color}66`:C.border}`, color:globalH===h.id?h.color:C.muted }}>{h.label}</button>
          ))}
          <button onClick={()=>trainAll(false)} style={{ padding:'8px 16px', borderRadius:8, background:`${C.accent}22`, border:`1px solid ${C.accent}66`, color:C.accent, fontSize:12, fontWeight:700, cursor:'pointer' }}>⚡ Train All</button>
          <button onClick={()=>trainAll(true)}  style={{ padding:'8px 16px', borderRadius:8, background:`${C.yellow}22`, border:`1px solid ${C.yellow}66`, color:C.yellow, fontSize:12, fontWeight:700, cursor:'pointer' }}>↺ Retrain All</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:20 }}>
        {[
          ['Total Models',  status?.total_models||0,          C.text],
          ['Queue',         status?.queue_size||0,            C.yellow],
          ['Running',       running.length,                   running.length>0?C.yellow:C.muted],
          ['Jobs Today',    jobs.length,                      C.accent],
          ['Avg Accuracy',  agents.length?(agents.reduce((s,a)=>s+(a.latest_acc||0),0)/agents.length).toFixed(1)+'%':'—', C.green],
        ].map(([l,v,c])=>(
          <Card key={l}><div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>{l}</div><div style={{ fontSize:22, fontWeight:800, color:c, fontFamily:"'JetBrains Mono',monospace" }}>{v}</div></Card>
        ))}
      </div>

      {/* Charts */}
      {agents.length>0&&(
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
          <Card>
            <SectionTitle title="Model Accuracy by Agent" sub="Latest trained model %"/>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={accData} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                <XAxis dataKey="name" tick={{fontSize:10,fill:C.muted}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false} domain={[40,100]}/>
                <Tooltip {...TT}/>
                <Bar dataKey="acc" name="Accuracy %" fill={C.accent} radius={[4,4,0,0]} label={{position:'top',fontSize:9,fill:C.muted,formatter:v=>`${v.toFixed(0)}%`}}/>
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <SectionTitle title="Improvement vs Previous Version" sub="Δ accuracy %"/>
            {impData.length>0?(
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={impData} barSize={22}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                  <XAxis dataKey="name" tick={{fontSize:10,fill:C.muted}} tickLine={false} axisLine={false}/>
                  <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                  <Tooltip {...TT} formatter={v=>[`${v>0?'+':''}${v.toFixed(2)}%`,'Δ']}/>
                  <Bar dataKey="delta" name="Δ%" fill={C.green} radius={[4,4,0,0]} label={{position:'top',fontSize:9,fill:C.muted,formatter:v=>`${v>0?'+':''}${v.toFixed(1)}%`}}/>
                </BarChart>
              </ResponsiveContainer>
            ):(
              <div style={{ height:140, display:'flex', alignItems:'center', justifyContent:'center', color:C.muted, fontSize:12 }}>Train agents to see improvement deltas</div>
            )}
          </Card>
        </div>
      )}

      {/* Agent Table */}
      <Card style={{ marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <SectionTitle title="Agent Control Panel" sub="Manage ML models per agent"/>
          <div style={{ display:'flex', gap:7, alignItems:'center' }}>
            <div style={{ width:6, height:6, borderRadius:99, background:autoRefresh?C.green:C.muted }}/>
            <button onClick={()=>setAutoRefresh(a=>!a)} style={{ fontSize:10, background:'none', border:`1px solid ${C.border}`, borderRadius:5, padding:'3px 8px', color:C.muted, cursor:'pointer' }}>{autoRefresh?'Auto ✓':'Paused'}</button>
            <button onClick={fetchAll} style={{ fontSize:10, background:'none', border:`1px solid ${C.border}`, borderRadius:5, padding:'3px 8px', color:C.muted, cursor:'pointer' }}>↺</button>
          </div>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              {['Agent','Status','Horizon','Version','Accuracy','Δ Prev','Learning','Actions'].map(h=>(
                <th key={h} style={{ textAlign:'left', padding:'8px 14px', color:C.muted, fontSize:10, textTransform:'uppercase', letterSpacing:.8, borderBottom:`1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {agents.length>0
                ? agents.map(a=><AgentRow key={a.abbr} agent={a} onTrain={trainAgent} onCommentary={getCommentary} busy={busy}/>)
                : <tr><td colSpan={8} style={{ padding:24, textAlign:'center', color:C.muted }}><Spinner/></td></tr>
              }
            </tbody>
          </table>
        </div>
      </Card>

      {/* Jobs + Log */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
        <Card>
          <SectionTitle title="Training Jobs" sub={`${jobs.length} total · ${running.length} running`}/>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                {['ID','Agent','Target','Status','Time','Result'].map(h=>(
                  <th key={h} style={{ textAlign:'left', padding:'6px 11px', color:C.muted, fontSize:9, textTransform:'uppercase', letterSpacing:.8, borderBottom:`1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {jobs.slice(0,15).map((j,i)=><JobRow key={j.job_id||i} job={j}/>)}
                {jobs.length===0&&<tr><td colSpan={6} style={{ padding:'20px 11px', textAlign:'center', color:C.muted, fontSize:11 }}>No jobs yet — click Train All to start</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <SectionTitle title="Training Log" sub="Real-time activity"/>
            <button onClick={()=>setLogs([])} style={{ fontSize:10, background:'none', border:`1px solid ${C.border}`, borderRadius:5, padding:'3px 7px', color:C.muted, cursor:'pointer' }}>Clear</button>
          </div>
          <div style={{ height:250, overflowY:'auto', fontFamily:'monospace', fontSize:10, display:'flex', flexDirection:'column', gap:2 }}>
            {logs.length===0
              ? <div style={{ color:C.muted, padding:'20px 0', textAlign:'center' }}>Waiting for activity…</div>
              : logs.map((m,i)=><div key={i} style={{ color:C.muted, lineHeight:1.5, borderBottom:`1px solid ${C.border}11`, paddingBottom:2 }}>{m}</div>)
            }
          </div>
        </Card>
      </div>

      {/* Version History */}
      <Card>
        <SectionTitle title="Model Version Progress" sub="Accuracy per agent across training runs"/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
          {agents.slice(0,6).map(a=>(
            <div key={a.abbr} style={{ background:C.bg, borderRadius:8, padding:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:7 }}>
                <span style={{ fontSize:11, fontWeight:700, color:a.color }}>{a.abbr} — {a.name}</span>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <span style={{ fontSize:10, color:C.muted, fontFamily:'monospace' }}>v{a.model_version||0}</span>
                  <span style={{ fontSize:11, fontWeight:700, color:(a.latest_acc||0)>65?C.green:C.yellow, fontFamily:'monospace' }}>{(a.latest_acc||0).toFixed(1)}%</span>
                </div>
              </div>
              <ProgressBar value={a.latest_acc||0} color={a.color} height={5}/>
              <div style={{ marginTop:5, fontSize:10, color:(a.improvement||0)>=0?C.green:C.red, fontFamily:'monospace' }}>
                {(a.improvement||0)>0?'▲':(a.improvement||0)<0?'▼':'─'} {(a.improvement||0)!==0?`${Math.abs(a.improvement||0).toFixed(2)}% from last run`:'no prev version'}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Commentary panel */}
      {commentary.abbr&&(
        <div style={{ position:'fixed', bottom:90, right:24, width:360, background:'#0d1525', border:`1px solid ${C.border}`, borderRadius:12, padding:18, zIndex:200, boxShadow:'0 8px 32px #000a' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
            <span style={{ fontSize:12, fontWeight:700, color:C.text }}>🤖 AI Commentary — {commentary.abbr}</span>
            <button onClick={()=>setCommentary({abbr:'',text:''})} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:16 }}>✕</button>
          </div>
          <div style={{ fontSize:12, color:C.muted, lineHeight:1.7, whiteSpace:'pre-wrap' }}>{commentary.text||'Loading…'}</div>
        </div>
      )}
    </div>
  )
}
