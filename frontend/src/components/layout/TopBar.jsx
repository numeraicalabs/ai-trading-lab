import { C } from '../shared'

export function TopBar({ page, onNav, connected, prices, navItems }) {
  const NAV = navItems || [
    { id:'dashboard', label:'Dashboard', icon:'⬛' },
    { id:'agents',    label:'Agents',    icon:'🤖' },
    { id:'network',   label:'Network',   icon:'🕸️' },
    { id:'analytics', label:'Analytics', icon:'📈' },
    { id:'trades',    label:'Trades',    icon:'📋' },
    { id:'chat',      label:'AI Chat',   icon:'💬' },
  ]
  const ticker = Object.entries(prices || {}).slice(0, 10)
  return (
    <>
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, height:28, overflow:'hidden' }}>
        <div className="ticker-inner">
          {[...ticker,...ticker].map(([sym,price],i)=>{
            const chg=((Math.random()-0.49)*2).toFixed(2); const up=parseFloat(chg)>=0
            return (
              <span key={i} style={{ display:'inline-flex', gap:8, alignItems:'center', fontSize:11 }}>
                <span style={{ fontWeight:700, color:C.text, fontFamily:'monospace' }}>{sym}</span>
                <span style={{ color:C.muted, fontFamily:'monospace' }}>{typeof price==='number'?price.toFixed(2):price}</span>
                <span style={{ color:up?C.green:C.red, fontFamily:'monospace', fontSize:10 }}>{up?'+':''}{chg}%</span>
              </span>
            )
          })}
        </div>
      </div>
      <nav style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, height:50, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:`linear-gradient(135deg,${C.accent},${C.purple})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>⚡</div>
          <span style={{ fontWeight:800, fontSize:14, letterSpacing:-.3 }}>AI Trading Lab</span>
          <span style={{ fontSize:10, color:C.muted, background:C.bg, border:`1px solid ${C.border}`, borderRadius:4, padding:'1px 6px', fontFamily:'monospace' }}>v3.0</span>
        </div>
        <div style={{ display:'flex', gap:2 }}>
          {NAV.map(n=>(
            <button key={n.id} onClick={()=>onNav(n.id)} style={{ padding:'5px 12px', borderRadius:7, fontSize:11, fontWeight:500, background:page===n.id?`${C.accent}22`:'transparent', border:`1px solid ${page===n.id?`${C.accent}66`:'transparent'}`, color:page===n.id?C.accent:C.muted, display:'flex', alignItems:'center', gap:4, transition:'all .15s', cursor:'pointer' }}>
              <span style={{ fontSize:12 }}>{n.icon}</span>{n.label}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <div className="pulse" style={{ width:7, height:7, borderRadius:99, background:connected?C.green:C.yellow, boxShadow:`0 0 6px ${connected?C.green:C.yellow}` }}/>
          <span style={{ fontSize:11, color:C.muted }}>{connected?'Live':'Demo'}</span>
          <div style={{ background:`${C.green}22`, border:`1px solid ${C.green}44`, borderRadius:6, padding:'3px 9px', fontSize:10, color:C.green, fontWeight:700 }}>MARKET OPEN</div>
        </div>
      </nav>
    </>
  )
}
