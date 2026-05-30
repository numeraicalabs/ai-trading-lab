"""
AI Trading Agents Lab — FastAPI v4
Single-service: FastAPI serves both the REST/WS API and the React SPA.
  /api/*   → REST endpoints
  /ws/live → WebSocket
  /*       → React index.html  (SPA routing)
"""
import asyncio, json, os, random, logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"

# ── Settings ──────────────────────────────────────────────────────────────────
class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_service_role_key: str = ""
    secret_key: str = "dev-secret"
    allowed_origins: str = "*"
    environment: str = "development"
    initial_capital: float = 100000.0
    transaction_fee_pct: float = 0.001
    slippage_pct: float = 0.0005
    simulation_tick_seconds: int = 8
    agents_auto_start: bool = True
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3"
    alpha_vantage_key: str = ""
    news_api_key: str = ""
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()

# ── Import services ────────────────────────────────────────────────────────────
from services.agent_engine   import (get_all_agents, get_agent, run_agent_cycle,
                                     ensemble_vote, set_agent_horizon,
                                     recommend_agents_for_horizon,
                                     _agent_state, AGENT_CATALOGUE)
from services.market_data    import get_ohlcv, add_indicators, get_live_quote, get_news_sentiment
from services.model_trainer  import train_agent_model, get_model_info, predict
from services.training_queue import (enqueue, list_jobs, get_job, queue_size,
                                     set_broadcast, worker_loop)
from services.ollama_service import (is_available as ollama_ok, chat as ollama_chat,
                                     parse_order_from_text, list_models,
                                     agent_commentary, summarize_page)
from services.paper_trading  import execute_order, get_balance, get_positions

# ── Sim state ─────────────────────────────────────────────────────────────────
BASE_PRICES = {
    "SPY": 480.20, "QQQ": 432.10, "AAPL": 189.50, "MSFT": 415.30,
    "NVDA": 840.50, "TSLA": 248.60, "META": 512.40, "AMZN": 185.70,
    "GLD": 184.30, "TLT": 96.20, "BTC-USD": 68200.0, "ETH-USD": 3800.0, "VIX": 14.10,
}
_prices    = dict(BASE_PRICES)
_trades    = []
_signals   = []
_portfolio = {
    "equity": 100000.0, "cash": 36000.0, "invested": 64000.0,
    "total_return": 27.4, "daily_pnl": 1240.5,
    "sharpe": 1.87, "sortino": 2.31, "max_drawdown": -8.2,
    "volatility": 12.4, "alpha": 9.3, "win_rate": 62.0,
    "profit_factor": 1.91, "exposure_pct": 64.0, "active_agents": 7,
}

# ── WebSocket manager ──────────────────────────────────────────────────────────
class WSManager:
    def __init__(self): self.active = []
    async def connect(self, ws: WebSocket):
        await ws.accept(); self.active.append(ws)
    def disconnect(self, ws: WebSocket):
        if ws in self.active: self.active.remove(ws)
    async def broadcast(self, data: dict):
        msg = json.dumps(data, default=str); dead = []
        for ws in self.active:
            try: await ws.send_text(msg)
            except: dead.append(ws)
        for ws in dead: self.disconnect(ws)

manager = WSManager()

