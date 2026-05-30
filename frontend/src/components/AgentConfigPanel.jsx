/**
 * AgentConfigPanel — slide-in drawer for per-agent parameter tuning.
 * Opens when user clicks ⚙ on an agent row in Ecosystem or from AgentDetail.
 */
import { useState, useEffect } from 'react'
import { C, ProgressBar } from './UI'
import api from '../lib/api'

const PRESETS = {
  conservative: { aggressiveness:0.2, signal_threshold:0.7, stop_loss_pct:0.02, take_profit_pct:0.04, weight:0.7 },
  balanced:     { aggressiveness:0.5, signal_threshold:0.55, stop_loss_pct:0.03, take_profit_pct:0.06, weight:1.0 },
  aggressive:   { aggressiveness:0.85, signal_threshold:0.45, stop_loss_pct:0.05, take_profit_pct:0.12, weight:1.3 },
  scalper:      { aggressiveness:0.9, signal_threshold:0.52, stop_loss_pct:0.01, take_profit_pct:0.02, weight:1.1 },
}

export function AgentConfigPanel({ agent, onClose, onSaved }) {
  const [cfg,     setCfg]     = useState(null)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  useEffect(() => {
    if (!agent) return
    api.get(`/api/agents/${agent.abbr}/config`).then(d => {
      if (d) setCfg(d)
      else setCfg({
        enabled: true, aggressiveness: 0.5, signal_threshold: 0.55,
        max_position_pct: 0.15, stop_loss_pct: 0.03, take_profit_pct: 0.06,
        use_regime_gate: true, weight: 1.0,
      })
    })
  }, [agent?.abbr])

  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }))

  const applyPreset = (name) => {
    const p = PRESETS[name]
    if (p) setCfg(c => ({ ...c, ...p }))
  }

  const save = async () => {
    if (!cfg || !agent) return
    setSaving(true)
    const r = await fetch(`/api/agents/${agent.abbr}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    })
    if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); onSaved?.(agent.abbr, cfg) }
    setSaving(false)
  }

  if (!agent) return null

  return (
    <div style={{
      position:'fixed', inset:0, background:'#000000aa', zIndex:500,
      display:'flex', alignItems:'flex-start', justifyContent:'flex-end',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width:380, height:'100vh', background:'#0f1829',
        borderLeft:`1px solid ${C.border}`, overflowY:'auto',
        padding:24, display:'flex', flexDirection:'column', gap:16,
      }}>
        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:9, fontSize:17,
                          background:`${agent.color}22`, border:`1px solid ${agent.color}44`,
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              {agent.icon}
            </div>
            <div>
              <div style={{ fontSize:14, fontWeight:800, color:C.text }}>{agent.name}</div>
              <div style={{ fontSize:10, color:C.muted }}>Configuration</div>
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:'none', border:'none', color:C.muted, fontSize:20, cursor:'pointer' }}>✕</button>
        </div>

        {/* Presets */}
        <div>
          <div style={{ fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:1, marginBottom:7 }}>Quick Presets</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
            {Object.keys(PRESETS).map(p => (
              <button key={p} onClick={() => applyPreset(p)} style={{
                padding:'7px 10px', borderRadius:7, cursor:'pointer', fontSize:11, fontWeight:600,
                background:`${agent.color}15`, border:`1px solid ${agent.color}33`, color:agent.color,
                textTransform:'capitalize',
              }}>{p}</button>
            ))}
          </div>
        </div>

        {!cfg ? (
          <div style={{ color:C.muted, fontSize:11 }}>Loading…</div>
        ) : (
          <>
            {/* Enable toggle */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                          padding:'10px 12px', borderRadius:8, background:C.bg,
                          border:`1px solid ${cfg.enabled ? C.green+'44' : C.border}` }}>
              <span style={{ fontSize:12, color:C.text }}>Agent Enabled</span>
              <button onClick={() => set('enabled', !cfg.enabled)} style={{
                width:44, height:24, borderRadius:12, cursor:'pointer', border:'none',
                background: cfg.enabled ? C.green : C.dim,
                position:'relative', transition:'background .2s',
              }}>
                <div style={{ position:'absolute', top:2, left: cfg.enabled ? 22 : 2,
                              width:20, height:20, borderRadius:'50%', background:'white',
                              transition:'left .2s', boxShadow:'0 1px 3px #0006' }}/>
              </button>
            </div>

            {/* Aggressiveness */}
            <Slider label="Aggressiveness" desc="How boldly the agent enters trades"
              value={cfg.aggressiveness} min={0} max={1} step={0.05}
              format={v => `${Math.round(v*100)}%`}
              color={v => v > 0.7 ? C.red : v > 0.4 ? C.yellow : C.green}
              onChange={v => set('aggressiveness', v)}/>

            {/* Signal threshold */}
            <Slider label="Signal Threshold" desc="Min confidence to act (lower = more trades)"
              value={cfg.signal_threshold} min={0.3} max={0.9} step={0.05}
              format={v => `${Math.round(v*100)}%`}
              color={() => C.accent}
              onChange={v => set('signal_threshold', v)}/>

            {/* Ensemble weight */}
            <Slider label="Ensemble Weight" desc="How much this agent influences group decisions"
              value={cfg.weight} min={0.1} max={2.0} step={0.1}
              format={v => `${v.toFixed(1)}×`}
              color={() => C.purple}
              onChange={v => set('weight', v)}/>

            {/* Max position */}
            <Slider label="Max Position Size" desc="Max % of portfolio per trade"
              value={cfg.max_position_pct} min={0.01} max={0.5} step={0.01}
              format={v => `${Math.round(v*100)}%`}
              color={v => v > 0.3 ? C.red : C.text}
              onChange={v => set('max_position_pct', v)}/>

            {/* Stop loss */}
            <Slider label="Stop Loss" desc="Auto-exit when trade loses this much"
              value={cfg.stop_loss_pct} min={0.005} max={0.15} step={0.005}
              format={v => `-${Math.round(v*100)}%`}
              color={() => C.red}
              onChange={v => set('stop_loss_pct', v)}/>

            {/* Take profit */}
            <Slider label="Take Profit" desc="Auto-exit when trade gains this much"
              value={cfg.take_profit_pct} min={0.01} max={0.3} step={0.01}
              format={v => `+${Math.round(v*100)}%`}
              color={() => C.green}
              onChange={v => set('take_profit_pct', v)}/>

            {/* Risk/reward preview */}
            <div style={{ padding:'10px 12px', borderRadius:8, background:C.bg,
                          border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:10, color:C.muted, marginBottom:8, textTransform:'uppercase', letterSpacing:1 }}>
                Risk/Reward Preview
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7, fontSize:11 }}>
                {[
                  ['R:R Ratio',  (cfg.take_profit_pct / cfg.stop_loss_pct).toFixed(1) + ':1', C.text],
                  ['Kelly %',    Math.max(0,((cfg.take_profit_pct / cfg.stop_loss_pct - 1) * 0.3 * 100)).toFixed(0) + '%', C.accent],
                  ['Max Loss',   `-${(cfg.stop_loss_pct * cfg.max_position_pct * 100).toFixed(2)}%`, C.red],
                  ['Max Gain',   `+${(cfg.take_profit_pct * cfg.max_position_pct * 100).toFixed(2)}%`, C.green],
                ].map(([l,v,c]) => (
                  <div key={l} style={{ background:`${c}10`, borderRadius:6, padding:'7px 9px' }}>
                    <div style={{ fontSize:9, color:C.muted, marginBottom:2 }}>{l}</div>
                    <div style={{ fontSize:13, fontWeight:700, color:c, fontFamily:'monospace' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Regime gate */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                          padding:'10px 12px', borderRadius:8, background:C.bg,
                          border:`1px solid ${C.border}` }}>
              <div>
                <div style={{ fontSize:12, color:C.text }}>Regime Gate</div>
                <div style={{ fontSize:10, color:C.muted }}>Block contra-trend signals from REG agent</div>
              </div>
              <button onClick={() => set('use_regime_gate', !cfg.use_regime_gate)} style={{
                width:44, height:24, borderRadius:12, cursor:'pointer', border:'none',
                background: cfg.use_regime_gate ? C.cyan : C.dim,
                position:'relative', transition:'background .2s',
              }}>
                <div style={{ position:'absolute', top:2, left: cfg.use_regime_gate ? 22 : 2,
                              width:20, height:20, borderRadius:'50%', background:'white',
                              transition:'left .2s' }}/>
              </button>
            </div>

            {/* Save */}
            <button onClick={save} disabled={saving} style={{
              padding:'11px 0', borderRadius:9, cursor:'pointer', fontSize:13, fontWeight:800,
              background: saved ? `${C.green}22` : `${agent.color}22`,
              border:`2px solid ${saved ? C.green : agent.color}66`,
              color: saved ? C.green : agent.color,
              transition:'all .2s',
            }}>
              {saving ? '⏳ Saving…' : saved ? '✅ Saved!' : `⚙ Save ${agent.abbr} Config`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Slider({ label, desc, value, min, max, step, format, color, onChange }) {
  const col = typeof color === 'function' ? color(value) : color
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div style={{ background:C.bg, borderRadius:8, padding:'11px 12px', border:`1px solid ${C.border}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
        <div>
          <span style={{ fontSize:12, color:C.text }}>{label}</span>
          <div style={{ fontSize:9, color:C.muted, marginTop:1 }}>{desc}</div>
        </div>
        <span style={{ fontSize:14, fontWeight:700, color:col, fontFamily:'monospace' }}>
          {format(value)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width:'100%', accentColor: col, marginTop:4 }}/>
      <div style={{ marginTop:6 }}>
        <ProgressBar value={pct} color={col} height={3}/>
      </div>
    </div>
  )
}
