/**
 * API client — uses relative URLs.
 * Dev:  Vite proxy forwards /api/* and /ws/* to FastAPI on :8000
 * Prod: FastAPI serves everything on the same origin
 */
async function get(path) {
  try {
    const r = await fetch(path)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  } catch (e) { console.warn('GET', path, e.message); return null }
}

async function post(path, body) {
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  } catch (e) { console.warn('POST', path, e.message); return null }
}

export const api = {
  // Market
  prices:       ()         => get('/api/prices'),
  quote:        (sym)      => get(`/api/quote/${sym}`),
  portfolio:    ()         => get('/api/portfolio'),
  watchlist:    ()         => get('/api/watchlist'),
  ohlcv:        (sym, h)   => get(`/api/market/ohlcv/${sym}?horizon=${h}`),
  news:         (sym)      => get(`/api/market/news/${sym}`),
  // Agents
  agents:       ()         => get('/api/agents'),
  agent:        (a)        => get(`/api/agents/${a}`),
  agentModel:   (a)        => get(`/api/agents/${a}/model`),
  setHorizon:   (a, h)     => post(`/api/agents/${a}/horizon`, { horizon: h }),
  trainAgent:   (a, body)  => post(`/api/agents/${a}/train`, body),
  runAgent:     (a, body)  => post(`/api/agents/${a}/run`, body),
  commentary:   (a)        => post(`/api/agents/${a}/commentary`, {}),
  // Ecosystem
  ecoStatus:    ()         => get('/api/ecosystem/status'),
  trainAll:     (body)     => post('/api/ecosystem/train-all', body),
  trainingJobs: ()         => get('/api/training/jobs'),
  trainingJob:  (id)       => get(`/api/training/jobs/${id}`),
  // Trades
  trades:       (a, l)     => get(`/api/trades${a?`?agent=${a}`:''}${l?`${a?'&':'?'}limit=${l}`:''}`),
  executeTrade: (body)     => post('/api/trades/execute', body),
  // Signals
  signals:      ()         => get('/api/signals'),
  ensemble:     ()         => get('/api/signals/ensemble'),
  horizons:     (h)        => get(`/api/horizons/recommend?horizon=${h}`),
  // Analytics
  risk:         ()         => get('/api/analytics/risk'),
  equity:       (n=80)     => get(`/api/analytics/equity-history?points=${n}`),
  scenario:     ()         => get('/api/analytics/scenario'),
  // Impulses + Config + Regime
  impulses:     (n=50)     => get(`/api/impulses?limit=${n}`),
  liveImpulses: ()         => get('/api/impulses/live'),
  regime:       ()         => get('/api/regime'),
  agentConfig:  (a)        => get(`/api/agents/${a}/config`),
  updateConfig: (a, body)  => fetch(`/api/agents/${a}/config`, {
                                method:'PATCH',
                                headers:{'Content-Type':'application/json'},
                                body:JSON.stringify(body) }).then(r=>r.json()),
  // Ollama
  ollamaStatus: ()         => get('/api/ollama/status'),
  chat:         (body)     => post('/api/chat', body),
  parseOrder:   (body)     => post('/api/chat/parse-order', body),
  summarize:    (body)     => post('/api/summarize', body),
}

export default api
