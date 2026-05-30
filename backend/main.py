"""
AI Trading Lab — FastAPI v5
Single service: same process serves the REST API, WebSocket, and the React SPA.
  /health          → health check
  /api/*           → REST endpoints
  /ws/live         → WebSocket
  /docs            → Swagger UI
  /*               → React index.html (SPA catch-all)
"""
import asyncio, json, os, random, logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
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
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger(__name__)

STATIC = Path(__file__).parent / "static"   # React build output

# ── Settings ──────────────────────────────────────────────────────────────────
class Settings(BaseSettings):
    supabase_url:             str   = ""
    supabase_key:             str   = ""
    supabase_service_role_key:str   = ""
    secret_key:               str   = "dev"
    environment:              str   = "development"
    allowed_origins:          str   = "*"
    initial_capital:          float = 100_000.0
    transaction_fee_pct:      float = 0.001
    slippage_pct:             float = 0.0005
    simulation_tick_seconds:  int   = 8
    agents_auto_start:        bool  = True
    ollama_base_url:          str   = "http://localhost:11434"
    ollama_model:             str   = "llama3"
    alpha_vantage_key:        str   = ""
    news_api_key:             str   = ""
    class Config:
        env_file = ".env"
        extra    = "ignore"

settings = Settings()

# ── Service imports ───────────────────────────────────────────────────────────
from services.agents       import (CATALOGUE, AGENT_STATE, get_all, get,
                                   set_horizon, recommended_for, run_cycle, ensemble_vote)
from services.market       import get_ohlcv, add_indicators, get_live_quote, get_news_sentiment
from services.trainer      import train, get_meta
from services.trainer_queue import (enqueue, list_jobs, get_job, queue_size,
                                    set_broadcast, worker_loop)
from services.paper        import execute as paper_execute
from services.ollama       import (status as ollama_status, chat as ollama_chat,
                                   parse_order, commentary as ollama_commentary,
                                   summarize as ollama_summarize)

# ── Simulation state ──────────────────────────────────────────────────────────
BASE_PRICES = {
    "SPY":480.20,"QQQ":432.10,"AAPL":189.50,"MSFT":415.30,
    "NVDA":840.50,"TSLA":248.60,"META":512.40,"AMZN":185.70,
    "GLD":184.30,"TLT":96.20,"BTC-USD":68200.0,"ETH-USD":3800.0,"VIX":14.10,
}
prices    = dict(BASE_PRICES)
trades:   list = []
signals:  list = []
portfolio = {
    "equity":100000.0,"cash":36000.0,"invested":64000.0,
    "total_return":27.4,"daily_pnl":1240.5,
    "sharpe":1.87,"sortino":2.31,"max_drawdown":-8.2,
    "volatility":12.4,"alpha":9.3,"win_rate":62.0,
    "profit_factor":1.91,"exposure_pct":64.0,"active_agents":7,
}

# ── WebSocket manager ─────────────────────────────────────────────────────────
class WSManager:
    def __init__(self): self.sockets: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept(); self.sockets.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.sockets: self.sockets.remove(ws)

    async def broadcast(self, data: dict):
        msg = json.dumps(data, default=str)
        dead = []
        for ws in self.sockets:
            try:   await ws.send_text(msg)
            except: dead.append(ws)
        for ws in dead: self.disconnect(ws)

ws_manager = WSManager()

# ── Background simulation ─────────────────────────────────────────────────────
def _tick_prices():
    for sym in list(prices):
        vol = 0.004 if ("BTC" in sym or "ETH" in sym) else 0.001
        prices[sym] = round(prices[sym] * (1 + random.gauss(0, vol)), 4)

def _tick_agents():
    for abbr, agent in AGENT_STATE.items():
        if agent["state"] != "Live": continue
        d = random.gauss(0.0005, 0.002)
        agent["equity"] = round(agent["equity"] * (1 + d), 4)
        agent["perf"]   = round((agent["equity"] - 100) / 100 * 100, 2)
        agent["reward"] = round(agent.get("reward", 300) + random.gauss(0.5, 2), 2)
        if random.random() < 0.025:
            sym   = random.choice(agent.get("assets", ["SPY"]))
            side  = random.choice(["BUY", "SELL"])
            price = prices.get(sym, 100)
            pnl   = round(random.gauss(0.3, 1.5), 2)
            t = {"id": f"{abbr}-{random.randint(1000,9999)}",
                 "agent_abbr": abbr, "agent_name": agent["name"],
                 "symbol": sym, "side": side,
                 "price": round(price, 2), "pnl": pnl,
                 "ts": datetime.now(timezone.utc).isoformat(),
                 "status": "filled", "source": "auto"}
            trades.insert(0, t); trades[:] = trades[:300]
            agent["last_trade"] = f"{side} {sym} @ {round(price, 2)}"
            agent["trades_count"] = agent.get("trades_count", 0) + 1

