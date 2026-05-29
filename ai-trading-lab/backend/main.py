"""
AI Trading Agents Lab — FastAPI Backend v3
Real data + ML models + Ollama + Paper trading + WebSocket
"""

import asyncio, json, os, random, logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Settings ──────────────────────────────────────────────────────────────────
class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_service_role_key: str = ""
    secret_key: str = "dev-secret-key"
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
    polygon_key: str = ""
    news_api_key: str = ""
    class Config:
        env_file = ".env"; extra = "ignore"

settings = Settings()

# ── Import services ───────────────────────────────────────────────────────────
from services.agent_engine   import (
    get_all_agents, get_agent, run_agent_cycle, run_all_agents,
    ensemble_vote, set_agent_horizon, recommend_agents_for_horizon,
    _agent_state, AGENT_CATALOGUE,
)
from services.market_data    import get_ohlcv, add_indicators, get_live_quote, get_news_sentiment
from services.model_trainer  import train_agent_model, get_model_info
from services.ollama_service import is_available as ollama_ok, chat as ollama_chat, parse_order_from_text, list_models
from services.paper_trading  import execute_order, get_balance, get_positions

# ── In-memory simulation state ────────────────────────────────────────────────
SYMBOLS = {
    "SPY":480.20,"QQQ":432.10,"AAPL":189.50,"MSFT":415.30,
    "NVDA":840.50,"TSLA":248.60,"META":512.40,"AMZN":185.70,
    "GLD":184.30,"TLT":96.20,"BTC-USD":68200.0,"ETH-USD":3800.0,"VIX":14.10,
}

_prices  = dict(SYMBOLS)
_trades  = []
_signals = []
_portfolio = {
    "equity":settings.initial_capital,"cash":settings.initial_capital*0.36,
    "invested":settings.initial_capital*0.64,"total_return":27.4,"daily_pnl":1240.5,
    "sharpe":1.87,"sortino":2.31,"max_drawdown":-8.2,"volatility":12.4,
    "alpha":9.3,"win_rate":62.0,"profit_factor":1.91,"exposure_pct":64.0,"active_agents":7,
}

# ── WebSocket manager ─────────────────────────────────────────────────────────
class WSManager:
    def __init__(self): self.active: list[WebSocket] = []
    async def connect(self, ws): await ws.accept(); self.active.append(ws)
    def disconnect(self, ws):
        if ws in self.active: self.active.remove(ws)
    async def broadcast(self, data):
        msg = json.dumps(data, default=str)
        dead = []
        for ws in self.active:
            try: await ws.send_text(msg)
            except: dead.append(ws)
        for ws in dead: self.disconnect(ws)

manager = WSManager()

def _tick():
    global _prices, _portfolio
    for sym in list(_prices.keys()):
        vol = 0.004 if "BTC" in sym or "ETH" in sym else 0.001
        _prices[sym] = round(_prices[sym] * (1 + random.gauss(0, vol)), 4)
    for abbr, agent in _agent_state.items():
        if agent["state"] == "Live":
            delta = random.gauss(0.0005, 0.002)
            agent["equity"] = round(agent["equity"] * (1 + delta), 4)
            agent["perf"]   = round((agent["equity"] - 100) / 100 * 100, 2)
            agent["reward"] = round(agent["reward"] + random.gauss(0.5, 2), 2)
            if random.random() < 0.02:
                sym  = random.choice(agent.get("primary_assets",["SPY"]))
                side = random.choice(["BUY","SELL"])
                price = _prices.get(sym, 100)
                pnl  = round(random.gauss(0.3, 1.5), 2)
                t = {"id":f"{abbr}-{random.randint(1000,9999)}","agent_abbr":abbr,"agent_name":agent["name"],"symbol":sym,"side":side,"price":round(price,2),"pnl":pnl,"ts":datetime.now(timezone.utc).isoformat(),"status":"filled","source":"auto"}
                _trades.insert(0, t); _trades[:] = _trades[:300]
                agent["last_trade"] = f"{side} {sym} @ {round(price,2)}"
                agent["trades_count"] += 1
    delta = random.gauss(0.0003, 0.001)
    _portfolio["equity"] = round(_portfolio["equity"] * (1 + delta), 2)
    _portfolio["total_return"] = round((_portfolio["equity"] - settings.initial_capital) / settings.initial_capital * 100, 2)
    _portfolio["daily_pnl"] = round(_portfolio["equity"] * delta, 2)

async def simulation_loop():
    while True:
        await asyncio.sleep(settings.simulation_tick_seconds)
        _tick()
        await manager.broadcast({
            "type":"tick","prices":_prices,"portfolio":_portfolio,
            "agents":{abbr:{"perf":a["perf"],"equity":a["equity"],"reward":a["reward"],"confidence":round(a.get("confidence",60),1),"last_trade":a.get("last_trade",""),"trades_count":a.get("trades_count",0)} for abbr,a in _agent_state.items()},
            "latest_trade":_trades[0] if _trades else None,
        })