# ── Background tasks ───────────────────────────────────────────────────────────
def _tick():
    for sym in list(_prices):
        v = 0.004 if ("BTC" in sym or "ETH" in sym) else 0.001
        _prices[sym] = round(_prices[sym] * (1 + random.gauss(0, v)), 4)
    for abbr, agent in _agent_state.items():
        if agent["state"] == "Live":
            d = random.gauss(0.0005, 0.002)
            agent["equity"]  = round(agent["equity"] * (1 + d), 4)
            agent["perf"]    = round((agent["equity"] - 100) / 100 * 100, 2)
            agent["reward"]  = round(agent.get("reward", 300) + random.gauss(0.5, 2), 2)
            if random.random() < 0.025:
                sym   = random.choice(agent.get("primary_assets", ["SPY"]))
                side  = random.choice(["BUY", "SELL"])
                price = _prices.get(sym, 100)
                pnl   = round(random.gauss(0.3, 1.5), 2)
                t = {"id": f"{abbr}-{random.randint(1000,9999)}",
                     "agent_abbr": abbr, "agent_name": agent["name"],
                     "symbol": sym, "side": side,
                     "price": round(price, 2), "pnl": pnl,
                     "ts": datetime.now(timezone.utc).isoformat(),
                     "status": "filled", "source": "auto"}
                _trades.insert(0, t); _trades[:] = _trades[:300]
                agent["last_trade"] = f"{side} {sym} @ {round(price, 2)}"
                agent["trades_count"] = agent.get("trades_count", 0) + 1
    d = random.gauss(0.0003, 0.001)
    _portfolio["equity"]       = round(_portfolio["equity"] * (1 + d), 2)
    _portfolio["total_return"] = round((_portfolio["equity"] - settings.initial_capital) / settings.initial_capital * 100, 2)
    _portfolio["daily_pnl"]    = round(_portfolio["equity"] * d, 2)

async def sim_loop():
    while True:
        await asyncio.sleep(settings.simulation_tick_seconds)
        _tick()
        await manager.broadcast({
            "type": "tick",
            "prices": _prices,
            "portfolio": _portfolio,
            "agents": {
                a: {"perf": s.get("perf", 0), "equity": s.get("equity", 100),
                    "reward": s.get("reward", 0), "confidence": round(s.get("confidence", 60), 1),
                    "last_trade": s.get("last_trade", ""), "trades_count": s.get("trades_count", 0),
                    "state": s["state"]}
                for a, s in _agent_state.items()
            },
            "latest_trade": _trades[0] if _trades else None,
        })

async def agent_bg():
    keys = list(AGENT_CATALOGUE.keys()); idx = 0
    while True:
        await asyncio.sleep(300)
        abbr = keys[idx % len(keys)]; idx += 1
        try:
            sym = AGENT_CATALOGUE[abbr]["primary_assets"][0]
            h   = _agent_state[abbr].get("horizon", "swing")
            sig = await run_agent_cycle(abbr, sym, h)
            _signals.insert(0, sig); _signals[:] = _signals[:100]
            await manager.broadcast({"type": "signal", "signal": sig})
        except Exception as e:
            logger.warning(f"BG [{abbr}]: {e}")

@asynccontextmanager
async def lifespan(app):
    set_broadcast(manager.broadcast)
    tasks = [
        asyncio.create_task(sim_loop()),
        asyncio.create_task(agent_bg()),
        asyncio.create_task(worker_loop()),
    ]
    yield
    for t in tasks: t.cancel()

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="AI Trading Lab", version="4.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── Pydantic schemas ───────────────────────────────────────────────────────────
class TradeReq(BaseModel):
    symbol: str = "SPY"; side: str = "BUY"; quantity: float = 1.0
    agent_abbr: str = "MOM"; order_type: str = "MARKET"
    limit_price: Optional[float] = None; horizon: str = "swing"
    confidence: float = 0.7; reason: str = ""

class ChatReq(BaseModel):
    message: str; conversation_history: list = []

class TrainReq(BaseModel):
    symbol: str = "SPY"; horizon: str = "swing"; force_retrain: bool = False

class HorizonReq(BaseModel):
    horizon: str

class SummarizeReq(BaseModel):
    page: str; data: dict = {}; question: str = ""

class BulkReq(BaseModel):
    horizon: str = "swing"; force_retrain: bool = False; agents: list = []

# ══════════════════════════════════════════════════════════════════════════════
#  API ROUTES  (must be defined BEFORE static files mount)
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {"status": "ok", "version": "4.0.0",
            "agents": len(_agent_state), "queue": queue_size()}

# ── Prices / Portfolio ─────────────────────────────────────────────────────────
@app.get("/api/prices")
def get_prices(): return _prices