def _tick_portfolio():
    d = random.gauss(0.0003, 0.001)
    portfolio["equity"]       = round(portfolio["equity"] * (1 + d), 2)
    portfolio["total_return"] = round((portfolio["equity"] - settings.initial_capital)
                                      / settings.initial_capital * 100, 2)
    portfolio["daily_pnl"]    = round(portfolio["equity"] * d, 2)

async def sim_loop():
    while True:
        await asyncio.sleep(settings.simulation_tick_seconds)
        _tick_prices(); _tick_agents(); _tick_portfolio()
        await ws_manager.broadcast({
            "type":         "tick",
            "prices":       prices,
            "portfolio":    portfolio,
            "latest_trade": trades[0] if trades else None,
            "agents": {
                a: {"perf": s.get("perf",0), "equity": s.get("equity",100),
                    "reward": s.get("reward",0), "confidence": round(s.get("confidence",60),1),
                    "last_trade": s.get("last_trade",""), "trades_count": s.get("trades_count",0),
                    "state": s["state"]}
                for a, s in AGENT_STATE.items()
            },
        })

async def agent_bg_loop():
    keys = list(CATALOGUE.keys()); idx = 0
    while True:
        await asyncio.sleep(300)
        abbr = keys[idx % len(keys)]; idx += 1
        try:
            sym = CATALOGUE[abbr]["assets"][0]
            h   = AGENT_STATE[abbr].get("horizon", "swing")
            sig = await run_cycle(abbr, sym, h)
            signals.insert(0, sig); signals[:] = signals[:100]
            await ws_manager.broadcast({"type": "signal", "signal": sig})
        except Exception as e:
            logger.warning(f"agent_bg [{abbr}]: {e}")

# ── App lifecycle ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    set_broadcast(ws_manager.broadcast)
    tasks = [asyncio.create_task(t) for t in [sim_loop(), agent_bg_loop(), worker_loop()]]
    yield
    for t in tasks: t.cancel()

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="AI Trading Lab", version="5.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── Schemas ───────────────────────────────────────────────────────────────────
class TradeIn(BaseModel):
    symbol:     str   = "SPY"; side:     str   = "BUY"; quantity: float = 1.0
    agent_abbr: str   = "MOM"; order_type:str  = "MARKET"
    limit_price:Optional[float] = None;  horizon: str = "swing"
    confidence: float = 0.7;   reason:  str   = ""

class ChatIn(BaseModel):
    message:             str;  conversation_history: list = []

class TrainIn(BaseModel):
    symbol:  str  = "SPY"; horizon:      str  = "swing"; force_retrain: bool = False

class HorizonIn(BaseModel):
    horizon: str

class SummarizeIn(BaseModel):
    page: str; data: dict = {}; question: str = ""

class BulkTrainIn(BaseModel):
    horizon: str = "swing"; force_retrain: bool = False; agents: list = []

# ══════════════════════════════════════════════════════════════════════════════
#  API ROUTES  ← must all be defined BEFORE the static file mount
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {"status": "ok", "version": "5.0.0",
            "agents": len(AGENT_STATE), "queue": queue_size()}

# ── Market ────────────────────────────────────────────────────────────────────
@app.get("/api/prices")
def api_prices(): return prices

@app.get("/api/quote/{symbol}")
async def api_quote(symbol: str):
    loop = asyncio.get_event_loop()
    q = await loop.run_in_executor(None, get_live_quote, symbol.upper())
    if q["price"] > 0: prices[symbol.upper()] = q["price"]
    return q

@app.get("/api/portfolio")
def api_portfolio(): return portfolio

@app.get("/api/watchlist")
def api_watchlist():
    return [{"symbol": s, "price": round(prices.get(s, p), 2),
             "change_pct": round(random.gauss(0.1, 0.8), 2)}
            for s, p in list(BASE_PRICES.items())[:12]]

@app.get("/api/market/ohlcv/{symbol}")
async def api_ohlcv(symbol: str, horizon: str = "swing"):
    loop = asyncio.get_event_loop()
    df   = await loop.run_in_executor(None, get_ohlcv, symbol.upper(), horizon)
    if df is None: raise HTTPException(404, "No data")
    dfi  = await loop.run_in_executor(None, add_indicators, df)
    last = dfi.tail(80).reset_index()
    last.columns = [str(c) for c in last.columns]
    last["datetime"] = last["datetime"].astype(str)
    return {"symbol": symbol.upper(), "horizon": horizon,
            "bars": len(last), "data": last.to_dict("records")}

@app.get("/api/market/news/{symbol}")
async def api_news(symbol: str):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, get_news_sentiment, symbol.upper())

