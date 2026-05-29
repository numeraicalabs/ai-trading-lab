import { useState } from 'react'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Badge, ProgressBar, C, pct, fmt, mono, Card, SectionTitle } from '../shared'

const TT = { contentStyle:{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, fontSize:11 } }

function seeded(s){ return ()=>{ s=(s*16807)%2147483647; return (s-1)/2147483646 } }
function genEquity(n,start,drift,vol,seed){ const rng=seeded(seed); let v=start; return Array.from({length:n},()=>{ v=v*(1+drift+(rng()-0.5)*vol); return {v:+v.toFixed(2)} }) }

export function AgentDetail({ agent, onBack }) {
  const [tab, setTab] = useState('overview')
  const TABS = ['overview','learning','risk','trades']

  const tradeLog = Array.from({length:16},(_,i)=>{
    const rng=seeded(agent.abbr.charCodeAt(0)*100+i)
    const side=rng()>0.48?'BUY':'SELL'
    const pnl=+(((rng()-0.38)*2.4)).toFixed(2)
    const assets=agent.assets||['SPY']
    const sym=assets[Math.floor(rng()*assets.length)]
    return { i, side, sym, pnl, date:`2024-${String(Math.floor(rng()*12)+1).padStart(2,'0')}-${String(Math.floor(rng()*28)+1).padStart(2,'0')}` }
  })

  const lossData = Array.from({length:60},(_,i)=>{
    const r=seeded(agent.abbr.charCodeAt(0)*200+i)
    return { ep:i, loss:Math.max(0.01,2.5*Math.exp(-i*0.04)+(r()-0.5)*0.3) }
  })

  const features=[
    {name:'RSI',0.22},{name:'MACD',0.18},{name:'Volume',0.14},
    {name:'Momentum',0.12},{name:'BB',0.11},{name:'ATR',0.09},
    {name:'SMA20',0.08},{name:'Sentiment',0.06},
  ].map((f,i)=>({name:f.name||['RSI','MACD','Volume','Momentum','BB','ATR','SMA20','Sentiment'][i], imp:[.22,.18,.14,.12,.11,.09,.08,.06][i]}))

  const mcPaths = Array.from({length:6},(_,si)=>genEquity(60,100,0.001*(si-2),0.04,(si*77+(agent.abbr.charCodeAt(0)||1))))

  const kpis=[
    ['Return',    pct(agent.perf||0),     agent.perf>=0?C.green:C.red],
    ['Sharpe',    (agent.sharpe||0).toFixed(2),  C.text],
    ['Sortino',   (agent.sortino||0).toFixed(2), C.text],
    ['Max DD',    (agent.maxDD||agent.max_drawdown||0)+'%', C.red],
    ['Win Rate',  (agent.winRate||agent.win_rate||0)+'%',   C.green],
    ['Accuracy',  (agent.accuracy||0)+'%',  agent.color],
    ['Trades',    agent.trades_count||agent.trades||0, C.text],
    ['Alpha',     fmt(agent.alpha||0)+'%',  C.cyan],
    ['Confidence',(Math.round(agent.confidence||0))+'/100', agent.color],
    ['P. Factor', (agent.profitFactor||agent.profit_factor||1).toFixed(1), C.text],
  ]

  return (
    <div className="fade-in">
      {/* back bar */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
        <button onClick={onBack} style={{
          background:C.surface, border:`1px solid ${C.border}`, borderRadius:8,
          color:C.text, padding:'7px 14px', fontSize:12,
          display:'flex', alignItems:'center', gap:5,
        }}>← Back</button>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div style={{
            width:44, height:44, borderRadius:12, fontSize:22,
            background:`${agent.color}22`, border:`1px solid ${agent.color}44`,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>{agent.icon}</div>
          <div>
            <h1 style={{ fontSize:18, fontWeight:800, color:C.text, margin:0 }}>{agent.name}</h1>
            <p style={{ fontSize:11, color:C.muted, margin:0 }}>{agent.strategy} · {agent.type}</p>
          </div>
          <Badge label={agent.state} color={agent.stateColor||C.green} />
        </div>
      </div>

      {/* kpis */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:20 }}>
        {kpis.map(([l,v,c])=>(
          <Card key={l}>
            <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>{l}</div>
            <div style={{ fontSize:18, fontWeight:800, color:c, ...mono }}>{v}</div>
          </Card>
        ))}
      </div>

      {/* tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:18 }}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{
            padding:'7px 18px', borderRadius:8, fontSize:12,
            fontWeight:tab===t?700:400,
            background:tab===t?`${agent.color}22`:C.surface,
            border:`1px solid ${tab===t?`${agent.color}66`:C.border}`,
            color:tab===t?agent.color:C.muted,
            textTransform:'capitalize',
          }}>{t}</button>
        ))}
      </div>

      {tab==='overview' && (
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16 }}>
          <Card>
            <SectionTitle title="Equity Curve" sub="Paper trading performance" />
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={agent.equity||[]}>
                <defs>
                  <linearGradient id="agd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={agent.color} stopOpacity={0.25}/>
                    <stop offset="95%" stopColor={agent.color} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                <XAxis dataKey="i" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/>
                <Area type="monotone" dataKey="v" stroke={agent.color} strokeWidth={2} fill="url(#agd)" dot={false} isAnimationActive={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <SectionTitle title="Action Distribution" />
            {[['Buy',C.green,Math.round((agent.winRate||55)*.6)],['Sell',C.red,Math.round((agent.winRate||55)*.5)],['Hold',C.muted,40]].map(([l,c,v])=>(
              <div key={l} style={{ marginBottom:12 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ fontSize:12, color:C.text }}>{l}</span>
                  <span style={{ fontSize:11, color:c, fontFamily:'monospace' }}>{v}%</span>
                </div>
                <ProgressBar value={v} color={c} height={6}/>
              </div>
            ))}
            <SectionTitle title="Feature Importance" style={{ marginTop:20 }}/>
            {features.slice(0,5).map(f=>(
              <div key={f.name} style={{ marginBottom:7 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontSize:11, color:C.muted }}>{f.name}</span>
                  <span style={{ fontSize:10, color:agent.color, fontFamily:'monospace' }}>{(f.imp*100).toFixed(0)}%</span>
                </div>
                <ProgressBar value={f.imp*100*4} color={agent.color} height={4}/>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab==='learning' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <Card>
            <SectionTitle title="Reward Evolution" sub="Cumulative RL reward per episode"/>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={agent.rewards||[]}>
                <defs>
                  <linearGradient id="rwd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.green} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={C.green} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                <XAxis dataKey="ep" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/>
                <Area type="monotone" dataKey="r" stroke={C.green} strokeWidth={2} fill="url(#rwd)" dot={false} isAnimationActive={false} name="Reward"/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <SectionTitle title="Loss Function" sub="Training loss convergence"/>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={lossData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                <XAxis dataKey="ep" tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <Tooltip {...TT}/>
                <Line type="monotone" dataKey="loss" stroke={C.red} strokeWidth={2} dot={false} isAnimationActive={false} name="Loss"/>
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card style={{ gridColumn:'1/-1' }}>
            <SectionTitle title="Training Statistics" />
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
              {[
                ['Total Episodes','1,200',C.text],['Policy Updates','380',C.accent],
                ['Exploration ε','0.12',C.yellow],['Replay Buffer','48,200',C.purple],
                ['Avg Reward',fmt(agent.reward||500,0),C.green],['Convergence','92%',C.green],
                ['Learning Rate','0.0003',C.text],['Batch Size','256',C.text],
              ].map(([l,v,c])=>(
                <div key={l} style={{ background:C.bg, borderRadius:8, padding:12 }}>
                  <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:4 }}>{l}</div>
                  <div style={{ fontSize:15, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop:16 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                <span style={{ fontSize:11, color:C.muted }}>Learning Progress</span>
                <span style={{ fontSize:11, color:agent.color, fontFamily:'monospace' }}>{agent.progress||0}%</span>
              </div>
              <ProgressBar value={agent.progress||0} color={agent.color} height={8}/>
            </div>
          </Card>
        </div>
      )}

      {tab==='risk' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
          {[['VaR 95%','-2.4%',C.red],['CVaR 95%','-3.8%',C.red],['Beta vs S&P','0.72',C.text],
            ['Correlation','0.48',C.text],['Volatility Ann.','14.2%',C.yellow],['Calmar Ratio','2.24',C.green]].map(([l,v,c])=>(
            <Card key={l}>
              <div style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>{l}</div>
              <div style={{ fontSize:26, fontWeight:800, color:c, ...mono }}>{v}</div>
            </Card>
          ))}
          <Card style={{ gridColumn:'1/-1' }}>
            <SectionTitle title="Monte Carlo Simulation" sub="Path distribution (n=100 scenarios)"/>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                <XAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fontSize:9,fill:C.muted}} tickLine={false} axisLine={false}/>
                {mcPaths.map((d,si)=>(
                  <Line key={si} data={d} type="monotone" dataKey="v" stroke={agent.color}
                    strokeWidth={1} dot={false} strokeOpacity={0.25+si*0.1} isAnimationActive={false}/>
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {tab==='trades' && (
        <Card>
          <SectionTitle title="Trade History" sub="Last 16 paper trades"/>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr>
                  {['Date','Side','Symbol','P&L','Status'].map(h=>(
                    <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted, fontSize:10, textTransform:'uppercase', letterSpacing:.8, borderBottom:`1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tradeLog.map((t,i)=>(
                  <tr key={i} style={{ borderBottom:`1px solid ${C.border}22` }}>
                    <td style={{ padding:'9px 12px', color:C.muted, fontFamily:'monospace', fontSize:11 }}>{t.date}</td>
                    <td style={{ padding:'9px 12px' }}>
                      <span style={{ background:`${t.side==='BUY'?C.green:C.red}22`, color:t.side==='BUY'?C.green:C.red, border:`1px solid ${t.side==='BUY'?C.green:C.red}44`, borderRadius:4, padding:'2px 8px', fontSize:10, fontWeight:700 }}>{t.side}</span>
                    </td>
                    <td style={{ padding:'9px 12px', color:C.text, fontFamily:'monospace' }}>{t.sym}</td>
                    <td style={{ padding:'9px 12px', color:t.pnl>=0?C.green:C.red, fontFamily:'monospace', fontWeight:700 }}>{t.pnl>=0?'+':''}{t.pnl}%</td>
                    <td style={{ padding:'9px 12px' }}>
                      <span style={{ background:`${t.pnl>=0?C.green:C.red}22`, color:t.pnl>=0?C.green:C.red, border:`1px solid ${t.pnl>=0?C.green:C.red}44`, borderRadius:4, padding:'2px 8px', fontSize:10, fontWeight:700 }}>{t.pnl>=0?'Win':'Loss'}</span>
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
