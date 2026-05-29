import { useState, useEffect } from 'react'
import { C, Badge, ProgressBar, mono } from '../shared'
import api from '../../lib/api'

const HORIZONS = [
  { id: 'scalping', label: 'Scalping',  desc: 'Seconds–minutes · 5m bars · Best: VOL, DQN, MRV',  color: C.red,    icon: '⚡' },
  { id: 'day',      label: 'Day Trade', desc: 'Minutes–hours · 1h bars · Best: MOM, SEN, PPO',     color: C.yellow, icon: '☀️' },
  { id: 'swing',    label: 'Swing',     desc: 'Days–weeks · 1d bars · Best: MOM, MAC, MRV, OPT',   color: C.accent, icon: '🌊' },
  { id: 'position', label: 'Position',  desc: 'Weeks–months · 1wk bars · Best: MAC, OPT, REG',     color: C.green,  icon: '🏔️' },
]

const AGENT_ABBRS = ['MOM','MRV','PPO','DQN','MAC','SEN','VOL','REG','OPT']
const COMMON_SYMBOLS = ['SPY','QQQ','AAPL','MSFT','NVDA','TSLA','META','AMZN','GLD','TLT','BTC-USD','ETH-USD','VIX']

export function OrderModal({ isOpen, onClose, prefill, onExecuted, agents = [] }) {
  const [form, setForm] = useState({
    symbol: 'SPY', side: 'BUY', quantity: 1, agent_abbr: 'MOM',
    order_type: 'MARKET', limit_price: '', horizon: 'swing',
    reason: '', confidence: 0.7,
  })
  const [loading, setLoading]         = useState(false)
  const [result,  setResult]          = useState(null)
  const [signal,  setSignal]          = useState(null)
  const [recommended, setRecommended] = useState([])
  const [livePrice, setLivePrice]     = useState(null)
  const [priceLoading, setPriceLoading] = useState(false)

  // Pre-fill from Ollama suggestion
  useEffect(() => {
    if (prefill) {
      setForm(f => ({
        ...f,
        symbol:     prefill.symbol     || f.symbol,
        side:       prefill.action     || f.side,
        quantity:   prefill.quantity   || f.quantity,
        agent_abbr: prefill.agent_abbr || f.agent_abbr,
        horizon:    prefill.horizon    || f.horizon,
        order_type: prefill.order_type || f.order_type,
        limit_price: prefill.limit_price || '',
        confidence:  prefill.confidence || 0.7,
        reason:      prefill.reasoning  || '',
      }))
      setResult(null); setSignal(null)
    }
  }, [prefill])

  // Fetch live price when symbol changes
  useEffect(() => {
    if (!isOpen || !form.symbol) return
    setPriceLoading(true)
    fetch(`/api/quote/${form.symbol}`)
      .then(r => r.json())
      .then(d => { if (d?.price > 0) setLivePrice(d); setPriceLoading(false) })
      .catch(() => setPriceLoading(false))
  }, [form.symbol, isOpen])

  // Fetch recommended agents for horizon
  useEffect(() => {
    fetch(`/api/horizons/recommend?horizon=${form.horizon}`)
      .then(r => r.json())
      .then(d => d?.recommended_agents && setRecommended(d.recommended_agents))
      .catch(() => {})
  }, [form.horizon])

  // Fetch agent signal for current config
  const runSignal = async () => {
    setSignal(null)
    try {
      const res = await fetch(`/api/agents/${form.agent_abbr}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: form.symbol, horizon: form.horizon, force_retrain: false }),
      }).then(r => r.json())
      setSignal(res)
      if (res.action && res.action !== 'HOLD') {
        setForm(f => ({ ...f, side: res.action, confidence: res.confidence || 0.7 }))
      }
    } catch (e) {}
  }

  const submit = async () => {
    setLoading(true); setResult(null)
    try {
      const res = await fetch('/api/trades/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol:      form.symbol,
          side:        form.side,
          quantity:    Number(form.quantity),
          agent_abbr:  form.agent_abbr,
          order_type:  form.order_type,
          limit_price: form.limit_price ? Number(form.limit_price) : null,
          horizon:     form.horizon,
          confidence:  Number(form.confidence),
          reason:      form.reason,
        }),
      }).then(r => r.json())
      setResult({ ...res, ok: true })
      onExecuted?.(res)
    } catch (e) {
      setResult({ ok: false, error: e.message })
    }
    setLoading(false)
  }

  if (!isOpen) return null

  const horizonCfg = HORIZONS.find(h => h.id === form.horizon) || HORIZONS[2]
  const price = livePrice?.price || 0
  const notional = price * Number(form.quantity || 0)
  const fee = notional * 0.001

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000000bb', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#0f1829', border: `1px solid ${C.border}`, borderRadius: 14,
        width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto',
        padding: 28,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>⚡ Execute Paper Trade</h2>
            <p style={{ fontSize: 11, color: C.muted, margin: '3px 0 0' }}>Simulated order with real market price · slippage + fees applied</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Time Horizon Selector */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Time Horizon</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {HORIZONS.map(h => (
              <button key={h.id} onClick={() => setForm(f => ({ ...f, horizon: h.id }))} style={{
                padding: '10px 8px', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
                background: form.horizon === h.id ? `${h.color}18` : C.surface,
                border: `1px solid ${form.horizon === h.id ? `${h.color}66` : C.border}`,
                transition: 'all .15s',
              }}>
                <div style={{ fontSize: 16, marginBottom: 3 }}>{h.icon}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: form.horizon === h.id ? h.color : C.text }}>{h.label}</div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{h.desc.split('·')[0]}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Recommended agents for this horizon */}
        {recommended.length > 0 && (
          <div style={{ marginBottom: 16, padding: '8px 12px', background: `${horizonCfg.color}10`, borderRadius: 8, border: `1px solid ${horizonCfg.color}33` }}>
            <span style={{ fontSize: 10, color: C.muted }}>Best agents for {horizonCfg.label}: </span>
            <span style={{ fontSize: 10, color: horizonCfg.color, fontFamily: 'monospace' }}>
              {recommended.join(' · ')}
            </span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Symbol */}
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: .8 }}>Symbol</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={form.symbol}
                  onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                  style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 13, fontWeight: 700, outline: 'none', fontFamily: 'monospace' }}
                />
                <select value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, padding: '0 8px', fontSize: 11, outline: 'none' }}>
                  {COMMON_SYMBOLS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              {livePrice && (
                <div style={{ marginTop: 5, fontSize: 11, color: C.muted }}>
                  Live: <span style={{ color: C.text, fontFamily: 'monospace', fontWeight: 700 }}>${livePrice.price?.toFixed(2)}</span>
                  <span style={{ color: livePrice.change_pct >= 0 ? C.green : C.red, marginLeft: 6, fontFamily: 'monospace' }}>
                    {livePrice.change_pct >= 0 ? '+' : ''}{livePrice.change_pct?.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>

            {/* Side */}
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: .8 }}>Side</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['BUY','SELL','HOLD'].map(s => (
                  <button key={s} onClick={() => setForm(f => ({ ...f, side: s }))} style={{
                    flex: 1, padding: '9px 0', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer',
                    background: form.side === s ? (s === 'BUY' ? `${C.green}22` : s === 'SELL' ? `${C.red}22` : `${C.muted}22`) : C.surface,
                    border: `1px solid ${form.side === s ? (s === 'BUY' ? `${C.green}66` : s === 'SELL' ? `${C.red}66` : `${C.muted}44`) : C.border}`,
                    color: form.side === s ? (s === 'BUY' ? C.green : s === 'SELL' ? C.red : C.muted) : C.muted,
                  }}>{s}</button>
                ))}
              </div>
            </div>

            {/* Quantity */}
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: .8 }}>Quantity</div>
              <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} min="0.001" step="1"
                style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 13, outline: 'none', fontFamily: 'monospace' }}/>
            </div>

            {/* Order type */}
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: .8 }}>Order Type</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['MARKET','LIMIT','STOP'].map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, order_type: t }))} style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                    background: form.order_type === t ? `${C.accent}22` : C.surface,
                    border: `1px solid ${form.order_type === t ? `${C.accent}66` : C.border}`,
                    color: form.order_type === t ? C.accent : C.muted,
                  }}>{t}</button>
                ))}
              </div>
              {form.order_type !== 'MARKET' && (
                <input type="number" placeholder="Limit/Stop Price" value={form.limit_price} onChange={e => setForm(f => ({ ...f, limit_price: e.target.value }))}
                  style={{ marginTop: 8, width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 13, outline: 'none', fontFamily: 'monospace' }}/>
              )}
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Agent selector */}
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: .8 }}>Agent</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                {AGENT_ABBRS.map(abbr => {
                  const a = agents.find(x => x.abbr === abbr)
                  const isRec = recommended.includes(abbr)
                  return (
                    <button key={abbr} onClick={() => setForm(f => ({ ...f, agent_abbr: abbr }))} style={{
                      padding: '7px 4px', borderRadius: 7, cursor: 'pointer', position: 'relative',
                      background: form.agent_abbr === abbr ? `${a?.color || C.accent}22` : C.surface,
                      border: `1px solid ${form.agent_abbr === abbr ? `${a?.color || C.accent}66` : isRec ? `${C.yellow}44` : C.border}`,
                    }}>
                      <div style={{ fontSize: 13 }}>{a?.icon || '🤖'}</div>
                      <div style={{ fontSize: 9, color: form.agent_abbr === abbr ? (a?.color || C.accent) : C.muted, fontFamily: 'monospace', fontWeight: 700 }}>{abbr}</div>
                      {isRec && <div style={{ position: 'absolute', top: 2, right: 2, width: 4, height: 4, borderRadius: 99, background: C.yellow }}/>}
                    </button>
                  )
                })}
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: C.muted }}>
                ● = recommended for {horizonCfg.label}
              </div>
            </div>

            {/* Confidence */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: .8 }}>Confidence</span>
                <span style={{ fontSize: 10, color: C.accent, fontFamily: 'monospace' }}>{Math.round(form.confidence * 100)}%</span>
              </div>
              <input type="range" min="0.1" max="1" step="0.05" value={form.confidence}
                onChange={e => setForm(f => ({ ...f, confidence: parseFloat(e.target.value) }))}
                style={{ width: '100%', accentColor: C.accent }}/>
            </div>

            {/* Reason */}
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: .8 }}>Reason / Notes</div>
              <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={3} placeholder="Optional trade rationale…"
                style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 11, outline: 'none', resize: 'none', lineHeight: 1.5 }}/>
            </div>

            {/* Order preview */}
            <div style={{ background: C.bg, borderRadius: 8, padding: 12, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: .8 }}>Order Preview</div>
              {[
                ['Symbol', form.symbol, C.text],
                ['Side', form.side, form.side === 'BUY' ? C.green : form.side === 'SELL' ? C.red : C.muted],
                ['Price', priceLoading ? '…' : `$${price.toFixed(2)}`, C.text],
                ['Notional', `$${notional.toFixed(2)}`, C.text],
                ['Fee (~0.1%)', `$${fee.toFixed(2)}`, C.muted],
                ['Total', `$${(notional + fee).toFixed(2)}`, C.yellow],
              ].map(([l, v, c]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{l}</span>
                  <span style={{ fontSize: 11, color: c, fontFamily: 'monospace', fontWeight: 700 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Get Agent Signal button */}
        <button onClick={runSignal} style={{
          width: '100%', padding: '9px 0', marginBottom: 12, borderRadius: 8, cursor: 'pointer',
          background: `${C.purple}18`, border: `1px solid ${C.purple}44`, color: C.purple, fontSize: 12, fontWeight: 600,
        }}>
          🧠 Get {form.agent_abbr} Signal for {form.symbol} ({form.horizon})
        </button>

        {/* Signal result */}
        {signal && (
          <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: `${signal.action === 'BUY' ? C.green : signal.action === 'SELL' ? C.red : C.muted}15`, border: `1px solid ${signal.action === 'BUY' ? C.green : signal.action === 'SELL' ? C.red : C.muted}44` }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: signal.action === 'BUY' ? C.green : signal.action === 'SELL' ? C.red : C.muted, fontFamily: 'monospace' }}>
                {signal.action}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                Confidence: <span style={{ color: C.text, fontFamily: 'monospace' }}>{Math.round((signal.confidence || 0) * 100)}%</span>
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                Source: <span style={{ color: C.cyan, fontFamily: 'monospace' }}>{signal.source || 'model'}</span>
              </div>
              {signal.sentiment_score !== undefined && (
                <div style={{ fontSize: 11, color: C.muted }}>
                  Sentiment: <span style={{ color: signal.sentiment_score > 0 ? C.green : C.red, fontFamily: 'monospace' }}>
                    {signal.sentiment_score > 0 ? '+' : ''}{signal.sentiment_score.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Execute / Result */}
        {!result ? (
          <button onClick={submit} disabled={loading} style={{
            width: '100%', padding: '13px 0', borderRadius: 9, fontSize: 14, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
            background: form.side === 'BUY' ? `${C.green}22` : form.side === 'SELL' ? `${C.red}22` : C.surface,
            border: `2px solid ${form.side === 'BUY' ? `${C.green}66` : form.side === 'SELL' ? `${C.red}66` : C.border}`,
            color: form.side === 'BUY' ? C.green : form.side === 'SELL' ? C.red : C.muted,
            opacity: loading ? 0.6 : 1,
          }}>
            {loading ? '⏳ Executing…' : `⚡ ${form.side} ${form.quantity} × ${form.symbol}`}
          </button>
        ) : (
          <div style={{ padding: '14px 16px', borderRadius: 9, background: result.ok ? `${C.green}18` : `${C.red}18`, border: `1px solid ${result.ok ? C.green : C.red}44` }}>
            {result.ok ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginBottom: 8 }}>✅ Trade Executed</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
                  {[
                    ['Fill Price', `$${result.price?.toFixed(2)}`],
                    ['Notional', `$${result.notional?.toFixed(2)}`],
                    ['Fee', `$${result.fee?.toFixed(4)}`],
                    ['Slippage', `$${result.slippage?.toFixed(4)}`],
                    ['Status', result.status],
                    ['Agent', result.agent_abbr],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <span style={{ color: C.muted }}>{l}: </span>
                      <span style={{ color: C.text, fontFamily: 'monospace', fontWeight: 700 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => { setResult(null); onClose() }} style={{ marginTop: 10, padding: '7px 16px', borderRadius: 7, background: `${C.green}22`, border: `1px solid ${C.green}44`, color: C.green, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Close</button>
              </>
            ) : (
              <div style={{ fontSize: 12, color: C.red }}>❌ {result.error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
