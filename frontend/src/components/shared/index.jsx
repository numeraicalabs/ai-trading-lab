import { AreaChart, Area, ResponsiveContainer } from 'recharts'
export const C = { bg:'#0a0e17',surface:'#111827',card:'#141c2e',border:'#1e2d47',accent:'#3b82f6',green:'#10b981',red:'#ef4444',yellow:'#f59e0b',purple:'#8b5cf6',cyan:'#06b6d4',text:'#e2e8f0',muted:'#64748b',dim:'#334155' }
export const mono = { fontFamily:"'JetBrains Mono',monospace" }
export const fmt  = (n,d=2) => n>=0?`+${n.toFixed(d)}`:n.toFixed(d)
export const pct  = n => fmt(n)+'%'

export function Badge({ label, color }) {
  return <span style={{ background:`${color}22`,color,border:`1px solid ${color}44`,borderRadius:4,padding:'1px 7px',fontSize:10,fontWeight:700,letterSpacing:1,textTransform:'uppercase' }}>{label}</span>
}

export function MiniChart({ data=[], color, height=48 }) {
  const id = `g${color.replace(/[^a-z0-9]/gi,'')}`
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{top:2,right:0,left:0,bottom:0}}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor={color} stopOpacity={0.3}/>
          <stop offset="95%" stopColor={color} stopOpacity={0}/>
        </linearGradient></defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} dot={false} isAnimationActive={false}/>
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function ProgressBar({ value, color, height=4 }) {
  return (
    <div style={{background:C.border,borderRadius:99,height,overflow:'hidden'}}>
      <div style={{width:`${Math.min(100,Math.max(0,value))}%`,height:'100%',background:`linear-gradient(90deg,${color}88,${color})`,borderRadius:99,transition:'width .5s ease'}}/>
    </div>
  )
}

export function Card({ children, style={} }) {
  return <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,padding:20,...style}}>{children}</div>
}

export function SectionTitle({ title, sub }) {
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:13,fontWeight:700,color:C.text}}>{title}</div>
      {sub && <div style={{fontSize:11,color:C.muted,marginTop:2}}>{sub}</div>}
    </div>
  )
}

export function Spinner() {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:80}}>
      <div style={{width:24,height:24,borderRadius:'50%',border:`3px solid ${C.border}`,borderTopColor:C.accent,animation:'spin .7s linear infinite'}}/>
    </div>
  )
}