# ── Agents ────────────────────────────────────────────────────────────────────
@app.get("/api/agents")
def api_agents(): return get_all()

@app.get("/api/agents/{abbr}")
def api_agent(abbr: str):
    a = get(abbr.upper())
    if not a: raise HTTPException(404, "Agent not found")
    sym = a.get("assets", ["SPY"])[0]
    return {**a, "model_info": get_meta(abbr.upper(), sym, a.get("horizon","swing"))}

@app.post("/api/agents/{abbr}/horizon")
def api_set_horizon(abbr: str, body: HorizonIn):
    if not set_horizon(abbr.upper(), body.horizon):
        raise HTTPException(400, "Invalid horizon")
    return {"abbr": abbr.upper(), "horizon": body.horizon}

@app.post("/api/agents/{abbr}/train")
async def api_train_agent(abbr: str, body: TrainIn):
    job = await enqueue(abbr.upper(), body.symbol.upper(), body.horizon, body.force_retrain)
    return job.to_dict()

@app.post("/api/agents/{abbr}/run")
async def api_run_agent(abbr: str, body: TrainIn):
    sig = await run_cycle(abbr.upper(), body.symbol.upper(), body.horizon, body.force_retrain)
    signals.insert(0, sig); signals[:] = signals[:100]
    return sig

@app.post("/api/agents/{abbr}/commentary")
async def api_commentary(abbr: str):
    a = get(abbr.upper())
    if not a: raise HTTPException(404)
    text = await ollama_commentary(a)
    return {"abbr": abbr.upper(), "commentary": text}

@app.get("/api/agents/{abbr}/model")
def api_agent_model(abbr: str):
    a = get(abbr.upper())
    if not a: raise HTTPException(404)
    return get_meta(abbr.upper(), a.get("assets",["SPY"])[0], a.get("horizon","swing"))

# ── Ecosystem ─────────────────────────────────────────────────────────────────
@app.post("/api/ecosystem/train-all")
async def api_train_all(body: BulkTrainIn):
    targets = body.agents or list(CATALOGUE.keys())
    jobs = []
    for abbr in targets:
        cfg = CATALOGUE.get(abbr, {})
        sym = cfg.get("assets", ["SPY"])[0]
        h   = body.horizon if body.horizon in cfg.get("best_horizons",["swing"]) \
              else cfg.get("best_horizons",["swing"])[0]
        jobs.append((await enqueue(abbr, sym, h, body.force_retrain)).to_dict())
    return {"queued": len(jobs), "jobs": jobs}

@app.get("/api/ecosystem/status")
def api_ecosystem_status():
    result = []
    for abbr, state in AGENT_STATE.items():
        mi = get_meta(abbr, state.get("assets",["SPY"])[0], state.get("horizon","swing"))
        result.append({
            "abbr": abbr, "name": state["name"], "state": state["state"],
            "color": state["color"], "icon": state["icon"],
            "accuracy": state.get("accuracy", 0),
            "progress": state.get("progress", 0),
            "model_version": state.get("model_version", 0),
            "latest_acc": state.get("accuracy", 0),
            "improvement": 0, "versions_count": 1,
            "horizon": state.get("horizon", "swing"),
        })
    return {"agents": result, "queue_size": queue_size(),
            "recent_jobs": list_jobs(10),
            "total_models": sum(1 for r in result if r["model_version"] > 0)}

# ── Training queue ────────────────────────────────────────────────────────────
@app.get("/api/training/jobs")
def api_jobs(): return list_jobs(40)

@app.get("/api/training/jobs/{job_id}")
def api_job(job_id: str):
    j = get_job(job_id)
    if not j: raise HTTPException(404)
    return j.to_dict()

# ── Trades ────────────────────────────────────────────────────────────────────
@app.get("/api/trades")
def api_trades(agent: Optional[str] = None, limit: int = 60):
    t = trades
    if agent: t = [x for x in t if x.get("agent_abbr","").upper() == agent.upper()]
    return t[:limit]

@app.post("/api/trades/execute")
async def api_execute(body: TradeIn):
    sym  = body.symbol.upper()
    loop = asyncio.get_event_loop()
    q    = await loop.run_in_executor(None, get_live_quote, sym)
    price = q["price"] if q["price"] > 0 else prices.get(sym, 100.0)
    try:
        trade = paper_execute(body.agent_abbr.upper(), sym, body.side.upper(),
                              body.quantity, price, body.reason, body.confidence)
    except ValueError as e:
        raise HTTPException(400, str(e))
    trade["source"]  = "manual"
    trade["horizon"] = body.horizon
    trades.insert(0, trade); trades[:] = trades[:300]
    a = AGENT_STATE.get(body.agent_abbr.upper())
    if a:
        a["last_trade"]   = f"{body.side.upper()} {sym} @ {price:.2f}"
        a["trades_count"] = a.get("trades_count", 0) + 1
    await ws_manager.broadcast({"type": "trade", "trade": trade})
    return trade

