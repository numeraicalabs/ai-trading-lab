/**
 * ToastNotifications — real-time toast alerts from WebSocket events.
 *
 * Levels:  success (green) | info (blue) | warning (yellow) | error (red) | critical (red+pulse)
 * Events:  training_complete | stop_triggered | risk_warning | global_stop
 *          scout_opportunity | regime_change | model_restored | signal_high_conf
 */
import { useState, useEffect, useCallback } from 'react'

const COLORS = {
  success:  { bg:'#10b98118', border:'#10b98166', text:'#10b981', icon:'✅' },
  info:     { bg:'#3b82f618', border:'#3b82f666', text:'#3b82f6', icon:'💡' },
  warning:  { bg:'#f59e0b18', border:'#f59e0b66', text:'#f59e0b', icon:'⚠️' },
  error:    { bg:'#ef444418', border:'#ef444466', text:'#ef4444', icon:'❌' },
  critical: { bg:'#ef444428', border:'#ef4444aa', text:'#ef4444', icon:'🚨' },
}

const EVENT_ICONS = {
  training_complete:  '🧠',
  training_failed:    '❌',
  stop_triggered:     '🛑',
  risk_warning:       '⚠️',
  global_stop:        '🚨',
  scout_opportunity:  '🔭',
  signal_high_conf:   '💡',
  regime_change:      '🔍',
  model_restored:     '💾',
  notification:       '🔔',
}

const TTL = {
  success: 5000,
  info:    6000,
  warning: 9000,
  error:   12000,
  critical:0,     // critical stays until dismissed
}

let _nextId = 1

export function useToastSystem(lastMessage) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  const add = useCallback((toast) => {
    const id  = _nextId++
    const ttl = TTL[toast.level] ?? 6000
    setToasts(t => [{ ...toast, id, ttl }, ...t].slice(0, 6))
    if (ttl > 0) setTimeout(() => dismiss(id), ttl)
  }, [dismiss])

  // Listen to WS messages
  useEffect(() => {
    if (!lastMessage) return
    const m = lastMessage
    if (m.type === 'notification') {
      add({
        level:      m.level || 'info',
        event_type: m.event_type,
        title:      m.title,
        message:    m.message,
        data:       m.data,
      })
    }
    // Inline events from tick
    if (m.type === 'tick' && m.portfolio?.global_stop) {
      add({
        level:      'critical',
        event_type: 'global_stop',
        title:      '🚨 GLOBAL STOP ACTIVE',
        message:    'Portfolio drawdown limit reached — new orders blocked',
      })
    }
  }, [lastMessage, add])

  return { toasts, dismiss }
}

export function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || !toasts.length) return null

  return (
    <div style={{
      position:  'fixed',
      top:       78,    // below TopBar
      right:     20,
      zIndex:    2000,
      display:   'flex',
      flexDirection: 'column',
      gap:       8,
      maxWidth:  360,
      pointerEvents: 'none',
    }}>
      {toasts.map(t => {
        const s    = COLORS[t.level] || COLORS.info
        const icon = EVENT_ICONS[t.event_type] || s.icon

        return (
          <div key={t.id}
            className="fade-in"
            style={{
              background:    s.bg,
              border:        `1px solid ${s.border}`,
              borderLeft:    `4px solid ${s.text}`,
              borderRadius:  10,
              padding:       '11px 14px',
              backdropFilter:'blur(12px)',
              boxShadow:     `0 4px 24px rgba(0,0,0,.5), 0 0 12px ${s.text}22`,
              pointerEvents: 'all',
              animation:     t.level === 'critical' ? 'pulse 2s ease-in-out infinite' : undefined,
              cursor:        'default',
            }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, fontWeight:700, color:s.text, marginBottom:3,
                              display:'flex', alignItems:'center', gap:6 }}>
                  <span>{icon}</span>
                  <span>{t.title}</span>
                </div>
                <div style={{ fontSize:11, color:'#94a3b8', lineHeight:1.5 }}>{t.message}</div>
                {/* Extra data pills */}
                {t.data && Object.keys(t.data).length > 0 && (
                  <div style={{ display:'flex', gap:5, marginTop:5, flexWrap:'wrap' }}>
                    {Object.entries(t.data).slice(0, 3).map(([k, v]) => (
                      <span key={k} style={{
                        fontSize:9, padding:'1px 6px', borderRadius:4,
                        background:`${s.text}18`, color:s.text,
                        fontFamily:'monospace', fontWeight:600,
                      }}>{k}: {typeof v === 'number' ? v.toFixed?.(2) ?? v : String(v)}</span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => onDismiss(t.id)} style={{
                background:'none', border:'none', color:'#475569',
                fontSize:14, cursor:'pointer', padding:0, lineHeight:1,
                flexShrink:0,
              }}>✕</button>
            </div>
            {/* Progress bar for auto-dismiss */}
            {t.ttl > 0 && (
              <div style={{ marginTop:6, height:2, background:'#1e3050', borderRadius:99, overflow:'hidden' }}>
                <div style={{
                  height:'100%', background:s.text, borderRadius:99,
                  animation: `ticker ${t.ttl}ms linear forwards`,
                  transformOrigin:'left',
                  width:'100%',
                  transform:'scaleX(0)',
                  animationName:'shrink',
                }}/>
              </div>
            )}
          </div>
        )
      })}
      <style>{`
        @keyframes shrink { from { transform:scaleX(1); } to { transform:scaleX(0); } }
      `}</style>
    </div>
  )
}