@app.get("/api/quote/{symbol}")
async def quote(symbol: str):
    loop = asyncio.get_event_loop()
    q = await loop.run_in_executor(None, get_live_quote, symbol.upper())
    if q["price"] > 0: _prices[symbol.upper()] = q["price"]
    return q

@app.get("/api/portfolio")
def get_portfolio(): return _portfolio

@app.get("/api/watchlist")
def get_watchlist():
    return [{"symbol": s, "price": round(_prices.get(s, p), 2),
             "change_pct": round(random.gauss(0.1, 0.8), 2)}
            for s, p in list(BASE_PRICES.items())[:12]]

# ── Agents ─────────────────────────────────────────────────────────────────────
@app.get("/api/agents")
def agents_list(): return get_all_agents()

@app.get("/api/agents/{abbr}")
def agent_detail(abbr: str):
    a = get_agent(abbr.upper())
    if not a: raise HTTPException(404, "Agent not found")
    sym = a.get("primary_assets", ["SPY"])[0]
    h   = a.get("horizon", "swing")
    return {**a, "model_info": get_model_info(abbr.upper(), sym, h)}

@app.post("/api/agents/{abbr}/horizon")
def set_horizon(abbr: str, req: HorizonReq):
    if not set_agent_horizon(abbr.upper(), req.horizon):
        raise HTTPException(400, "Invalid horizon")
    return {"abbr": abbr.upper(), "horizon": req.horizon}

@app.post("/api/agents/{abbr}/train")
async def train_agent(abbr: str, req: TrainReq):
    job = await enqueue(abbr.upper(), req.symbol.upper(), req.horizon, req.force_retrain)
    return job.to_dict()

@app.post("/api/agents/{abbr}/run")
async def run_agent(abbr: str, req: TrainReq):
    sig = await run_agent_cycle(abbr.upper(), req.symbol.upper(), req.horizon, req.force_retrain)
    _signals.insert(0, sig); _signals[:] = _signals[:100]
    return sig

@app.post("/api/agents/{abbr}/commentary")
async def commentary(abbr: str):
    a = get_agent(abbr.upper())
    if not a: raise HTTPException(404)
    text = await agent_commentary(a)
    return {"abbr": abbr.upper(), "commentary": text}

@app.get("/api/agents/{abbr}/model")
def agent_model(abbr: str):
    a = get_agent(abbr.upper())
    if not a: raise HTTPException(404)
    return get_model_info(abbr.upper(),
                          a.get("primary_assets", ["SPY"])[0],
                          a.get("horizon", "swing"))

# ── Ecosystem ──────────────────────────────────────────────────────────────────
@app.post("/api/ecosystem/train-all")
async def train_all(req: BulkReq):
    targets = req.agents if req.agents else list(AGENT_CATALOGUE.keys())
    jobs = []
    for abbr in targets:
        cfg = AGENT_CATALOGUE.get(abbr, {})
        sym = cfg.get("primary_assets", ["SPY"])[0]
        h   = req.horizon if req.horizon in cfg.get("best_horizons", ["swing"]) else cfg.get("best_horizons", ["swing"])[0]
        job = await enqueue(abbr, sym, h, req.force_retrain)
        jobs.append(job.to_dict())
    return {"queued": len(jobs), "jobs": jobs}

@app.get("/api/ecosystem/status")
async def ecosystem_status():
    result = []
    for abbr, state in _agent_state.items():
        mi = get_model_info(abbr,
                            state.get("primary_assets", ["SPY"])[0],
                            state.get("horizon", "swing"))
        result.append({
            "abbr": abbr, "name": state["name"],
            "state": state["state"], "color": state["color"], "icon": state["icon"],
            "accuracy": state.get("accuracy", 0),
            "progress": state.get("progress", 0),
            "model_version": state.get("model_version", 0),
            "latest_acc": state.get("accuracy", 0),
            "improvement": 0, "improved": False, "versions_count": 1,
            "horizon": state.get("horizon", "swing"),
        })
    return {
        "agents": result,
        "queue_size": queue_size(),
        "recent_jobs": list_jobs(10),
        "total_models": len([s for s in result if s["model_version"] > 0]),
    }

