import { useEffect, useRef, useState, useCallback } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || ''

export function useWebSocket() {
  const wsRef   = useRef(null)
  const [connected, setConnected] = useState(false)
  const [lastTick,  setLastTick]  = useState(null)

  const connect = useCallback(() => {
    if (!WS_URL) return
    const protocol = WS_URL.startsWith('https') ? 'wss' : 'ws'
    const url = WS_URL.replace(/^https?/, protocol) + '/ws/live'

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen  = () => { setConnected(true); console.log('WS connected') }
    ws.onclose = () => {
      setConnected(false)
      // Reconnect after 3s
      setTimeout(connect, 3000)
    }
    ws.onerror = (e) => console.warn('WS error', e)
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'tick' || data.type === 'snapshot') {
          setLastTick(data)
        }
      } catch {}
    }
  }, [])

  useEffect(() => {
    connect()
    // Heartbeat
    const hb = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping')
      }
    }, 15000)
    return () => {
      clearInterval(hb)
      wsRef.current?.close()
    }
  }, [connect])

  return { connected, lastTick }
}
