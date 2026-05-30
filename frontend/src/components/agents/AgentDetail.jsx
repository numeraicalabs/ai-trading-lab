import { useState } from 'react'
import { AreaChart,Area,LineChart,Line,XAxis,YAxis,CartesianGrid,Tooltip,ResponsiveContainer } from 'recharts'
import { Badge,ProgressBar,C,pct,fmt,mono,Card,SectionTitle,Spinner } from '../shared'

function rng(s){ let x=s; return ()=>{ x=(x*16807)%2147483647; return (x-1)/2147483646 } }
function genEq(n,start,drift,vol,seed){ const r=rng(seed); let v=start; return Array.from({length:n},()=>{ v=v*(1+drift+(r()-0.5)*vol); return {v:+v.toFixed(2)} }) }

const TT = { contentStyle:{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:11} }
const TABS = ['overview','learning','risk','trades']

export function AgentDetail({ agent, onBack }) {
  const [tab, setTab] = useState('overview')

  const seed = agent.abbr?.charCodeAt(0)||65
  const tradeLog = Array.from({length:16},(_,i)=>{
    const r=rng(seed*100+i)
    const side=r()>0.48?'BUY':'SELL'
    const pnl=+((r()-0.38)*2.4).toFixed(2)
    const arr=agent.assets||agent.primary_assets||['SPY']
    const sym=arr[Math.floor(r()*arr.length)]
    const mo=String(Math.floor(r()*12)+1).padStart(2,'0')
    const dy=String(Math.floor(r()*28)+1).padStart(2,'0')
    return {i,side,sym,pnl,date:`2024-${mo}-${dy}`}
  })
  const lossData=Array.from({length:60},(_,i)=>{ const r=rng(seed*200+i); return {ep:i,loss:Math.max(0.01,2.5*Math.exp(-i*0.04)+(r()-0.5)*0.3)} })
  const feats=[['RSI',0.22],['MACD',0.18],['Volume',0.14],['Momentum',0.12],['BB',0.11],['ATR',0.09],['SMA20',0.08],['Sentiment',0.06]]
  const mcPaths=Array.from({length:6},(_,si)=>genEq(60,100,0.001*(si-2),0.04,si*77+(seed||1)))
  const kpis=[
    ['Return',pct(agent.perf||0),(agent.perf||0)>=0?C.green:C.red],
    ['Sharpe',(agent.sharpe||0).toFixed(2),C.text],
    ['Sortino',(agent.sortino||0).toFixed(2),C.text],
    ['Max DD',(agent.maxDD||agent.max_drawdown||0)+'%',C.red],
    ['Win Rate',(agent.winRate||agent.win_rate||0)+'%',C.green],
    ['Accuracy',(agent.accuracy||0)+'%',agent.color],
    ['Trades',agent.trades_count||0,C.text],
    ['Alpha',fmt(agent.alpha||0)+'%',C.cyan],
    ['Confidence',Math.round(agent.confidence||0)+'/100',agent.color],
    ['P.Factor',(agent.profitFactor||agent.profit_factor||1).toFixed(1),C.text],
  ]
  return (
    <div className="fade-in">
      <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:20}}>
        <button onClick={onBack} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:'7px 14px',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',gap:5}}>← Back</button>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          <div style={{width:44,height:44,borderRadius:12,background:`${agent.color}22`,border:`1px solid ${agent.color}44`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>{agent.icon}</div>
          <div>
            <h1 style={{fontSize:18,fontWeight:800,color:C.text,margin:0}}>{agent.name}</h1>
            <p style={{fontSize:11,color:C.muted,margin:0}}>{agent.strategy} · {agent.type}</p>
          </div>
          <Badge label={agent.state} color={agent.stateColor||C.green}/>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginBottom:20}}>
        {kpis.map(([l,v,c])=>(
          <Card key={l}><div style={{fontSize:9,color:C.muted,textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>{l}</div><div style={{fontSize:18,fontWeight:800,color:c,...mono}}>{v}</div></Card>
        ))}
      </div>
      <div style={{display:'flex',gap:4,marginBottom:18}}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{padding:'7px 16px',borderRadius:8,fontSize:12,fontWeight:tab===t?700:400,background:tab===t?`${agent.color}22`:C.surface,border:`1px solid ${tab===t?`${agent.color}66`:C.border}`,color:tab===t?agent.color:C.muted,textTransform:'capitalize',cursor:'pointer'}}>{t}</button>
        ))}
      </div>
      {tab==='overview' && (
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:16}}>
          <Card>
            <SectionTitle title="Equity Curve" sub="Paper trading performance"/>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={agent.equity||[]}>
                <defs><linearGradient id="agd" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={agent.color} stopOpacity={0.25}/><stop offset="95%" stopColor={agent.color} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="i" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/><YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/><Area type="monotone" dataKey="v" stroke={agent.color} strokeWidth={2} fill="url(#agd)" dot={false} isAnimationActive={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <SectionTitle title="Actions & Features"/>
            {[['Buy',C.green,Math.round((agent.winRate||55)*.6)],['Sell',C.red,Math.round((agent.winRate||55)*.5)],['Hold',C.muted,40]].map(([l,c,v])=>(
              <div key={l} style={{marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{fontSize:12,color:C.text}}>{l}</span><span style={{fontSize:11,color:c,fontFamily:'monospace'}}>{v}%</span></div>
                <ProgressBar value={v} color={c} height={5}/>
              </div>
            ))}
            <div style={{marginTop:16,fontSize:12,fontWeight:700,color:C.text,marginBottom:10}}>Feature Importance</div>
            {feats.slice(0,5).map(([n,v])=>(
              <div key={n} style={{marginBottom:7}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}><span style={{fontSize:11,color:C.muted}}>{n}</span><span style={{fontSize:10,color:agent.color,fontFamily:'monospace'}}>{(v*100).toFixed(0)}%</span></div>
                <ProgressBar value={v*400} color={agent.color} height={3}/>
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab==='learning' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <Card>
            <SectionTitle title="Reward Evolution" sub="Cumulative RL reward per episode"/>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={agent.rewards||[]}>
                <defs><linearGradient id="rwd" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.green} stopOpacity={0.3}/><stop offset="95%" stopColor={C.green} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="ep" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/><YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/><Area type="monotone" dataKey="r" stroke={C.green} strokeWidth={2} fill="url(#rwd)" dot={false} isAnimationActive={false} name="Reward"/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <SectionTitle title="Loss Function" sub="Training loss convergence"/>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={lossData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="ep" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/><YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/><Line type="monotone" dataKey="loss" stroke={C.red} strokeWidth={2} dot={false} isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          </Card>
          <Card style={{gridColumn:'1/-1'}}>
            <SectionTitle title="Training Statistics"/>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
              {[['Total Episodes','1,200',C.text],['Policy Updates','380',C.accent],['Exploration ε','0.12',C.yellow],['Replay Buffer','48k',C.purple],['Avg Reward',fmt(agent.reward||500,0),C.green],['Convergence','92%',C.green],['Learning Rate','0.0003',C.text],['Batch Size','256',C.text]].map(([l,v,c])=>(
                <div key={l} style={{background:C.bg,borderRadius:8,padding:12}}>
                  <div style={{fontSize:9,color:C.muted,textTransform:'uppercase',letterSpacing:.8,marginBottom:4}}>{l}</div>
                  <div style={{fontSize:14,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:14}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:11,color:C.muted}}>Learning Progress</span><span style={{fontSize:11,color:agent.color,fontFamily:'monospace'}}>{agent.progress||0}%</span></div>
              <ProgressBar value={agent.progress||0} color={agent.color} height={7}/>
            </div>
          </Card>
        </div>
      )}
      {tab==='risk' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
          {[['VaR 95%','-2.4%',C.red],['CVaR 95%','-3.8%',C.red],['Beta','0.72',C.text],['Correlation','0.48',C.text],['Volatility','14.2%',C.yellow],['Calmar','2.24',C.green]].map(([l,v,c])=>(
            <Card key={l}><div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>{l}</div><div style={{fontSize:24,fontWeight:800,color:c,...mono}}>{v}</div></Card>
          ))}
          <Card style={{gridColumn:'1/-1'}}>
            <SectionTitle title="Monte Carlo Simulation" sub="Path distribution (6 scenarios)"/>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart>{mcPaths.map((d,si)=><Line key={si} data={d} type="monotone" dataKey="v" stroke={agent.color} strokeWidth={1} dot={false} strokeOpacity={0.25+si*0.12} isAnimationActive={false}/>)}</LineChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
      {tab==='trades' && (
        <Card>
          <SectionTitle title="Trade History" sub="Last 16 paper trades"/>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr>{['Date','Side','Symbol','P&L','Status'].map(h=><th key={h} style={{textAlign:'left',padding:'8px 12px',color:C.muted,fontSize:10,textTransform:'uppercase',letterSpacing:.8,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}</tr></thead>
            <tbody>
              {tradeLog.map((t,i)=>(
                <tr key={i} style={{borderBottom:`1px solid ${C.border}22`}}>
                  <td style={{padding:'9px 12px',color:C.muted,fontFamily:'monospace',fontSize:10}}>{t.date}</td>
                  <td style={{padding:'9px 12px'}}><span style={{background:`${t.side==='BUY'?C.green:C.red}22`,color:t.side==='BUY'?C.green:C.red,border:`1px solid ${t.side==='BUY'?C.green:C.red}44`,borderRadius:4,padding:'2px 7px',fontSize:10,fontWeight:700}}>{t.side}</span></td>
                  <td style={{padding:'9px 12px',color:C.text,fontFamily:'monospace'}}>{t.sym}</td>
                  <td style={{padding:'9px 12px',color:t.pnl>=0?C.green:C.red,fontFamily:'monospace',fontWeight:700}}>{t.pnl>=0?'+':''}{t.pnl}%</td>
                  <td style={{padding:'9px 12px'}}><Badge label={t.pnl>=0?'Win':'Loss'} color={t.pnl>=0?C.green:C.red}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
