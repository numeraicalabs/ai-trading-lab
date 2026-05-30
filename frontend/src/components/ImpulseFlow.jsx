/**
 * ImpulseFlow — animated SVG visualization of real-time signal propagation.
 *
 * Each "impulse" is a signal emitted by one agent that influences another.
 * They appear as animated bubbles travelling along the connection lines.
 *
 * Types:
 *   regime_gate     — REG broadcasts market regime to all agents  (cyan)
 *   sentiment_boost — SEN pushes sentiment scores                (orange)
 *   vol_warning     — VOL warns about high volatility             (red)
 *   consensus       — agents agree -> OPT gets a combined signal  (green)
 *   rebalance       — OPT triggers portfolio rebalance           (emerald)
 *   regime_block    — REG blocks a contra-trend signal           (yellow)
 */
import { useEffect, useRef, useState } from 'react'
import { C } from './UI'

// Agent positions on the ring (same as NetworkPage)
const N_AGENTS = 9
const CX = 360, CY = 200, RING_R = 155

const AGENT_ORDER = ['MOM','MRV','PPO','DQN','MAC','SEN','VOL','REG','OPT']

function agentPos(abbr) {
  const i     = AGENT_ORDER.indexOf(abbr)
  if (i < 0) return { x: CX, y: CY }
  const angle = (i / N_AGENTS) * Math.PI * 2 - Math.PI / 2
  return { x: Math.round(CX + RING_R * Math.cos(angle)), y: Math.round(CY + RING_R * Math.sin(angle)) }
}

const DIRECTION_COLOR = {
  BUY:  '#10b981',
  SELL: '#ef4444',
  HOLD: '#64748b',
  WARN: '#f59e0b',
  CONFIRM: '#06b6d4',
}

const TYPE_LABEL = {
  regime_gate:    '🔍 Regime',
  sentiment_boost:'📰 Sentiment',
  vol_warning:    '📊 Vol Alert',
  consensus:      '✅ Consensus',
  rebalance:      '⚖️ Rebalance',
  regime_block:   '🚫 Blocked',
}