# ── Training queue ─────────────────────────────────────────────────────────────
@app.get("/api/training/jobs")
def training_jobs(): return list_jobs(40)

@app.get("/api/training/jobs/{job_id}")
def training_job(job_id: str):
    j = get_job(job_id)
    if not j: raise HTTPException(404)
    return j.to_dict()

# ── Trades ─────────────────────────────────────────────────────────────────────
@app.get("/api/trades")
def get_trades(agent: Optional[str] = None, limit: int = 60):
    t = _trades
    if agent: t = [x for x in t if x.get("agent_abbr", "").upper() == agent.upper()]
    return t[:limit]

@app.post("/api/trades/execute")
async def execute_trade(req: TradeReq):
    sym  = req.symbol.upper()
    loop = asyncio.get_event_loop()
    q    = await loop.run_in_executor(None, get_live_quote, sym)
    price = q["price"] if q["price"] > 0 else _prices.get(sym, 100.0)
    try:
        trade = execute_order(req.agent_abbr.upper(), sym, req.side.upper(),
                              req.quantity, price, req.reason, req.confidence)
    except ValueError as e:
        raise HTTPException(400, str(e))
    trade["source"]  = "manual"
    trade["horizon"] = req.horizon
    _trades.insert(0, trade); _trades[:] = _trades[:300]
    if req.agent_abbr.upper() in _agent_state:
        _agent_state[req.agent_abbr.upper()]["last_trade"] = f"{req.side.upper()} {sym} @ {price:.2f}"
        _agent_state[req.agent_abbr.upper()]["trades_count"] = \
            _agent_state[req.agent_abbr.upper()].get("trades_count", 0) + 1
    await manager.broadcast({"type": "trade", "trade": trade})
    return trade

# ── Signals ────────────────────────────────────────────────────────────────────
@app.get("/api/signals")
def get_signals(limit: int = 20): return _signals[:limit]

@app.get("/api/signals/ensemble")
def ensemble():
    latest = {s["agent_abbr"]: s for s in _signals if "agent_abbr" in s}
    if not latest:
        return {"action": "HOLD", "confidence": 0.5, "note": "no signals yet"}
    return ensemble_vote(latest)

# ── Market data ────────────────────────────────────────────────────────────────
@app.get("/api/market/ohlcv/{symbol}")
async def market_ohlcv(symbol: str, horizon: str = "swing"):
    loop = asyncio.get_event_loop()
    df = await loop.run_in_executor(None, get_ohlcv, symbol.upper(), horizon)
    if df is None: raise HTTPException(404, "No data")
    dfi = await loop.run_in_executor(None, add_indicators, df)
    last = dfi.tail(80).reset_index()
    last.columns = [str(c) for c in last.columns]
    last["datetime"] = last["datetime"].astype(str)
    return {"symbol": symbol.upper(), "horizon": horizon,
            "bars": len(last), "data": last.to_dict("records")}

@app.get("/api/market/news/{symbol}")
async def market_news(symbol: str):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, get_news_sentiment, symbol.upper())

# ── Analytics ──────────────────────────────────────────────────────────────────
@app.get("/api/analytics/risk")
def risk():
    return {"var_95": -2.4, "cvar_95": -3.8, "max_drawdown": -8.2,
            "sharpe": 1.87, "sortino": 2.31, "calmar": 2.24,
            "omega": 1.64, "beta": 0.72, "volatility_ann": 12.4}

@app.get("/api/analytics/equity-history")
def equity_history(points: int = 80):
    v = 100.0; out = []
    for i in range(points):
        v = v * (1 + random.gauss(0.003, 0.015))
        out.append({"i": i, "portfolio": round(v, 2),
                    "sp500":   round(100 + i * 0.18, 2),
                    "buyhold": round(100 + i * 0.12, 2)})
    return out

