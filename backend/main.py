"""
AI Trading Lab — FastAPI v7
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
from services.agents       import (CATALOGUE, AGENT_STATE, AGENT_CONFIG,
                                   get_all, get, set_horizon, recommended_for,
                                   run_cycle, ensemble_vote, update_config,
                                   get_impulses, get_live_impulses, get_regime)
from services.market       import get_ohlcv, add_indicators, get_live_quote, get_news_sentiment
from services.trainer      import train, get_meta
from services.trainer_queue import (enqueue, list_jobs, get_job, queue_size,
                                    set_broadcast, worker_loop)
from services.paper        import execute as paper_execute
from services.trainer      import (train, get_meta, list_models, verify_models)
from services.backtest     import (run_backtest, run_multi_backtest,
                                    list_results, get_result)
from services.universe     import (get_universe, get_symbols, add_symbol,
                                    remove_symbol, list_sectors, symbols_for_agent,
                                    parse_uploaded_csv, get_custom_ohlcv,
                                    list_custom_uploads)
from services.scheduler    import (scheduler_loop, get_history, get_all_history,
                                    get_retrain_log, notify_regime_change,
                                    AUTO_RETRAIN_ENABLED, MIN_ACCURACY, SCHEDULER_INTERVAL)
from services.scout        import (run_screen, get_cached_screen, scout_loop, SCREEN_UNIVERSE)
from services.agent_pdf    import generate_agent_pdf, save_agent_pdf
from services.reports      import (generate_portfolio_report, generate_scout_report,
                                    generate_backtest_report, list_reports, get_report_html)
from services.db           import (health_check as db_health, get_client as db_client,
                                    save_trade as db_save_trade,
                                    save_model_version, load_recent_trades)
from services.market       import data_source_status
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
    # Load recent trades from Supabase on first run
    try:
        db_trades = load_recent_trades(100)
        if db_trades:
            for t in reversed(db_trades):
                trades.insert(0, {
                    "id":         str(t.get("id","")),
                    "agent_abbr": t.get("agent_abbr",""),
                    "symbol":     t.get("symbol",""),
                    "side":       t.get("side",""),
                    "price":      float(t.get("price",0)),
                    "pnl":        float(t.get("pnl",0)),
                    "horizon":    t.get("horizon",""),
                    "ts":         t.get("created_at",""),
                    "status":     t.get("status","filled"),
                    "source":     "db",
                })
            trades[:] = trades[:300]
            logger.info(f"Loaded {len(db_trades)} trades from Supabase")
    except Exception as e:
        logger.warning(f"Could not load trades from DB: {e}")

    while True:
        await asyncio.sleep(settings.simulation_tick_seconds)
        _tick_prices(); _tick_agents(); _tick_portfolio()
        live_imps = get_live_impulses()
        await ws_manager.broadcast({
            "type":         "tick",
            "prices":       prices,
            "portfolio":    portfolio,
            "latest_trade": trades[0] if trades else None,
            "regime":       get_regime(),
            "impulses":     list(live_imps.values())[-20:],
            "agents": {
                a: {"perf": s.get("perf",0), "equity": s.get("equity",100),
                    "reward": s.get("reward",0), "confidence": round(s.get("confidence",60),1),
                    "last_trade": s.get("last_trade",""), "trades_count": s.get("trades_count",0),
                    "state": s["state"], "accuracy": s.get("accuracy",0)}
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
            # Notify scheduler of regime changes
            if abbr == "REG" and sig.get("action") != "HOLD":
                notify_regime_change(get_regime().get("label","unknown"))
        except Exception as e:
            logger.warning(f"agent_bg [{abbr}]: {e}")

# ── App lifecycle ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    set_broadcast(ws_manager.broadcast)
    tasks = [asyncio.create_task(t) for t in [sim_loop(), agent_bg_loop(), worker_loop(), scheduler_loop(), scout_loop()]]
    yield
    for t in tasks: t.cancel()

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="AI Trading Lab", version="7.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── Schemas ───────────────────────────────────────────────────────────────────
class MemoIn(BaseModel):
    signal_source:   str   = ""        # e.g. "MOM + SEN consensus"
    market_context:  str   = ""        # e.g. "Bull regime, RSI=42"
    thesis:          str   = ""        # manual thesis text
    risk_level:      str   = "MEDIUM"  # LOW/MEDIUM/HIGH
    stop_loss_price: Optional[float] = None
    take_profit_price:Optional[float]= None
    tags:            list  = []        # e.g. ["momentum","breakout"]

class TradeIn(BaseModel):
    symbol:     str   = "SPY"; side:     str   = "BUY"; quantity: float = 1.0
    agent_abbr: str   = "MOM"; order_type:str  = "MARKET"
    limit_price:Optional[float] = None;  horizon: str = "swing"
    confidence: float = 0.7;   reason:  str   = ""
    memo:       MemoIn = MemoIn()

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

class AgentConfigIn(BaseModel):
    enabled:          Optional[bool]  = None
    aggressiveness:   Optional[float] = None
    signal_threshold: Optional[float] = None
    max_position_pct: Optional[float] = None
    stop_loss_pct:    Optional[float] = None
    take_profit_pct:  Optional[float] = None
    use_regime_gate:  Optional[bool]  = None
    weight:           Optional[float] = None

class BacktestIn(BaseModel):
    abbr:             str   = "MOM"
    symbol:           str   = "SPY"
    horizon:          str   = "swing"
    initial_capital:  float = 10000.0
    extra_symbols:    list  = []

class MultiBacktestIn(BaseModel):
    abbr:             str   = "MOM"
    symbols:          list  = ["SPY","QQQ","AAPL"]
    horizon:          str   = "swing"
    initial_capital:  float = 10000.0

class SymbolIn(BaseModel):
    symbol: str
    name:   str   = ""
    sector: str   = "Custom"
    type:   str   = "stock"

class CsvUploadIn(BaseModel):
    symbol:  str
    content: str   # raw CSV text

class TrainMultiIn(BaseModel):
    abbr:           str  = "MOM"
    symbols:        list = ["SPY","QQQ","AAPL"]
    horizon:        str  = "swing"
    force_retrain:  bool = False

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
    # Attach full memo
    trade["memo"] = {
        "signal_source":    body.memo.signal_source,
        "market_context":   body.memo.market_context,
        "thesis":           body.memo.thesis or body.reason,
        "risk_level":       body.memo.risk_level,
        "stop_loss_price":  body.memo.stop_loss_price,
        "take_profit_price":body.memo.take_profit_price,
        "tags":             body.memo.tags,
        "written_at":       __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }
    trades.insert(0, trade); trades[:] = trades[:300]
    a = AGENT_STATE.get(body.agent_abbr.upper())
    if a:
        a["last_trade"]   = f"{body.side.upper()} {sym} @ {price:.2f}"
        a["trades_count"] = a.get("trades_count", 0) + 1
    await ws_manager.broadcast({"type": "trade", "trade": trade})
    # Persist to Supabase (best-effort)
    try:
        await asyncio.get_event_loop().run_in_executor(None, db_save_trade, trade)
    except Exception:
        pass
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

# ── Impulses + Agent Config + Regime ─────────────────────────────────────────
@app.get("/api/impulses")
def api_impulses(limit: int = 50):
    return get_impulses(limit)

@app.get("/api/impulses/live")
def api_live_impulses():
    return {"impulses": get_live_impulses(), "regime": get_regime()}

@app.get("/api/agents/{abbr}/config")
def api_get_config(abbr: str):
    if abbr.upper() not in CATALOGUE: raise HTTPException(404)
    return AGENT_CONFIG.get(abbr.upper(), {})

@app.patch("/api/agents/{abbr}/config")
async def api_update_config(abbr: str, body: AgentConfigIn):
    if abbr.upper() not in CATALOGUE: raise HTTPException(404)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    cfg     = update_config(abbr.upper(), updates)
    if abbr.upper() in AGENT_STATE:
        AGENT_STATE[abbr.upper()]["config"] = cfg
    return cfg

@app.get("/api/regime")
def api_regime():
    return get_regime()

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

# ── Models registry ──────────────────────────────────────────────────────────
@app.get("/api/models")
def api_models():
    return list_models()

@app.get("/api/models/verify")
def api_verify(horizon: str = "swing"):
    abbrs = list(CATALOGUE.keys())
    return verify_models(abbrs, [horizon])

@app.get("/api/models/{abbr}/{symbol}/{horizon}")
def api_model_detail(abbr: str, symbol: str, horizon: str):
    m = get_meta(abbr.upper(), symbol.upper(), horizon)
    if not m.get("trained", False) and not m.get("cached", False):
        raise HTTPException(404, "Model not found")
    return m

# ── Backtest ──────────────────────────────────────────────────────────────────
@app.post("/api/backtest/run")
async def api_backtest(body: BacktestIn):
    loop   = asyncio.get_event_loop()
    df_raw = await loop.run_in_executor(None, get_ohlcv, body.symbol.upper(), body.horizon)
    if df_raw is None or df_raw.empty:
        raise HTTPException(400, f"No data for {body.symbol}/{body.horizon}")
    df = await loop.run_in_executor(None, add_indicators, df_raw)
    result = await loop.run_in_executor(
        None, run_backtest,
        body.abbr.upper(), body.symbol.upper(), body.horizon, df, body.initial_capital
    )
    return result

@app.post("/api/backtest/multi")
async def api_backtest_multi(body: MultiBacktestIn):
    result = await asyncio.get_event_loop().run_in_executor(
        None, run_multi_backtest,
        body.abbr.upper(), [s.upper() for s in body.symbols],
        body.horizon, body.initial_capital
    )
    return result

@app.get("/api/backtest/results")
def api_backtest_results():
    return list_results()

@app.get("/api/backtest/results/{abbr}/{symbol}/{horizon}")
def api_backtest_detail(abbr: str, symbol: str, horizon: str):
    r = get_result(abbr.upper(), symbol.upper(), horizon)
    if not r:
        raise HTTPException(404, "No backtest result found")
    return r

# ── Universe ──────────────────────────────────────────────────────────────────
@app.get("/api/universe")
def api_universe(sector: Optional[str] = None, type: Optional[str] = None):
    return {"symbols": get_symbols(sector, type),
            "sectors": list_sectors(),
            "total": len(get_universe())}

@app.post("/api/universe/symbols")
def api_add_symbol(body: SymbolIn):
    return add_symbol(body.symbol, body.name, body.sector, body.type)

@app.delete("/api/universe/symbols/{symbol}")
def api_remove_symbol(symbol: str):
    ok = remove_symbol(symbol.upper())
    if not ok:
        raise HTTPException(404, f"{symbol} not in universe")
    return {"removed": symbol.upper()}

@app.get("/api/universe/agent/{abbr}")
def api_agent_universe(abbr: str):
    return {"abbr": abbr.upper(), "symbols": symbols_for_agent(abbr.upper())}

# ── CSV upload + custom data ──────────────────────────────────────────────────
@app.post("/api/data/upload-csv")
async def api_upload_csv(body: CsvUploadIn):
    result = parse_uploaded_csv(body.content, body.symbol)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result

@app.get("/api/data/uploads")
def api_list_uploads():
    return list_custom_uploads()

# ── Multi-symbol training ─────────────────────────────────────────────────────
@app.post("/api/train/multi")
async def api_train_multi(body: TrainMultiIn):
    """Queue training jobs for one agent across multiple symbols."""
    jobs_queued = []
    for sym in body.symbols[:20]:   # cap at 20 to avoid queue flood
        job = await enqueue(body.abbr.upper(), sym.upper(),
                            body.horizon, body.force_retrain)
        jobs_queued.append(job.to_dict())
    return {"queued": len(jobs_queued), "jobs": jobs_queued}

# ── Training stats ────────────────────────────────────────────────────────────
@app.get("/api/training/stats")
def api_training_stats():
    models   = list_models()
    results  = list_results()
    return {
        "total_models":       len(models),
        "trained_models":     len([m for m in models if m.get("model_exists")]),
        "avg_oos_accuracy":   round(float(sum(m["accuracy_oos"] for m in models) / max(len(models),1)), 1),
        "avg_overfit_gap":    round(float(sum(m["overfit_gap"] for m in models) / max(len(models),1)), 1),
        "overfit_count":      sum(1 for m in models if m.get("overfit_flag")),
        "backtests_run":      len(results),
        "avg_backtest_sharpe":round(float(sum(r.get("sharpe",0) for r in results) / max(len(results),1)), 3),
        "positive_alpha_count":sum(1 for r in results if (r.get("alpha") or 0) > 0),
    }

# ── Scheduler ────────────────────────────────────────────────────────────────
@app.get("/api/scheduler/status")
def api_scheduler_status():
    return {
        "enabled":          AUTO_RETRAIN_ENABLED,
        "min_accuracy_pct": round(MIN_ACCURACY * 100, 1),
        "interval_min":     SCHEDULER_INTERVAL,
        "retrain_log":      get_retrain_log(20),
        "history_summary":  {
            abbr: {
                "entries":      len(hist),
                "latest_acc":   hist[0]["accuracy"] if hist else 0,
                "trend":        round(hist[0]["accuracy"] - hist[-1]["accuracy"], 2) if len(hist) >= 2 else 0,
            }
            for abbr, hist in get_all_history().items()
        }
    }

@app.get("/api/scheduler/history/{abbr}")
def api_agent_history(abbr: str, limit: int = 50):
    hist = get_history(abbr.upper(), limit)
    if not hist:
        return {"abbr": abbr.upper(), "entries": [], "message": "No training history yet"}
    return {
        "abbr":       abbr.upper(),
        "entries":    hist,
        "best_acc":   max(h["accuracy"] for h in hist),
        "latest_acc": hist[0]["accuracy"],
        "trend":      round(hist[0]["accuracy"] - hist[-1]["accuracy"], 2) if len(hist) >= 2 else 0,
        "total_runs": len(hist),
    }

@app.get("/api/scheduler/history")
def api_all_history():
    return get_all_history()

# ── SCOUT ─────────────────────────────────────────────────────────────────────
class ScoutIn(BaseModel):
    symbols:  list = []
    horizon:  str  = "swing"
    top_n:    int  = 10
    force:    bool = False

@app.post("/api/scout/screen")
async def api_scout_screen(body: ScoutIn):
    try:
        if not body.force:
            cached = get_cached_screen()
            if cached:
                return cached
        regime = get_regime().get("label", "unknown")
        result = await run_screen(
            symbols=body.symbols or None,
            horizon=body.horizon,
            top_n=body.top_n,
            regime=regime,
        )
        return result
    except Exception as e:
        logger.error(f"scout/screen error: {e}", exc_info=True)
        raise HTTPException(500, f"Scout screen error: {str(e)[:200]}")

@app.get("/api/scout/latest")
def api_scout_latest():
    try:
        cached = get_cached_screen()
        if not cached:
            return {"message": "No screen run yet — POST /api/scout/screen to start",
                    "status": "empty"}
        return cached
    except Exception as e:
        logger.error(f"scout/latest error: {e}")
        raise HTTPException(500, f"Scout error: {str(e)}")

@app.get("/api/scout/universe")
def api_scout_universe():
    return {"groups": SCREEN_UNIVERSE,
            "total": sum(len(v) for v in SCREEN_UNIVERSE.values())}

# ── Agent PDF ─────────────────────────────────────────────────────────────────
@app.get("/api/agents/{abbr}/pdf")
async def api_agent_pdf(abbr: str):
    """Generate and return a PDF presentation for an agent."""
    from fastapi.responses import Response
    abbr_up = abbr.upper()
    agent   = get(abbr_up)
    if not agent:
        raise HTTPException(404, f"Agent {abbr_up} not found")

    from services.trainer  import get_meta
    from services.backtest import get_result
    
    sym  = (agent.get("assets") or ["SPY"])[0]
    h    = agent.get("horizon", "swing")
    meta = get_meta(abbr_up, sym, h)
    bt   = get_result(abbr_up, sym, h)
    # Use in-memory trades filtered by agent
    agent_trades = [t for t in trades if t.get("agent_abbr") == abbr_up][:30]

    try:
        loop    = asyncio.get_event_loop()
        pdf_bytes = await loop.run_in_executor(
            None, generate_agent_pdf, agent, meta, bt, agent_trades
        )
        save_agent_pdf(abbr_up, pdf_bytes)
        filename = f"agent-{abbr_up.lower()}-profile.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        logger.error(f"PDF generation error [{abbr_up}]: {e}", exc_info=True)
        raise HTTPException(500, f"PDF error: {str(e)[:200]}")

# ── Opportunity Scanner ──────────────────────────────────────────────────────
@app.get("/api/network/opportunities")
async def api_opportunities():
    """Scan for multi-agent convergence opportunities in real-time."""
    from services.agents import AGENT_STATE, CATALOGUE, ensemble_vote, get_regime
    from services.market  import get_live_quote
    import statistics

    ops = []
    # Group latest signals by symbol
    by_symbol: dict = {}
    for abbr, state in AGENT_STATE.items():
        sig = state.get("last_signal", {})
        if not sig or not sig.get("symbol"): continue
        sym = sig["symbol"]
        by_symbol.setdefault(sym, []).append({
            "abbr":       abbr,
            "action":     sig.get("action","HOLD"),
            "confidence": sig.get("confidence", 0.5),
            "color":      CATALOGUE.get(abbr,{}).get("color","#3b82f6"),
            "accuracy":   state.get("accuracy", 50),
        })

    for sym, sigs in by_symbol.items():
        buys  = [s for s in sigs if s["action"] == "BUY"]
        sells = [s for s in sigs if s["action"] == "SELL"]
        if not buys and not sells: continue

        # Weighted confidence (by accuracy)
        def w_conf(lst):
            if not lst: return 0
            return sum(s["confidence"] * (s["accuracy"]/50) for s in lst) / len(lst)

        buy_score  = w_conf(buys)
        sell_score = w_conf(sells)
        direction  = "BUY" if buy_score > sell_score else "SELL"
        agreement  = len(buys) if direction=="BUY" else len(sells)
        total      = len(sigs)
        consensus  = agreement / max(total, 1)

        if consensus < 0.4: continue   # need ≥40% agreement

        regime     = get_regime().get("label","unknown")
        regime_ok  = (direction == "BUY"  and regime in ("bull","neutral","unknown")) or                      (direction == "SELL" and regime in ("bear","neutral","unknown"))

        ops.append({
            "symbol":       sym,
            "direction":    direction,
            "consensus":    round(consensus, 2),
            "agreement":    agreement,
            "total_agents": total,
            "score":        round((buy_score if direction=="BUY" else sell_score) * consensus, 3),
            "buy_agents":   [s["abbr"] for s in buys],
            "sell_agents":  [s["abbr"] for s in sells],
            "regime_aligned": regime_ok,
            "regime":       regime,
        })

    ops.sort(key=lambda x: -x["score"])
    return {"opportunities": ops[:15], "scanned": len(by_symbol), "ts": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()}

@app.get("/api/network/correlation")
async def api_correlation():
    """Agent return correlation matrix."""
    from services.agents import AGENT_STATE
    abbrs = list(AGENT_STATE.keys())
    # Simulated correlation from equity histories (use real in prod)
    import random, math
    random.seed(42)
    matrix = {}
    for a in abbrs:
        matrix[a] = {}
        for b in abbrs:
            if a == b:
                matrix[a][b] = 1.0
            elif b in matrix and a in matrix[b]:
                matrix[a][b] = matrix[b][a]
            else:
                # Strategy-based base correlation
                base = 0.3
                if AGENT_STATE[a].get("strategy") == AGENT_STATE[b].get("strategy"):
                    base = 0.7
                noise = random.uniform(-0.2, 0.2)
                matrix[a][b] = round(max(-1, min(1, base + noise)), 2)
    return {"matrix": matrix, "agents": abbrs}

@app.get("/api/network/flow")
async def api_network_flow():
    """Live impulse flow + active connections."""
    from services.agents import get_impulses, get_live_impulses, get_regime, AGENT_STATE
    impulses = get_impulses(30)
    live     = get_live_impulses()
    # Connection strength: how many impulses per pair in last 30
    strength = {}
    for imp in impulses:
        key = f"{imp['from']}-{imp['to']}"
        strength[key] = strength.get(key, 0) + imp.get("strength", 0.5)
    return {
        "impulses":        impulses,
        "live_impulses":   live,
        "connection_strength": strength,
        "regime":          get_regime(),
        "active_agents":   [a for a,s in AGENT_STATE.items() if s["state"]=="Live"],
        "ts":              __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }

# ── Reports ──────────────────────────────────────────────────────────────────
@app.get("/api/reports")
def api_list_reports():
    return list_reports()

@app.post("/api/reports/portfolio")
async def api_gen_portfolio_report():
    from services.agents import get_all as agents_all
    rid = await asyncio.get_event_loop().run_in_executor(
        None, generate_portfolio_report, portfolio, agents_all(), trades[:50]
    )
    return {"report_id": rid, "url": f"/report/{rid}"}

@app.post("/api/reports/scout")
async def api_gen_scout_report():
    cached = get_cached_screen()
    if not cached:
        raise HTTPException(400, "No scout screen available — run /api/scout/screen first")
    rid = await asyncio.get_event_loop().run_in_executor(
        None, generate_scout_report, cached
    )
    return {"report_id": rid, "url": f"/report/{rid}"}

@app.post("/api/reports/backtest/{abbr}/{symbol}/{horizon}")
async def api_gen_backtest_report(abbr: str, symbol: str, horizon: str):
    r = get_result(abbr.upper(), symbol.upper(), horizon)
    if not r:
        raise HTTPException(404, "No backtest result found — run backtest first")
    rid = await asyncio.get_event_loop().run_in_executor(
        None, generate_backtest_report, r
    )
    return {"report_id": rid, "url": f"/report/{rid}"}

# ── Report viewer (public HTML page) ──────────────────────────────────────────
@app.get("/report/{report_id}", include_in_schema=False)
async def serve_report(report_id: str):
    html = await asyncio.get_event_loop().run_in_executor(
        None, get_report_html, report_id
    )
    if not html:
        raise HTTPException(404, f"Report {report_id} not found")
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=html)

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
