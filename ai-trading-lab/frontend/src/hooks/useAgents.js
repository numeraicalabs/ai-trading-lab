import { useState, useEffect, useCallback } from 'react'
import api from '../lib/api'
import { FALLBACK_AGENTS } from '../lib/fallback'

export function useAgents(lastTick) {
  const [agents, setAgents] = useState(FALLBACK_AGENTS)
  const [loading, setLoading] = useState(true)

  const fetchAgents = useCallback(async () => {
    const data = await api.agents()
    if (data && Array.isArray(data) && data.length > 0) {
      setAgents(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAgents() }, [fetchAgents])

  // Merge live websocket data
  useEffect(() => {
    if (!lastTick?.agents) return
    setAgents(prev => prev.map(a => {
      const live = lastTick.agents[a.abbr]
      if (!live) return a
      return { ...a, ...live }
    }))
  }, [lastTick])

  return { agents, loading, refetch: fetchAgents }
}