# ── Signals ───────────────────────────────────────────────────────────────────
@app.get("/api/signals")
def api_signals(limit: int = 20): return signals[:limit]

@app.get("/api/signals/ensemble")
def api_ensemble():
    latest = {s["agent_abbr"]: s for s in signals if "agent_abbr" in s}
    if not latest:
        return {"action": "HOLD", "confidence": 0.5, "note": "no signals yet"}
    return ensemble_vote(latest)

# ── Analytics ─────────────────────────────────────────────────────────────────
@app.get("/api/analytics/risk")
def api_risk():
    return {"var_95":-2.4,"cvar_95":-3.8,"max_drawdown":-8.2,
            "sharpe":1.87,"sortino":2.31,"calmar":2.24,"omega":1.64,"beta":0.72}

@app.get("/api/analytics/equity-history")
def api_equity(points: int = 80):
    v = 100.0; out = []
    for i in range(points):
        v = v * (1 + random.gauss(0.003, 0.015))
        out.append({"i": i, "portfolio": round(v,2),
                    "sp500": round(100+i*0.18,2), "buyhold": round(100+i*0.12,2)})
    return out

@app.get("/api/analytics/scenario")
def api_scenario():
    return [{"scenario":"2020 COVID Crash","impact":-18.4},{"scenario":"2022 Rate Hike","impact":-9.2},
            {"scenario":"2023 AI Bull","impact":32.1},{"scenario":"Flash Crash","impact":-6.8},
            {"scenario":"High Vol VIX>40","impact":-4.1},{"scenario":"Bull +20%","impact":24.4}]

@app.get("/api/horizons/recommend")
def api_horizons(horizon: str = "swing"):
    return {"horizon": horizon, "recommended_agents": recommended_for(horizon)}

# ── Ollama ────────────────────────────────────────────────────────────────────
@app.get("/api/ollama/status")
async def api_ollama_status():
    return await ollama_status()

@app.post("/api/chat")
async def api_chat(body: ChatIn):
    agents_ctx = [{"abbr": a["abbr"], "perf": a.get("perf",0), "state": a["state"]}
                  for a in get_all()]
    return await ollama_chat(body.message, body.conversation_history, portfolio, agents_ctx)

@app.post("/api/chat/parse-order")
async def api_parse_order(body: ChatIn):
    return await parse_order(body.message, {"prices": prices, "portfolio": portfolio})

@app.post("/api/summarize")
async def api_summarize(body: SummarizeIn):
    parts = {
        "dashboard":  f"Equity=${portfolio.get('equity',0):,.0f}, return={portfolio.get('total_return',0):.1f}%",
        "agents":     "Agents: " + ", ".join(f"{a['abbr']}={a.get('perf',0):.1f}%" for a in get_all()),
        "ecosystem":  f"Queue={queue_size()} jobs. " + ", ".join(f"{a}:acc={s.get('accuracy',0):.1f}%" for a,s in list(AGENT_STATE.items())[:5]),
        "analytics":  "VaR=-2.4%, CVaR=-3.8%, Sharpe=1.87, Sortino=2.31",
        "trades":     f"{len(trades)} trades.",
    }
    ctx = parts.get(body.page, "") + (f"\n{json.dumps(body.data, default=str)[:300]}" if body.data else "")
    text = await ollama_summarize(body.page, ctx, body.question)
    return {"page": body.page, "summary": text, "model": settings.ollama_model}

# ── WebSocket ─────────────────────────────────────────────────────────────────
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws_manager.connect(ws)
    await ws.send_text(json.dumps({
        "type":      "snapshot",
        "prices":    prices,
        "portfolio": portfolio,
        "agents":    AGENT_STATE,
        "trades":    trades[:20],
        "jobs":      list_jobs(10),
    }, default=str))
    try:
        while True:
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)

# ══════════════════════════════════════════════════════════════════════════════
#  STATIC FILES + SPA CATCH-ALL  ← must come AFTER all /api routes
# ══════════════════════════════════════════════════════════════════════════════

# Serve /assets/* (JS, CSS bundles)
_assets = STATIC / "assets"
if _assets.exists():
    app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

# Catch-all: any path that isn't /api/* or /ws/* → React index.html
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    index = STATIC / "index.html"
    if index.exists():
        return FileResponse(str(index), media_type="text/html")
    # Dev hint when frontend hasn't been built yet
    return {
        "message": "Frontend not built yet.",
        "hint":    "Run: cd frontend && npm install && npm run build",
        "api":     "/docs",
        "health":  "/health",
    }
