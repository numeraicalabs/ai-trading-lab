# ⚡ AI Trading Lab

Multi-agent paper trading · 9 ML models · Real yfinance data · Ollama AI chat

## Stack
- **Backend** — FastAPI + Python 3.11 (serves both API and React SPA)
- **Frontend** — React 18 + Vite + Recharts
- **Database** — Supabase PostgreSQL
- **ML** — scikit-learn (GradientBoosting, RandomForest, LogisticRegression)
- **AI Chat** — Ollama (local LLM, optional)
- **Hosting** — Render (single web service)

## Project layout
```
trading-lab/
├── backend/
│   ├── main.py              ← FastAPI app (API + serves React)
│   ├── requirements.txt
│   ├── static/              ← React build output (auto-generated)
│   └── services/
│       ├── agents.py        ← 9 AI agents + ensemble
│       ├── market.py        ← yfinance + indicators
│       ├── trainer.py       ← scikit-learn ML training
│       ├── trainer_queue.py ← async training job queue
│       ├── paper.py         ← paper trading engine
│       └── ollama.py        ← Ollama chat/summarize
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── index.css
│       ├── App.jsx          ← root + 7 pages
│       ├── components/      ← shared UI, agents, trading, chat
│       ├── pages/           ← EcosystemPage
│       ├── hooks/           ← useWebSocket, useAgents
│       └── lib/             ← api.js, fallback.js
├── supabase/migrations/
│   ├── 001_init.sql
│   └── 002_model_versions.sql
├── render.yaml              ← single service blueprint
├── .env.example
└── .github/workflows/ci.yml
```

## Local development

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env     # fill SUPABASE_URL + SUPABASE_KEY
uvicorn main:app --reload --port 8000
# API: http://localhost:8000
# Docs: http://localhost:8000/docs
```

### Frontend (new terminal)
```bash
cd frontend
npm install
npm run dev
# App: http://localhost:5173  (Vite proxies /api and /ws to :8000)
```

## Deploy to Render

1. Push repo to GitHub
2. Render → **New → Blueprint** → connect repo
3. Render reads `render.yaml` automatically
4. Set env vars in Render dashboard:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Deploy — one URL serves everything

## Supabase setup

1. Create project at supabase.com
2. SQL Editor → run `supabase/migrations/001_init.sql`
3. SQL Editor → run `supabase/migrations/002_model_versions.sql`
4. Storage → create bucket `model-storage` (public)

## Ollama (optional AI chat)

```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3
ollama serve          # runs on http://localhost:11434
```

On Render free tier Ollama is not available — chat gracefully shows "offline".

## The 9 agents

| Abbr | Strategy | Horizons |
|------|----------|----------|
| MOM | Trend Following | day, swing |
| MRV | Mean Reversion | scalping, day |
| PPO | RL Policy Gradient | day, swing |
| DQN | Deep Q-Learning | scalping, day |
| MAC | Macro / Top-Down | swing, position |
| SEN | NLP Sentiment | day, swing |
| VOL | Volatility Trading | scalping, day |
| REG | Regime Detection | swing, position |
| OPT | Portfolio Optimizer | swing, position |

## v13 — New features

### Risk Manager (RMG) agent
- Portfolio drawdown monitoring — warning at 5%, hard stop at 10%
- Individual position auto-stop at 3% loss
- Concentration risk alerts (>40% in one symbol)
- Global stop flag — blocks all new orders when hard limit reached
- Dashboard → Risk Monitor tab with alert log

### Live P&L Tracking
- Every open position shows unrealized P&L in real-time via WebSocket
- Dashboard → P&L Live tab
- `GET /api/portfolio/pnl` — full breakdown by agent and position

### Model Persistence on Supabase Storage
- After every training, `.pkl` files uploaded gzip-compressed to `model-storage` bucket
- On app startup, missing models auto-restored from storage (survives redeployments)
- `GET /api/storage/models` — list stored models
- `POST /api/storage/restore` — manually trigger restore

### Toast Notifications
- Real-time alerts via WebSocket → toast popups
- Events: training complete/failed, stop loss triggered, regime change, model restored
- Dismissable with auto-timeout (critical alerts stay until dismissed)

### Authentication (Supabase Magic Link)
- Email magic-link login — no password needed
- "Skip auth" option for demo mode
- User avatar + signout in TopBar
- Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON` env vars

### New env vars
```
PORTFOLIO_DD_WARN=0.05     # drawdown warning threshold
PORTFOLIO_DD_HARD=0.10     # hard stop threshold
POSITION_DD_HARD=0.03      # per-position auto-stop
RMG_CHECK_INTERVAL=15      # seconds between RMG checks
VITE_SUPABASE_URL=...      # same as SUPABASE_URL
VITE_SUPABASE_ANON=...     # anon/public key from Supabase
```
