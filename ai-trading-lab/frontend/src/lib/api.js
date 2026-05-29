const BASE = import.meta.env.VITE_API_URL || ''

async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } catch (e) {
    console.warn(`API error [${path}]:`, e.message)
    return null
  }
}

export const api = {
  agents:      ()      => apiFetch('/api/agents'),
  agent:       (abbr)  => apiFetch(`/api/agents/${abbr}`),
  portfolio:   ()      => apiFetch('/api/portfolio'),
  prices:      ()      => apiFetch('/api/prices'),
  trades:      (a, l)  => apiFetch(`/api/trades${a ? `?agent=${a}` : ''}${l ? `&limit=${l}` : ''}`),
  risk:        ()      => apiFetch('/api/analytics/risk'),
  correlation: ()      => apiFetch('/api/analytics/correlation'),
  equity:      (n)     => apiFetch(`/api/analytics/equity-history?points=${n || 80}`),
  scenario:    ()      => apiFetch('/api/analytics/scenario'),
  watchlist:   ()      => apiFetch('/api/watchlist'),
  executeTrade: (body) => apiFetch('/api/trades/execute', { method: 'POST', body: JSON.stringify(body) }),
}

export default api

// Extra method used by OllamaChat
api.fetch = (path, opts) => fetch((import.meta?.env?.VITE_API_URL || '') + path, opts).then(r => r.json()).catch(() => null)