async def agent_background_cycle():
    """Every 5 min: run one agent on its primary asset to keep models fresh."""
    agents_list = list(AGENT_CATALOGUE.keys())
    idx = 0
    while True:
        await asyncio.sleep(300)
        abbr = agents_list[idx % len(agents_list)]
        idx += 1
        try:
            cfg    = AGENT_CATALOGUE[abbr]
            symbol = cfg["primary_assets"][0]
            horizon = _agent_state[abbr].get("horizon", "swing")
            sig = await run_agent_cycle(abbr, symbol, horizon)
            _signals.insert(0, sig); _signals[:] = _signals[:100]
            await manager.broadcast({"type":"signal","signal":sig})
        except Exception as e:
            logger.warning(f"Background agent cycle error [{abbr}]: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = []
    if settings.agents_auto_start:
        tasks.append(asyncio.create_task(simulation_loop()))
        tasks.append(asyncio.create_task(agent_background_cycle()))
    yield
    for t in tasks: t.cancel()

app = FastAPI(title="AI Trading Lab API", version="3.0.0", lifespan=lifespan)
origins = [o.strip() for o in settings.allowed_origins.split(",")]
app.add_middleware(CORSMiddleware, allow_origins=["*"] if "*" in origins else origins,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── Pydantic models ────────────────────────────────────────────────────────────
class TradeRequest(BaseModel):
    symbol: str = "SPY"; side: str = "BUY"; quantity: float = 1.0
    agent_abbr: str = "MOM"; order_type: str = "MARKET"
    limit_price: Optional[float] = None; horizon: str = "swing"
    confidence: float = 0.7; reason: str = ""

class ChatRequest(BaseModel):
    message: str; conversation_history: list = []

class AgentRunRequest(BaseModel):
    symbol: str = "SPY"; horizon: str = "swing"; force_retrain: bool = False

class HorizonRequest(BaseModel):
    horizon: str

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status":"ok","agents":len(_agent_state),"trades":len(_trades),"ollama_model":settings.ollama_model}

# ── Prices ─────────────────────────────────────────────────────────────────────
@app.get("/api/prices")
def get_prices(): return _prices

@app.get("/api/quote/{symbol}")
async def quote(symbol: str):
    q = await asyncio.get_event_loop().run_in_executor(None, get_live_quote, symbol.upper())
    if q["price"] > 0: _prices[symbol.upper()] = q["price"]
    return q

# ── Portfolio ─────────────────────────────────────────────────────────────────
@app.get("/api/portfolio")
def get_portfolio(): return _portfolio

# ── Agents ─────────────────────────────────────────────────────────────────────
@app.get("/api/agents")
def agents(): return get_all_agents()

@app.get("/api/agents/{abbr}")
def agent_detail(abbr: str):
    a = get_agent(abbr.upper())
    if not a: raise HTTPException(404, "Agent not found")
    return {**a, "model_info": get_model_info(abbr.upper(), a.get("primary_assets",["SPY"])[0], a.get("horizon","swing"))}

@app.post("/api/agents/{abbr}/horizon")
def set_horizon(abbr: str, req: HorizonRequest):
    ok = set_agent_horizon(abbr.upper(), req.horizon)
    if not ok: raise HTTPException(400, "Invalid horizon or agent")
    return {"abbr": abbr.upper(), "horizon": req.horizon}

@app.post("/api/agents/{abbr}/run")
async def run_agent(abbr: str, req: AgentRunRequest):
    """Trigger real data fetch + train + signal for one agent."""
    sig = await run_agent_cycle(abbr.upper(), req.symbol.upper(), req.horizon, req.force_retrain)
    _signals.insert(0, sig); _signals[:] = _signals[:100]
    return sig

@app.get("/api/agents/{abbr}/model")
def agent_model_info(abbr: str):
    a = get_agent(abbr.upper())
    if not a: raise HTTPException(404)
    symbol  = a.get("primary_assets",["SPY"])[0]
    horizon = a.get("horizon","swing")
    return get_model_info(abbr.upper(), symbol, horizon)

@app.get("/api/horizons/recommend")
def recommend_horizon(horizon: str = "swing"):
    return {"horizon": horizon, "recommended_agents": recommend_agents_for_horizon(horizon)}

# ── Trades ─────────────────────────────────────────────────────────────────────
@app.get("/api/trades")
def get_trades(agent: Optional[str] = None, limit: int = 60):
    trades = _trades
    if agent: trades = [t for t in trades if t.get("agent_abbr","").upper() == agent.upper()]
    return trades[:limit]

@app.post("/api/trades/execute")
async def execute_trade(req: TradeRequest):
    """Execute a paper trade with real current price."""
    symbol  = req.symbol.upper()
    # Try real price first, fallback to sim price
    quote   = await asyncio.get_event_loop().run_in_executor(None, get_live_quote, symbol)
    price   = quote["price"] if quote["price"] > 0 else _prices.get(symbol, 100.0)

    try:
        trade = execute_order(
            agent_abbr=req.agent_abbr.upper(), symbol=symbol,
            side=req.side.upper(), quantity=req.quantity,
            market_price=price, reason=req.reason, confidence=req.confidence,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    trade["source"] = "manual"; trade["horizon"] = req.horizon
    _trades.insert(0, trade); _trades[:] = _trades[:300]

    # Update agent state
    if req.agent_abbr.upper() in _agent_state:
        _agent_state[req.agent_abbr.upper()]["last_trade"] = f"{req.side.upper()} {symbol} @ {price:.2f}"
        _agent_state[req.agent_abbr.upper()]["trades_count"] += 1

    await manager.broadcast({"type":"trade","trade":trade})
    return trade

# ── Signals ────────────────────────────────────────────────────────────────────
@app.get("/api/signals")
def get_signals(limit: int = 20): return _signals[:limit]

@app.get("/api/signals/ensemble")
async def get_ensemble():
    latest_signals = {s["agent_abbr"]: s for s in _signals if "agent_abbr" in s}
    if not latest_signals:
        return {"action":"HOLD","confidence":0.5,"note":"no signals yet — trigger /api/agents/run"}
    return ensemble_vote(latest_signals)

# ── Market data ────────────────────────────────────────────────────────────────
@app.get("/api/market/ohlcv/{symbol}")
async def market_ohlcv(symbol: str, horizon: str = "swing"):
    df = await asyncio.get_event_loop().run_in_executor(None, get_ohlcv, symbol.upper(), horizon)
    if df is None: raise HTTPException(404, "No data for symbol")
    df_ind = await asyncio.get_event_loop().run_in_executor(None, add_indicators, df)
    last80 = df_ind.tail(80).reset_index()
    last80.columns = [str(c) for c in last80.columns]
    last80["datetime"] = last80["datetime"].astype(str)
    return {"symbol":symbol.upper(),"horizon":horizon,"bars":len(last80),"data":last80.to_dict("records")}

@app.get("/api/market/news/{symbol}")
async def market_news(symbol: str):
    return await asyncio.get_event_loop().run_in_executor(None, get_news_sentiment, symbol.upper())

@app.get("/api/watchlist")
async def get_watchlist():
    results = []
    for sym, base_price in list(SYMBOLS.items())[:10]:
        results.append({"symbol":sym,"price":round(_prices.get(sym,base_price),2),"change_pct":round(random.gauss(0.1,0.8),2)})
    return results

# ── Analytics ─────────────────────────────────────────────────────────────────
@app.get("/api/analytics/risk")
def risk_metrics():
    return {"var_95":-2.4,"cvar_95":-3.8,"max_drawdown":-8.2,"sharpe":1.87,"sortino":2.31,"calmar":2.24,"omega":1.64,"beta":0.72,"volatility_ann":12.4}

@app.get("/api/analytics/equity-history")
def equity_history(points: int = 80):
    v = 100.0
    result = []
    for i in range(points):
        v = v * (1 + random.gauss(0.003, 0.015))
        result.append({"i":i,"portfolio":round(v,2),"sp500":round(100+i*0.18,2),"buyhold":round(100+i*0.12,2)})
    return result

@app.get("/api/analytics/scenario")
def scenario_analysis():
    return [
        {"scenario":"2020 COVID Crash","impact":-18.4,"recovery_days":45},
        {"scenario":"2022 Rate Hike Cycle","impact":-9.2,"recovery_days":120},
        {"scenario":"2023 AI Bull Run","impact":32.1,"recovery_days":None},
        {"scenario":"Flash Crash -10%","impact":-6.8,"recovery_days":8},
        {"scenario":"High Volatility VIX>40","impact":-4.1,"recovery_days":30},
        {"scenario":"Bull Market +20%","impact":24.4,"recovery_days":None},
    ]

# ── Ollama / Chat ──────────────────────────────────────────────────────────────
@app.get("/api/ollama/status")
async def ollama_status():
    available = await ollama_ok()
    models    = await list_models() if available else []
    return {"available":available,"model":settings.ollama_model,"available_models":models,"base_url":settings.ollama_base_url}

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    agents_ctx = [{"abbr":a["abbr"],"perf":a.get("perf",0),"state":a["state"]} for a in get_all_agents()]
    result = await ollama_chat(
        message=req.message,
        conversation_history=req.conversation_history,
        portfolio_context=_portfolio,
        agent_context=agents_ctx,
    )
    return result

@app.post("/api/chat/parse-order")
async def parse_order(req: ChatRequest):
    ctx = {"prices":_prices,"portfolio":_portfolio}
    order = await parse_order_from_text(req.message, ctx)
    return order

# ── WebSocket ──────────────────────────────────────────────────────────────────
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await manager.connect(ws)
    await ws.send_text(json.dumps({"type":"snapshot","prices":_prices,"portfolio":_portfolio,"agents":{a:s for a,s in _agent_state.items()},"trades":_trades[:20]}, default=str))
    try:
        while True:
            data = await ws.receive_text()
            if data == "ping": await ws.send_text(json.dumps({"type":"pong"}))
    except WebSocketDisconnect:
        manager.disconnect(ws)
