import { C } from '../shared'
export function TopBar({ page, onNav, connected, prices, navItems=[] }) {
  const ticker = Object.entries(prices||{}).slice(0,10)
  return (
    <>
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,height:28,overflow:'hidden'}}>
        <div className="ticker-inner">
          {[...ticker,...ticker].map(([sym,p],i)=>{
            const chg=((Math.random()-.49)*1.8).toFixed(2); const up=parseFloat(chg)>=0
            return (
              <span key={i} style={{display:'inline-flex',gap:7,alignItems:'center',fontSize:11}}>
                <span style={{fontWeight:700,color:C.text,fontFamily:'monospace'}}>{sym}</span>
                <span style={{color:C.muted,fontFamily:'monospace'}}>{typeof p==='number'?p.toFixed(2):p}</span>
                <span style={{color:up?C.green:C.red,fontFamily:'monospace',fontSize:10}}>{up?'+':''}{chg}%</span>
              </span>
            )
          })}
        </div>
      </div>
      <nav style={{background:C.surface,borderBottom:`1px solid ${C.border}`,height:50,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 24px',position:'sticky',top:0,zIndex:100}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>⚡</div>
          <span style={{fontWeight:800,fontSize:14}}>AI Trading Lab</span>
          <span style={{fontSize:10,color:C.muted,background:C.bg,border:`1px solid ${C.border}`,borderRadius:4,padding:'1px 6px',fontFamily:'monospace'}}>v4.0</span>
        </div>
        <div style={{display:'flex',gap:2}}>
          {navItems.map(n=>(
            <button key={n.id} onClick={()=>onNav(n.id)} style={{padding:'5px 11px',borderRadius:7,fontSize:11,fontWeight:500,background:page===n.id?`${C.accent}22`:'transparent',border:`1px solid ${page===n.id?`${C.accent}66`:'transparent'}`,color:page===n.id?C.accent:C.muted,display:'flex',alignItems:'center',gap:4,cursor:'pointer',transition:'all .15s'}}>
              <span>{n.icon}</span>{n.label}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <div className="pulse" style={{width:7,height:7,borderRadius:99,background:connected?C.green:C.yellow,boxShadow:`0 0 6px ${connected?C.green:C.yellow}`}}/>
          <span style={{fontSize:11,color:C.muted}}>{connected?'Live':'Demo'}</span>
          <div style={{background:`${C.green}22`,border:`1px solid ${C.green}44`,borderRadius:6,padding:'3px 8px',fontSize:10,color:C.green,fontWeight:700}}>MARKET OPEN</div>
        </div>
      </nav>
    </>
  )
}