@app.get("/api/analytics/scenario")
def scenario():
    return [
        {"scenario": "2020 COVID Crash",  "impact": -18.4},
        {"scenario": "2022 Rate Hike",    "impact": -9.2},
        {"scenario": "2023 AI Bull Run",  "impact": 32.1},
        {"scenario": "Flash Crash",       "impact": -6.8},
        {"scenario": "High Vol VIX>40",   "impact": -4.1},
        {"scenario": "Bull Market +20%",  "impact": 24.4},
    ]

# ── Horizons ───────────────────────────────────────────────────────────────────
@app.get("/api/horizons/recommend")
def horizons(horizon: str = "swing"):
    return {"horizon": horizon,
            "recommended_agents": recommend_agents_for_horizon(horizon)}

# ── Ollama ─────────────────────────────────────────────────────────────────────
@app.get("/api/ollama/status")
async def ollama_status():
    av = await ollama_ok(); models = await list_models() if av else []
    return {"available": av, "model": settings.ollama_model,
            "available_models": models}

@app.post("/api/chat")
async def chat_ep(req: ChatReq):
    agents_ctx = [{"abbr": a["abbr"], "perf": a.get("perf", 0), "state": a["state"]}
                  for a in get_all_agents()]
    return await ollama_chat(req.message, req.conversation_history,
                              _portfolio, agents_ctx)

@app.post("/api/chat/parse-order")
async def parse_order(req: ChatReq):
    return await parse_order_from_text(req.message,
                                       {"prices": _prices, "portfolio": _portfolio})

@app.post("/api/summarize")
async def summarize_ep(req: SummarizeReq):
    parts = []
    if req.page == "dashboard":
        parts.append(f"Portfolio equity=${_portfolio.get('equity',0):,.0f}, "
                     f"return={_portfolio.get('total_return',0):.1f}%, "
                     f"sharpe={_portfolio.get('sharpe',0):.2f}")
    elif req.page == "agents":
        top = sorted(get_all_agents(), key=lambda x: x.get("perf", 0), reverse=True)[:3]
        parts.append("Agents: " + ", ".join(
            f"{a['abbr']}={a.get('perf',0):.1f}%" for a in get_all_agents()))
    elif req.page == "ecosystem":
        parts.append(f"Queue={queue_size()} jobs. " +
                     ", ".join(f"{a}:acc={s.get('accuracy',0):.1f}%"
                               for a, s in list(_agent_state.items())[:5]))
    elif req.page == "analytics":
        parts.append("VaR=-2.4%, CVaR=-3.8%, Sharpe=1.87, Sortino=2.31, MaxDD=-8.2%")
    elif req.page == "trades":
        parts.append(f"{len(_trades)} trades. " +
                     (_trades[0].get("symbol", "—") if _trades else "none"))
    import json as _json
    ctx = "\n".join(parts)
    if req.data: ctx += "\n" + _json.dumps(req.data, default=str)[:300]
    text = await summarize_page(req.page, ctx, req.question)
    return {"page": req.page, "summary": text, "model": settings.ollama_model}

# ── WebSocket ──────────────────────────────────────────────────────────────────
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await manager.connect(ws)
    await ws.send_text(json.dumps({
        "type": "snapshot",
        "prices": _prices,
        "portfolio": _portfolio,
        "agents": _agent_state,
        "trades": _trades[:20],
        "jobs": list_jobs(10),
    }, default=str))
    try:
        while True:
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        manager.disconnect(ws)

# ══════════════════════════════════════════════════════════════════════════════
#  STATIC FILES + SPA FALLBACK  (must come AFTER all API routes)
# ══════════════════════════════════════════════════════════════════════════════

# Serve React build assets (JS, CSS, images)
_assets_dir = STATIC_DIR / "assets"
if _assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

# SPA catch-all: anything that isn't /api/* or /ws/* serves index.html
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    index = STATIC_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index), media_type="text/html")
    # Development hint when frontend hasn't been built yet
    return {
        "message": "React frontend not found.",
        "hint": "Run: cd frontend && npm install && npm run build",
        "api_docs": "/docs",
        "health": "/health",
    }