// Animated bubble that travels from src to dst
function ImpulseBubble({ imp, catalogue }) {
  const [progress, setProgress] = useState(0)
  const rafRef  = useRef(null)
  const startTs = useRef(Date.now())
  const DURATION = 1800 + Math.random() * 600

  useEffect(() => {
    const animate = () => {
      const elapsed = Date.now() - startTs.current
      const p       = Math.min(1, elapsed / DURATION)
      setProgress(p)
      if (p < 1) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  if (progress >= 1) return null

  const src  = agentPos(imp.from)
  const dst  = agentPos(imp.to)
  const bx   = src.x + (dst.x - src.x) * progress
  const by   = src.y + (dst.y - src.y) * progress
  const col  = DIRECTION_COLOR[imp.direction] || '#3b82f6'
  const r    = 5 + imp.strength * 4
  const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress

  return (
    <g>
      {/* Trail glow */}
      <circle cx={bx} cy={by} r={r * 2.5} fill={col} opacity={0.07 * (1 - ease)} />
      {/* Main bubble */}
      <circle cx={bx} cy={by} r={r} fill={col} opacity={0.85}>
        <animate attributeName="r" values={`${r};${r*1.25};${r}`} dur="0.4s" repeatCount="indefinite"/>
      </circle>
      {/* Direction arrow text */}
      <text x={bx} y={by + 4} textAnchor="middle" fontSize={8} fill="white" fontFamily="monospace">
        {imp.direction === 'BUY' ? '▲' : imp.direction === 'SELL' ? '▼' : imp.direction === 'WARN' ? '⚠' : '●'}
      </text>
    </g>
  )
}

export function ImpulseFlow({ agents = [], impulses = [], liveImpulses = {}, height = 420 }) {
  const [activeBubbles, setActiveBubbles]    = useState([])
  const [recentImpulses, setRecentImpulses]  = useState([])
  const seenIds = useRef(new Set())

  // Add new bubbles when impulses arrive
  useEffect(() => {
    if (!impulses?.length) return
    const newOnes = impulses.filter(i => i?.id && !seenIds.current.has(i.id))
    if (!newOnes.length) return
    newOnes.forEach(i => seenIds.current.add(i.id))
    setActiveBubbles(prev => [...prev, ...newOnes].slice(-40))
    setRecentImpulses(prev => [...newOnes, ...prev].slice(0, 12))
    // Cleanup old seen IDs
    if (seenIds.current.size > 500) seenIds.current = new Set()
  }, [impulses])

  // Build catalogue map
  const catMap = {}
  agents.forEach(a => { catMap[a.abbr] = a })

  // Static connection lines between agents
  const CONNECTIONS = [
    ['MOM','REG'],['MOM','SEN'],['MRV','VOL'],['PPO','DQN'],['DQN','VOL'],
    ['MAC','REG'],['SEN','MOM'],['VOL','MRV'],['REG','MOM'],['REG','MAC'],
    ['OPT','MOM'],['OPT','MRV'],['OPT','MAC'],['OPT','REG'],
  ]

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:14, alignItems:'start' }}>
      {/* SVG canvas */}
      <div style={{ background:'#0a0e17', borderRadius:12, border:`1px solid ${C.border}`,
                    overflow:'hidden', position:'relative' }}>
        <svg viewBox="0 0 720 420" style={{ width:'100%', height:'auto', display:'block' }}>
          {/* Connection lines */}
          {CONNECTIONS.map(([a, b], i) => {
            const pa = agentPos(a), pb = agentPos(b)
            return (
              <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke={C.dim} strokeWidth={0.8} strokeDasharray="4 6" opacity={0.5}/>
            )
          })}
          {/* Ring lines to center */}
          {AGENT_ORDER.map(abbr => {
            const p = agentPos(abbr)
            const a = catMap[abbr]
            return (
              <line key={abbr+'c'} x1={p.x} y1={p.y} x2={CX} y2={CY}
                stroke={a?.color || C.border} strokeWidth={0.5} opacity={0.2}/>
            )
          })}

          {/* Animated impulse bubbles */}
          {activeBubbles.map(imp => (
            <ImpulseBubble key={imp.id} imp={imp} catalogue={catMap}/>
          ))}

          {/* Center OPT node */}
          <circle cx={CX} cy={CY} r={34} fill={`${C.accent}20`}
                  stroke={C.accent} strokeWidth={1.5}/>
          <text x={CX} y={CY-6}  textAnchor="middle" fill={C.accent} fontSize={8} fontFamily="monospace">PORTFOLIO</text>
          <text x={CX} y={CY+6}  textAnchor="middle" fill={C.accent} fontSize={8} fontFamily="monospace">OPTIMIZER</text>
          <text x={CX} y={CY+19} textAnchor="middle" fontSize={13}>⚖️</text>

          {/* Agent nodes */}
          {AGENT_ORDER.map(abbr => {
            const p   = agentPos(abbr)
            const a   = catMap[abbr] || CATALOGUE_STUB[abbr] || {}
            const col = a.color || C.border
            // Highlight if recently in an impulse
            const isActive = activeBubbles.some(i => (i.from === abbr || i.to === abbr))
            return (
              <g key={abbr}>
                {isActive && (
                  <circle cx={p.x} cy={p.y} r={28} fill="none"
                    stroke={col} strokeWidth={1.5} opacity={0.4}>
                    <animate attributeName="r" values="24;32;24" dur="1s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.4;0.1;0.4" dur="1s" repeatCount="indefinite"/>
                  </circle>
                )}
                <circle cx={p.x} cy={p.y} r={22} fill={`${col}22`}
                        stroke={col} strokeWidth={isActive ? 2 : 1.2}/>
                <text x={p.x} y={p.y+2} textAnchor="middle" dominantBaseline="middle"
                      fill={C.text} fontSize={12}>{a.icon || '🤖'}</text>
                <text x={p.x} y={p.y+32} textAnchor="middle" fill={col}
                      fontSize={9} fontFamily="monospace" fontWeight="700">{abbr}</text>
                {/* Accuracy badge */}
                {(a.accuracy > 0) && (
                  <text x={p.x} y={p.y+44} textAnchor="middle"
                        fill={C.muted} fontSize={8} fontFamily="monospace">
                    {a.accuracy?.toFixed ? a.accuracy.toFixed(0) : a.accuracy}%
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* Legend overlay */}
        <div style={{ position:'absolute', top:10, left:10, display:'flex', flexWrap:'wrap', gap:6 }}>
          {Object.entries(DIRECTION_COLOR).slice(0,4).map(([d,c]) => (
            <div key={d} style={{ display:'flex', alignItems:'center', gap:4,
                                   background:`${c}18`, border:`1px solid ${c}44`,
                                   borderRadius:20, padding:'2px 7px' }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:c }}/>
              <span style={{ fontSize:9, color:c, fontFamily:'monospace' }}>{d}</span>
            </div>
          ))}
        </div>
        <div style={{ position:'absolute', bottom:8, left:10, fontSize:10, color:C.muted }}>
          {activeBubbles.length} active impulses · {Object.keys(liveImpulses).length} connections
        </div>
      </div>

      {/* Impulse log */}
      <div style={{ background:C.card, borderRadius:12, border:`1px solid ${C.border}`,
                    padding:14, maxHeight:420, overflowY:'auto' }}>
        <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:12 }}>
          📡 Impulse Feed
        </div>
        {recentImpulses.length === 0 ? (
          <div style={{ color:C.muted, fontSize:11, textAlign:'center', padding:'30px 0' }}>
            Run agents to see impulses…
          </div>
        ) : recentImpulses.map((imp, i) => {
          const dc = DIRECTION_COLOR[imp.direction] || C.muted
          return (
            <div key={imp.id || i} style={{
              padding:'8px 10px', marginBottom:6, borderRadius:8,
              background:`${dc}0a`, border:`1px solid ${dc}22`,
              animation: i === 0 ? 'fadeIn .3s ease' : 'none',
            }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                <span style={{ fontSize:11, fontWeight:700 }}>
                  <span style={{ color: (catMap[imp.from]?.color || C.accent),
                                 fontFamily:'monospace' }}>{imp.from}</span>
                  <span style={{ color:C.dim }}> &rarr; </span>
                  <span style={{ color:(catMap[imp.to]?.color || C.muted),
                                 fontFamily:'monospace' }}>{imp.to}</span>
                </span>
                <span style={{ fontSize:9, color:C.dim, fontFamily:'monospace' }}>
                  {new Date(imp.ts).toLocaleTimeString()}
                </span>
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <span style={{ fontSize:10, fontWeight:700, color:dc }}>{imp.direction}</span>
                <span style={{ fontSize:9, color:C.muted }}>
                  {TYPE_LABEL[imp.type] || imp.type}
                </span>
                <span style={{ fontSize:9, color:dc, fontFamily:'monospace', marginLeft:'auto' }}>
                  {Math.round(imp.strength * 100)}%
                </span>
              </div>
              {imp.reason && (
                <div style={{ fontSize:9, color:C.dim, marginTop:2, fontStyle:'italic' }}>{imp.reason}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Minimal stub so the SVG still renders without full agent data
const CATALOGUE_STUB = {
  MOM:{color:'#06b6d4',icon:'↑'}, MRV:{color:'#8b5cf6',icon:'⇄'}, PPO:{color:'#3b82f6',icon:'🧠'},
  DQN:{color:'#ec4899',icon:'⚡'}, MAC:{color:'#f59e0b',icon:'🌐'}, SEN:{color:'#f97316',icon:'📰'},
  VOL:{color:'#ef4444',icon:'📊'}, REG:{color:'#14b8a6',icon:'🔍'}, OPT:{color:'#10b981',icon:'⚖️'},
}
