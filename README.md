# ⚡ AI Trading Agents Lab

A full-stack paper trading simulation platform with 9 AI agents, real-time WebSockets, Supabase database, and one-click Render deployment.

## 🏗️ Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite + Recharts |
| Backend | Python 3.11 + FastAPI + WebSockets |
| Database | Supabase (PostgreSQL) |
| Hosting | Render (Web Service + Static Site) |
| Real-time | WebSockets + Supabase Realtime |

---

## 🚀 Quick Deploy (Render + Supabase)

### 1. Supabase Setup

1. Go to [supabase.com](https://supabase.com) → New Project
2. Copy your **Project URL** and **anon key** from Settings → API
3. Run the migration in Supabase SQL Editor:

```bash
# Paste contents of supabase/migrations/001_init.sql into Supabase SQL Editor
```

### 2. GitHub Setup

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USER/ai-trading-lab.git
git push -u origin main
```

### 3. Render Setup

1. Go to [render.com](https://render.com) → New → **Blueprint**
2. Connect your GitHub repo
3. Render reads `render.yaml` and creates both services automatically

Set these **Environment Variables** in Render dashboard:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=your-anon-key
SECRET_KEY=your-random-secret-32chars
ALLOWED_ORIGINS=https://your-frontend.onrender.com
```

---

## 🛠️ Local Development

### Prerequisites
- Python 3.11+
- Node.js 18+
- A Supabase project

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Copy and fill environment variables
cp ../.env.example .env

uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install

# Copy and fill environment variables
cp ../.env.example .env.local
# Set VITE_API_URL=http://localhost:8000
# Set VITE_SUPABASE_URL=...
# Set VITE_SUPABASE_ANON_KEY=...

npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## 📁 Project Structure

```
ai-trading-lab/
├── backend/
│   ├── main.py              # FastAPI app + WebSocket hub
│   ├── requirements.txt
│   ├── agents/
│   │   ├── base_agent.py    # Abstract agent class
│   │   ├── momentum.py
│   │   ├── mean_reversion.py
│   │   ├── rl_ppo.py
│   │   ├── dqn.py
│   │   ├── macro.py
│   │   ├── sentiment.py
│   │   ├── volatility.py
│   │   ├── regime.py
│   │   └── optimizer.py
│   ├── database/
│   │   └── supabase_client.py
│   ├── routers/
│   │   ├── agents.py
│   │   ├── portfolio.py
│   │   ├── trades.py
│   │   └── analytics.py
│   └── services/
│       ├── paper_trading.py
│       ├── market_data.py
│       └── simulation.py
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── components/
│   │   ├── hooks/
│   │   │   ├── useAgents.js
│   │   │   ├── useWebSocket.js
│   │   │   └── usePortfolio.js
│   │   ├── lib/
│   │   │   └── supabase.js
│   │   └── pages/
│   ├── package.json
│   └── vite.config.js
├── supabase/
│   └── migrations/
│       └── 001_init.sql
├── .github/
│   └── workflows/
│       └── ci.yml
├── render.yaml
├── .env.example
└── README.md
```

---

## 🤖 AI Agents

| Agent | Strategy | Status |
|-------|----------|--------|
| Momentum Agent | Trend Following | Live |
| Mean Reversion | Contrarian / Stat Arb | Live |
| RL PPO Agent | Policy Gradient RL | Training |
| DQN Agent | Deep Q-Learning | Backtest |
| Macro Agent | Top-Down / Factor | Live |
| Sentiment Agent | NLP / News | Live |
| Volatility Agent | VIX / Vol Trading | Live |
| Market Regime | HMM Detection | Training |
| Portfolio Optimizer | MVO + RL Allocation | Live |

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents` | List all agents |
| GET | `/api/agents/{id}` | Agent detail + metrics |
| GET | `/api/portfolio` | Portfolio summary |
| GET | `/api/trades` | Trade history |
| POST | `/api/trades/execute` | Execute paper trade |
| GET | `/api/analytics/correlation` | Correlation matrix |
| GET | `/api/analytics/risk` | Risk metrics |
| WS | `/ws/live` | Real-time price + signal stream |

---

## 📊 Features

- **Paper Trading Engine** — simulated order execution with slippage & fees
- **Real-time WebSocket** — live price feed, agent signals, portfolio updates
- **Supabase Integration** — persisted trades, agent states, equity history
- **9 AI Agents** — each with independent strategy, metrics, and learning curve
- **Multi-Agent Ensemble** — voting system, capital allocation
- **Advanced Analytics** — VaR, CVaR, Monte Carlo, Correlation Matrix
- **One-click Deploy** — Render Blueprint from `render.yaml`
