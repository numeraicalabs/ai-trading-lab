/**
 * ReportButton — floating button to generate and share HTML reports.
 * Appears on Dashboard, SCOUT, and Backtest pages.
 */
import { useState } from 'react'
import { C } from './UI'
import api from '../lib/api'

const PAGE_REPORT = {
  dashboard: { label: 'Portfolio Report', fn: () => api.genPortfolioReport() },
  scout:     { label: 'SCOUT Report',     fn: () => api.genScoutReport() },
}

export function ReportButton({ page }) {
  const [loading,  setLoading]  = useState(false)
  const [reportUrl,setReportUrl]= useState(null)
  const [copied,   setCopied]   = useState(false)

  const cfg = PAGE_REPORT[page]
  if (!cfg) return null

  const generate = async () => {
    setLoading(true); setReportUrl(null)
    const r = await cfg.fn()
    if (r?.url) {
      const fullUrl = `${window.location.origin}${r.url}`
      setReportUrl(fullUrl)
    }
    setLoading(false)
  }

  const copy = () => {
    navigator.clipboard?.writeText(reportUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ position:'relative', display:'inline-flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
      <button onClick={generate} disabled={loading} style={{
        padding:'7px 14px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:700,
        display:'flex', alignItems:'center', gap:6,
        background:`${C.accent}18`, border:`1px solid ${C.accent}44`, color:C.accent,
        opacity: loading ? 0.6 : 1,
      }}>
        {loading ? '⏳' : '📊'} {loading ? 'Generating…' : cfg.label}
      </button>

      {reportUrl && (
        <div style={{
          position:'absolute', top:'100%', right:0, marginTop:6,
          background:'#0f1829', border:`1px solid ${C.green}44`,
          borderRadius:10, padding:14, width:320, zIndex:200,
          boxShadow:'0 8px 24px #0008',
        }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.green, marginBottom:8 }}>
            ✅ Report ready
          </div>
          <div style={{ background:C.bg, borderRadius:6, padding:'7px 10px', marginBottom:10,
                        fontFamily:'monospace', fontSize:10, color:C.muted,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {reportUrl}
          </div>
          <div style={{ display:'flex', gap:7 }}>
            <button onClick={copy} style={{
              flex:1, padding:'6px 0', borderRadius:7, cursor:'pointer', fontSize:11, fontWeight:700,
              background:`${C.accent}22`, border:`1px solid ${C.accent}44`, color:C.accent,
            }}>{copied ? '✅ Copied!' : '📋 Copy Link'}</button>
            <a href={reportUrl} target="_blank" rel="noreferrer" style={{
              flex:1, padding:'6px 0', borderRadius:7, cursor:'pointer', fontSize:11,
              fontWeight:700, textAlign:'center', textDecoration:'none',
              background:`${C.green}22`, border:`1px solid ${C.green}44`, color:C.green,
            }}>🔗 Open</a>
          </div>
          <div style={{ fontSize:9, color:C.muted, marginTop:8 }}>
            Anyone with the link can view this report
          </div>
        </div>
      )}
    </div>
  )
}
