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
  // Health checks
  health:         ()          => get('/health'),
  healthSupabase: ()          => get('/api/health/supabase'),
  healthData:     ()          => get('/api/health/data'),
  // Models registry
  models:         ()          => get('/api/models'),
  verifyModels:   (h='swing') => get(`/api/models/verify?horizon=${h}`),
  modelDetail:    (a,s,h)     => get(`/api/models/${a}/${s}/${h}`),
  trainingStats:  ()          => get('/api/training/stats'),
  // Backtest
  runBacktest:    (body)      => post('/api/backtest/run', body),
  runMultiBt:     (body)      => post('/api/backtest/multi', body),
  backtestResults:()          => get('/api/backtest/results'),
  backtestDetail: (a,s,h)     => get(`/api/backtest/results/${a}/${s}/${h}`),
  // Universe
  universe:       (sec,typ)   => get(`/api/universe${sec?`?sector=${sec}`:''}${typ?`${sec?'&':'?'}type=${typ}`:''}`),
  addSymbol:      (body)      => post('/api/universe/symbols', body),
  removeSymbol:   (sym)       => fetch(`/api/universe/symbols/${sym}`,{method:'DELETE'}).then(r=>r.json()),
  agentUniverse:  (a)         => get(`/api/universe/agent/${a}`),
  // Data upload
  uploadCsv:      (body)      => post('/api/data/upload-csv', body),
  listUploads:    ()          => get('/api/data/uploads'),
  // Multi-symbol training
  trainMulti:     (body)      => post('/api/train/multi', body),
  // Trade Repository
  repoPortfolio:  ()          => get('/api/repository/portfolio'),
  repoAgents:     ()          => get('/api/repository/agents'),
  repoAgent:      (a)         => get(`/api/repository/agent/${a}`),
  repoTrades:     (params='') => get(`/api/repository/trades?${params}`),
  repoSummary:    ()          => get('/api/repository/summary'),
  // Trading Mode & Approval
  tradingMode:     ()           => get('/api/trading/mode'),
  setTradingMode:  (m)          => post(`/api/trading/mode/${m}`, {}),
  brokerStatus:    ()           => get('/api/trading/broker'),
  approvalQueue:   ()           => get('/api/approval/queue'),
  approvalHistory: (n=50)       => get(`/api/approval/history?limit=${n}`),
  approvalStats:   ()           => get('/api/approval/stats'),
  approveOrder:    (id,body={}) => post(`/api/approval/${id}/approve`, body),
  rejectOrder:     (id,body={}) => post(`/api/approval/${id}/reject`, body),
  bulkApprove:     ()           => post('/api/approval/bulk/approve', {}),
  bulkReject:      ()           => post('/api/approval/bulk/reject', {}),
  // Price Store
  priceHistory:    (s,h)        => get(`/api/prices/history/${s}/${h}`),
  prefetchPrices:  (body)       => post('/api/prices/prefetch', body),
  cacheStats:      ()           => get('/api/prices/cache/stats'),
  storedSymbols:   ()           => get('/api/prices/stored'),
  // Risk Manager
  rmgStatus:      ()          => get('/api/risk-manager/status'),
  rmgAlerts:      (n=30)      => get(`/api/risk-manager/alerts?limit=${n}`),
  resetStop:      ()          => post('/api/risk-manager/reset-stop', {}),
  portfolioPnl:   ()          => get('/api/portfolio/pnl'),
  // Notifications
  notifications:  (n=50)      => get(`/api/notifications?limit=${n}`),
  // Storage
  storageModels:  ()          => get('/api/storage/models'),
  restoreModels:  ()          => post('/api/storage/restore', {}),
  // Positions & exposure
  allPositions:   ()          => get('/api/positions'),
  agentPositions: (a)         => get(`/api/positions/${a}`),
  exposure:       ()          => get('/api/portfolio/exposure'),
  rebalance:      ()          => post('/api/portfolio/rebalance', {}),
  // Network
  networkOpportunities: () => get('/api/network/opportunities'),
  networkCorrelation:   () => get('/api/network/correlation'),
  networkFlow:          () => get('/api/network/flow'),
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

// raw helper for custom paths
api.get  = (path)       => get(path)
api.post = (path, body) => post(path, body)

export default api
