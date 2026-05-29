# 🔑 API Keys & Services — Complete Guide

## Required vs Optional

| Service | Required? | Free? | Where to get |
|---------|-----------|-------|--------------|
| **Supabase** | ✅ Required | ✅ Free tier | supabase.com |
| **yfinance** | ✅ Auto-used | ✅ No key | Built-in (Yahoo Finance) |
| **Ollama** | ✅ For chat | ✅ Free (local) | ollama.ai |
| Alpha Vantage | Optional | ✅ Free key | alphavantage.co |
| Polygon.io | Optional | ✅ Free key | polygon.io |
| NewsAPI | Optional | ✅ Free key | newsapi.org |

---

## 1. 🗄️ Supabase (Required)

**Purpose:** Database, auth, real-time subscriptions

**Get your keys:**
1. Go to [supabase.com](https://supabase.com) → Sign up → New project
2. Settings → API → copy:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_KEY` / `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` *(backend only, never expose to frontend)*

```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
```

---

## 2. 🤖 Ollama (Required for AI Chat)

**Purpose:** Local LLM for:
- Parsing natural-language trade orders ("Buy 10 AAPL for swing trade")
- Agent AI commentary and analysis
- General trading chat assistant

**Setup (takes ~2 min):**
```bash
# 1. Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh    # Linux/Mac
# Windows: download from https://ollama.ai/download

# 2. Pull a model (choose one):
ollama pull llama3          # Best quality (~4.7GB)
ollama pull mistral         # Faster (~4.1GB)
ollama pull phi3            # Smallest (~2.3GB, good for low RAM)
ollama pull qwen2           # Multilingual option

# 3. Start Ollama server
ollama serve                # Runs on http://localhost:11434
```

**For Render deployment** (Ollama needs to run on the same server or a separate VPS):
- Option A: Add Ollama to your own VPS, set `OLLAMA_BASE_URL=https://your-ollama.yourdomain.com`
- Option B: Use a hosted Ollama service (e.g., [openrouter.ai](https://openrouter.ai) with compatible API)

```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

---

## 3. 📊 Market Data — yfinance (No Key Needed!)

**Purpose:** Real OHLCV price data for all agent ML models

yfinance is **automatically used** — no API key required.

Supported assets: Stocks (AAPL, MSFT, NVDA...), ETFs (SPY, QQQ, GLD...), Crypto (BTC-USD, ETH-USD...), Indices (^GSPC, ^NDX...)

```
YAHOO_FINANCE_ENABLED=true   # (default, always on)
```

---

## 4. 📈 Alpha Vantage (Optional — Extra Data Source)

**Purpose:** Backup real-time data, intraday bars

**Get free key:**
1. Go to [alphavantage.co/support/#api-key](https://www.alphavantage.co/support/#api-key)
2. Fill form → instant free key (500 requests/day)

```
ALPHA_VANTAGE_KEY=YOUR_KEY_HERE
```

---

## 5. 🔷 Polygon.io (Optional — Premium Data)

**Purpose:** Real-time tick data, options data

**Get free key:**
1. Go to [polygon.io/dashboard/signup](https://polygon.io/dashboard/signup)
2. Free tier: 5 API calls/minute, delayed data

```
POLYGON_KEY=YOUR_KEY_HERE
```

---

## 6. 📰 NewsAPI (Optional — Sentiment Agent)

**Purpose:** Real news headlines for the Sentiment Agent (SEN)

**Get free key:**
1. Go to [newsapi.org/register](https://newsapi.org/register)
2. Free tier: 100 requests/day, 1 month historical

```
NEWS_API_KEY=YOUR_KEY_HERE
```

---

## Summary: What you MUST set to use the app

```bash
# Minimum required to run locally:
SUPABASE_URL=...
SUPABASE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
# That's it! yfinance works with no key, Ollama runs locally

# For full AI chat experience:
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# Optional enhancements:
ALPHA_VANTAGE_KEY=...    # better data fallback
NEWS_API_KEY=...         # real sentiment for SEN agent
POLYGON_KEY=...          # high-frequency data
```

---

## 🚀 Quick Start Checklist

- [ ] Create Supabase project → copy 3 keys
- [ ] Run `supabase/migrations/001_init.sql` in Supabase SQL Editor  
- [ ] Install Ollama + pull `llama3` model
- [ ] Copy `.env.example` to `.env`, fill in keys
- [ ] Run backend: `cd backend && uvicorn main:app --reload`
- [ ] Run frontend: `cd frontend && npm run dev`
- [ ] Open [http://localhost:5173](http://localhost:5173)

**Optional (better data):**
- [ ] Register at alphavantage.co → add `ALPHA_VANTAGE_KEY`
- [ ] Register at newsapi.org → add `NEWS_API_KEY`
