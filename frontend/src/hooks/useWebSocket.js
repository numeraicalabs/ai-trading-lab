import { useEffect, useRef, useState, useCallback } from 'react'

function getWsUrl() {
  // In prod: same host, just change protocol
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host  = window.location.host
  return `${proto}://${host}/ws/live`
}

export function useWebSocket() {
  const ref = useRef(null)
  const [connected,    setConnected]    = useState(false)
  const [lastTick,     setLastTick]     = useState(null)
  const [lastMessage,  setLastMessage]  = useState(null)

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(getWsUrl())
      ref.current = ws
      ws.onopen    = () => setConnected(true)
      ws.onclose   = () => { setConnected(false); setTimeout(connect, 3000) }
      ws.onerror   = () => {}
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data)
          setLastMessage(d)
          if (d.type === 'tick' || d.type === 'snapshot') setLastTick(d)
        } catch {}
      }
    } catch {}
  }, [])

  useEffect(() => {
    connect()
    const hb = setInterval(() => {
      if (ref.current?.readyState === WebSocket.OPEN) ref.current.send('ping')
    }, 15000)
    return () => { clearInterval(hb); ref.current?.close() }
  }, [connect])

  return { connected, lastTick, lastMessage }
}
