import { useState } from 'react'
import { Badge, MiniChart, ProgressBar, C, pct, mono } from './UI'

export function AgentCard({ agent, onClick }) {
  const [hov, setHov] = useState(false)
  const pc   = (agent.perf || 0) >= 0 ? C.green : C.red
  const last = agent.last_trade || agent.lastTrade || '—'

  return (
    <div
      onClick={() => onClick(agent)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="fade-in"
      style={{
        background:   hov ? '#19253a' : C.card,
        border:       `1px solid ${hov ? agent.color + '66' : C.border}`,
        borderRadius: 12, padding: 18, cursor: 'pointer',
        boxShadow:    hov ? `0 4px 20px ${agent.color}20` : 'none',
        transition:   'all .2s', display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, fontSize: 18,
                        background: `${agent.color}22`, border: `1px solid ${agent.color}44`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {agent.icon}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{agent.name}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{agent.type || agent.strategy}</div>
          </div>
        </div>
        <Badge label={agent.state} color={agent.stateColor || C.green} />
      </div>

      {/* Return + Sharpe */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: pc, ...mono }}>{pct(agent.perf || 0)}</span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: C.muted }}>Sharpe</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, ...mono }}>{(agent.sharpe || 0).toFixed(2)}</div>
        </div>
      </div>

      {/* Mini equity chart */}
      <MiniChart data={agent.equity || []} color={agent.color} />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          ['Accuracy', (agent.accuracy || 0) + '%'],
          ['Trades',   agent.trades_count || 0],
          ['Win %',    (agent.winRate || agent.win_rate || 0) + '%'],
        ].map(([l, v]) => (
          <div key={l}>
            <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: .8, marginBottom: 2 }}>{l}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, ...mono }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Learning progress */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: .8 }}>Learning</span>
          <span style={{ fontSize: 9, color: agent.color, ...mono }}>{agent.progress || 0}%</span>
        </div>
        <ProgressBar value={agent.progress || 0} color={agent.color} />
      </div>

      {/* Last trade */}
      <div style={{ background: `${C.bg}88`, borderRadius: 6, padding: '5px 10px',
                    fontSize: 10, color: C.muted, ...mono,
                    borderLeft: `2px solid ${agent.color}66`,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {last}
      </div>

      {/* Confidence */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: C.muted }}>Confidence</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: agent.color, ...mono }}>
          {Math.round(agent.confidence || 0)}/100
        </span>
      </div>
    </div>
  )
}
