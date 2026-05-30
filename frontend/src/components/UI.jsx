import { AreaChart, Area, ResponsiveContainer } from 'recharts'

export const C = {
  bg:     '#050911', surface: '#0d1424', card:   '#111c30', card2:  '#16233a',
  border: '#1e3050', border2: '#243a5e',
  accent: '#3b82f6', green:   '#10b981', red:    '#ef4444', yellow: '#f59e0b',
  purple: '#8b5cf6', cyan:    '#06b6d4', pink:   '#f0abfc',
  text:   '#e2e8f0', muted:   '#64748b', dim:    '#334155',
}
export const mono = { fontFamily: "'JetBrains Mono','Fira Code',monospace" }
export const fmt  = (n, d = 2) => (n >= 0 ? `+${n.toFixed(d)}` : n.toFixed(d))
export const pct  = (n) => fmt(n) + '%'

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style = {}, glow = null, hover = false }) {
  const glowStyle = glow
    ? { boxShadow: `0 0 24px ${glow}22, inset 0 0 0 1px ${glow}22` }
    : {}
  return (
    <div className={hover ? 'neon-hover' : ''}
      style={{
        background: `linear-gradient(145deg, ${C.card}, ${C.card2})`,
        borderRadius: 14,
        border: `1px solid ${glow ? glow + '44' : C.border}`,
        padding: 20,
        ...glowStyle,
        ...style,
      }}>
      {children}
    </div>
  )
}

export function SectionTitle({ title, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({ label, color }) {
  return (
    <span style={{
      background: `${color}18`, color,
      border: `1px solid ${color}44`,
      borderRadius: 5, padding: '2px 8px',
      fontSize: 10, fontWeight: 700,
      letterSpacing: 1, textTransform: 'uppercase',
    }}>{label}</span>
  )
}

// ── Progress ──────────────────────────────────────────────────────────────────
export function ProgressBar({ value, color, height = 4 }) {
  const v = Math.min(100, Math.max(0, value))
  return (
    <div style={{ background: C.border, borderRadius: 99, height, overflow: 'hidden' }}>
      <div style={{
        width: `${v}%`, height: '100%', borderRadius: 99,
        background: `linear-gradient(90deg, ${color}88, ${color})`,
        boxShadow: `0 0 8px ${color}66`,
        transition: 'width .5s ease',
      }} />
    </div>
  )
}

// ── MiniChart ─────────────────────────────────────────────────────────────────
export function MiniChart({ data = [], color, height = 48 }) {
  const id = `g${color.replace(/[^a-z0-9]/gi, '')}`
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.8}
              fill={`url(#${id})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 24 }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height: 80 }}>
      <div className="spin" style={{
        width: size, height: size, borderRadius: '50%',
        border: `3px solid ${C.border}`, borderTopColor: C.accent,
        boxShadow: `0 0 12px ${C.accent}44`,
      }} />
    </div>
  )
}

// ── Stat chip ─────────────────────────────────────────────────────────────────
export function StatChip({ label, value, color = C.text, icon = '' }) {
  return (
    <div style={{
      background: `${color}0c`, border: `1px solid ${color}28`,
      borderRadius: 10, padding: '10px 14px',
    }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase',
                    letterSpacing: 1, marginBottom: 4 }}>{icon} {label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

// ── Tooltip config ─────────────────────────────────────────────────────────────
export const TT = {
  contentStyle: {
    background: '#0d1424', border: `1px solid #1e3050`,
    borderRadius: 10, fontSize: 11, color: '#e2e8f0',
    boxShadow: '0 8px 24px rgba(0,0,0,.5)',
  },
  cursor: { stroke: '#243a5e', strokeWidth: 1 },
}
