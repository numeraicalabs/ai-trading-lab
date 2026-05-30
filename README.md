# ⚡ AI Trading Lab

Multi-agent paper trading platform — 9 ML models, real market data, Ollama AI chat.

**Stack:** React 18 + Vite · FastAPI + Python 3.11 · Supabase PostgreSQL · Ollama (local LLM) · yfinance · scikit-learn

---

## 🚀 Local Development (5 minutes)

### 1. Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example .env           # fill in SUPABASE_URL + SUPABASE_KEY
uvicorn main:app --reload --port 8000
# → http://localhost:8000/health
# → http://localhost:8000/docs    (Swagger UI)
```

### 2. Frontend (new terminal)
```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173   ← open this in your browser
```

The Vite dev server proxies `/api/*` and `/ws/*` to `localhost:8000` automatically.

---

## ☁️ Deploy to Render (single service)

1. Push repo to GitHub
2. Go to [render.com](https://render.com) → **New Blueprint**
3. Connect your repo — Render reads `render.yaml` automatically
4. Set environment variables:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_KEY` = your anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key
5. Click **Apply** → wait ~5 minutes for build

**Single service, single URL** — FastAPI serves both the API and the React app.
No CORS confusion, no "wrong URL" issues.

---

## 🗄️ Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run both migrations in order:
   - `supabase/migrations/001_init.sql`
   - `supabase/migrations/002_model_versions.sql`
3. Go to **Storage** → create a bucket called `model-storage` (public)
4. Copy your URL + keys to `.env`

---

## 🤖 Ollama (AI Chat)

```bash
# Install Ollama: https://ollama.ai
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3
ollama serve        # keeps running on http://localhost:11434
```

Add to `.env`:
```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

On Render (free tier), Ollama must run locally or on a separate server. The chat features gracefully degrade to a "not available" message when Ollama is offline.

---

## 🤖 The 9 AI Agents

| Abbr | Name | Strategy | Horizons |
|------|------|----------|----------|
| MOM | Momentum Agent | Trend Following | day, swing |
| MRV | Mean Reversion | Contrarian / Stat Arb | scalping, day |
| PPO | RL PPO Agent | Policy Gradient | day, swing |
| DQN | DQN Agent | Deep Q-Learning | scalping, day |
| MAC | Macro Agent | Macro / Top-Down | swing, position |
| SEN | Sentiment Agent | NLP / News | day, swing |
| VOL | Volatility Agent | Vol Trading / VIX | scalping, day |
| REG | Market Regime | HMM + Clustering | swing, position |
| OPT | Portfolio Optimizer | MVO + RL | swing, position |

**Time horizons:** scalping (5m) · day (1h) · swing (1d) · position (1wk)

---

## 📁 Project Structure

```
ai-trading-lab/
├── backend/
│   ├── main.py                    # FastAPI app + static file serving
│   ├── requirements.txt
│   ├── static/                    # React build goes here (auto-generated)
│   ├── models_cache/              # scikit-learn .pkl cache
│   ├── database/__init__.py
│   └── services/
│       ├── agent_engine.py        # 9 agents, run cycles, ensemble vote
│       ├── market_data.py         # yfinance, indicators
│       ├── model_trainer.py       # sklearn training per agent/horizon
│       ├── training_queue.py      # async job queue + progress broadcast
│       ├── paper_trading.py       # simulated orders, slippage, fees
│       └── ollama_service.py      # chat, order parsing, page summaries
├── frontend/
│   ├── src/
│   │   ├── App.jsx                # Root — 7 pages
│   │   ├── components/
│   │   │   ├── shared/index.jsx   # Design tokens, Card, Badge, etc.
│   │   │   ├── layout/TopBar.jsx
│   │   │   ├── agents/AgentCard.jsx
│   │   │   ├── agents/AgentDetail.jsx
│   │   │   ├── trading/OrderModal.jsx
│   │   │   └── chat/
│   │   │       ├── OllamaChat.jsx
│   │   │       └── AiInsightsPanel.jsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.js
│   │   │   └── useAgents.js
│   │   ├── lib/
│   │   │   ├── api.js             # All API calls
│   │   │   └── fallback.js        # Demo data (works without backend)
│   │   └── pages/
│   │       └── EcosystemPage.jsx
│   ├── vite.config.js
│   └── package.json
├── supabase/migrations/
│   ├── 001_init.sql
│   └── 002_model_versions.sql
├── render.yaml                    # Single-service Render Blueprint
├── .env.example
└── .github/workflows/ci.yml
```

---

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | `https://xxx.supabase.co` |
| `SUPABASE_KEY` | ✅ | Anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key (for storage) |
| `SECRET_KEY` | ✅ | Random 32-char string (auto-generated on Render) |
| `OLLAMA_BASE_URL` | Optional | Default: `http://localhost:11434` |
| `OLLAMA_MODEL` | Optional | Default: `llama3` |
| `ALPHA_VANTAGE_KEY` | Optional | Extra market data |
| `NEWS_API_KEY` | Optional | News sentiment for SEN agent |
| `INITIAL_CAPITAL` | Optional | Default: `100000` |
