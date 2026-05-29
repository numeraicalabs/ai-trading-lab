import { useState } from 'react'
import { Badge, MiniChart, ProgressBar, C, pct, mono } from '../shared'

export function AgentCard({ agent, onClick }) {
  const [hov, setHov] = useState(false)
  const perfColor = agent.perf >= 0 ? C.green : C.red
  const last = agent.last_trade || agent.lastTrade || '—'

  return (
    <div
      className="fade-in"
      onClick={() => onClick(agent)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? '#19253a' : C.card,
        border:`1px solid ${hov ? agent.color+'66' : C.border}`,
        borderRadius:12, padding:18, cursor:'pointer',
        transition:'all .2s ease',
        boxShadow: hov ? `0 4px 24px ${agent.color}20` : 'none',
        display:'flex', flexDirection:'column', gap:12,
      }}
    >
      {/* header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <div style={{
            width:38, height:38, borderRadius:10, fontSize:18,
            background:`${agent.color}22`, border:`1px solid ${agent.color}44`,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>{agent.icon}</div>
          <div>
            <div style={{ fontWeight:700, fontSize:13, color:C.text }}>{agent.name}</div>
            <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{agent.type || agent.strategy}</div>
          </div>
        </div>
        <Badge label={agent.state} color={agent.stateColor || C.green} />
      </div>

      {/* perf */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:22, fontWeight:800, color:perfColor, ...mono }}>
          {pct(agent.perf || 0)}
        </span>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:10, color:C.muted }}>Sharpe</div>
          <div style={{ fontSize:14, fontWeight:700, color:C.text, fontFamily:'monospace' }}>
            {(agent.sharpe||0).toFixed(2)}
          </div>
        </div>
      </div>

      {/* mini chart */}
      <MiniChart data={agent.equity || []} color={agent.color} />

      {/* stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
        {[
          ['Accuracy', (agent.accuracy||0)+'%'],
          ['Trades',   agent.trades_count || agent.trades || 0],
          ['Win%',     (agent.winRate || agent.win_rate || 0)+'%'],
        ].map(([l,v]) => (
          <div key={l} style={{ display:'flex', flexDirection:'column', gap:2 }}>
            <span style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8 }}>{l}</span>
            <span style={{ fontSize:12, fontWeight:700, color:C.text, fontFamily:'monospace' }}>{v}</span>
          </div>
        ))}
      </div>

      {/* progress */}
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
          <span style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:.8 }}>Learning Progress</span>
          <span style={{ fontSize:9, color:agent.color, fontFamily:'monospace' }}>{agent.progress||0}%</span>
        </div>
        <ProgressBar value={agent.progress||0} color={agent.color} />
      </div>

      {/* last trade */}
      <div style={{
        background:`${C.bg}88`, borderRadius:6, padding:'5px 10px',
        fontSize:10, color:C.muted, fontFamily:'monospace',
        borderLeft:`2px solid ${agent.color}66`,
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
      }}>{last}</div>

      {/* confidence */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:10, color:C.muted }}>Confidence Score</span>
        <span style={{ fontSize:12, fontWeight:700, color:agent.color, fontFamily:'monospace' }}>
          {Math.round(agent.confidence||0)}/100
        </span>
      </div>
    </div>
  )
}
