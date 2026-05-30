import { useState, useEffect, useCallback } from 'react'
import api from '../lib/api'
import { FALLBACK_AGENTS } from '../lib/fallback'

export function useAgents(lastTick) {
  const [agents,  setAgents]  = useState(FALLBACK_AGENTS)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    const d = await api.agents()
    if (d && Array.isArray(d) && d.length) setAgents(d)
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  // Merge live WebSocket ticks
  useEffect(() => {
    if (!lastTick?.agents) return
    setAgents(prev => prev.map(a => {
      const live = lastTick.agents[a.abbr]
      return live ? { ...a, ...live } : a
    }))
  }, [lastTick])

  return { agents, loading, refetch: fetch }
}
