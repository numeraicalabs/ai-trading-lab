/**
 * API client — works in both dev (vite proxy → :8000) and
 * production (same origin, FastAPI serves the React build).
 */
const BASE = ''   // Always relative — works in dev via Vite proxy, in prod via same-origin

async function get(path) {
  try {
    const r = await fetch(BASE + path)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  } catch (e) {
    console.warn('GET', path, e.message)
    return null
  }
}

async function post(path, body) {
  try {
    const r = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  } catch (e) {
    console.warn('POST', path, e.message)
    return null
  }
}

export const api = {
  agents:       ()      => get('/api/agents'),
  agent:        (a)     => get(`/api/agents/${a}`),
  portfolio:    ()      => get('/api/portfolio'),
  prices:       ()      => get('/api/prices'),
  trades:       (a, l)  => get(`/api/trades${a ? `?agent=${a}` : ''}${l ? `${a ? '&' : '?'}limit=${l}` : ''}`),
  signals:      ()      => get('/api/signals'),
  ensemble:     ()      => get('/api/signals/ensemble'),
  risk:         ()      => get('/api/analytics/risk'),
  equity:       (n=80)  => get(`/api/analytics/equity-history?points=${n}`),
  scenario:     ()      => get('/api/analytics/scenario'),
  watchlist:    ()      => get('/api/watchlist'),
  ollamaStatus: ()      => get('/api/ollama/status'),
  ecoStatus:    ()      => get('/api/ecosystem/status'),
  trainingJobs: ()      => get('/api/training/jobs'),
  horizons:     (h)     => get(`/api/horizons/recommend?horizon=${h}`),
  quote:        (s)     => get(`/api/quote/${s}`),
  trainAgent:   (a, b)  => post(`/api/agents/${a}/train`, b),
  runAgent:     (a, b)  => post(`/api/agents/${a}/run`, b),
  commentary:   (a)     => post(`/api/agents/${a}/commentary`, {}),
  trainAll:     (b)     => post('/api/ecosystem/train-all', b),
  executeTrade: (b)     => post('/api/trades/execute', b),
  chat:         (b)     => post('/api/chat', b),
  parseOrder:   (b)     => post('/api/chat/parse-order', b),
  summarize:    (b)     => post('/api/summarize', b),
}

export default api
