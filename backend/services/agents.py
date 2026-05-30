"""9 AI trading agents — catalogue, live state, run cycles, ensemble vote."""
import asyncio, logging
from datetime import datetime, timezone
from services.market  import get_ohlcv, add_indicators, get_news_sentiment, get_live_quote
from services.trainer import train, predict, get_meta

logger = logging.getLogger(__name__)

# ── Static catalogue ───────────────────────────────────────────────────────────
CATALOGUE = {
    "MOM": {"name": "Momentum Agent",     "strategy": "Trend Following",        "type": "Rule-Based + ML",
            "color": "#06b6d4", "icon": "↑",  "best_horizons": ["day","swing"],          "assets": ["SPY","QQQ","MSFT"]},
    "MRV": {"name": "Mean Reversion",     "strategy": "Contrarian / Stat Arb",  "type": "Statistical ML",
            "color": "#8b5cf6", "icon": "⇄",  "best_horizons": ["scalping","day"],       "assets": ["GLD","TLT","SPY"]},
    "PPO": {"name": "RL PPO Agent",       "strategy": "Reinforcement Learning", "type": "Policy Gradient",
            "color": "#3b82f6", "icon": "🧠", "best_horizons": ["day","swing"],          "assets": ["QQQ","NVDA"]},
    "DQN": {"name": "DQN Agent",          "strategy": "Deep Q-Learning",        "type": "Value-Based RL",
            "color": "#ec4899", "icon": "⚡", "best_horizons": ["scalping","day"],       "assets": ["NVDA","TSLA"]},
    "MAC": {"name": "Macro Agent",        "strategy": "Macro / Top-Down",       "type": "Factor Model",
            "color": "#f59e0b", "icon": "🌐", "best_horizons": ["swing","position"],     "assets": ["GLD","TLT"]},
    "SEN": {"name": "Sentiment Agent",    "strategy": "NLP / News Sentiment",   "type": "LLM-Powered",
            "color": "#f97316", "icon": "📰", "best_horizons": ["day","swing"],          "assets": ["TSLA","META","AMZN"]},
    "VOL": {"name": "Volatility Agent",   "strategy": "Vol Trading / VIX",      "type": "Options Simulation",
            "color": "#ef4444", "icon": "📊", "best_horizons": ["scalping","day"],       "assets": ["SPY","QQQ"]},
    "REG": {"name": "Market Regime",      "strategy": "Regime Detection",       "type": "HMM + Clustering",
            "color": "#14b8a6", "icon": "🔍", "best_horizons": ["swing","position"],     "assets": ["SPY","TLT"]},
    "OPT": {"name": "Portfolio Optimizer","strategy": "Dynamic Allocation",     "type": "MVO + RL",
            "color": "#10b981", "icon": "⚖️","best_horizons": ["swing","position"],     "assets": ["SPY","GLD","TLT"]},
}

_PERF  = {"MOM":18.4,"MRV":12.1,"PPO":9.7,"DQN":7.3,"MAC":14.8,"SEN":11.2,"VOL":22.6,"REG":6.1,"OPT":16.3}
_SHPS  = {"MOM":1.82,"MRV":2.11,"PPO":1.43,"DQN":1.21,"MAC":1.68,"SEN":1.55,"VOL":1.94,"REG":1.12,"OPT":2.28}
_STATES = {"MOM":"Live","MRV":"Live","PPO":"Training","DQN":"Backtest",
           "MAC":"Live","SEN":"Live","VOL":"Live","REG":"Training","OPT":"Live"}

# ── Live mutable state (updated by sim loop + run_cycle) ──────────────────────
AGENT_STATE: dict = {}

def _init():
    for abbr, cfg in CATALOGUE.items():
        p = _PERF[abbr]
        AGENT_STATE[abbr] = {
            **cfg,
            "abbr":          abbr,
            "state":         _STATES[abbr],
            "perf":          round(p, 2),
            "equity":        round(100 + p, 4),
            "sharpe":        _SHPS[abbr],
            "sortino":       round(_SHPS[abbr] * 1.2, 2),
            "max_drawdown":  round(-p * 0.5, 1),
            "accuracy":      0.0,
            "reward":        300 + list(CATALOGUE).index(abbr) * 90,
            "trades_count":  200 + list(CATALOGUE).index(abbr) * 150,
            "win_rate":      49 + list(CATALOGUE).index(abbr) * 2,
            "profit_factor": round(1.3 + list(CATALOGUE).index(abbr) * 0.1, 1),
            "confidence":    55 + list(CATALOGUE).index(abbr) * 4,
            "alpha":         round(p * 0.5, 1),
            "progress":      0,
            "horizon":       "swing",
            "last_trade":    f"INIT {abbr}",
            "last_signal":   {},
            "model_meta":    {},
            "model_version": 0,
        }

_init()

# ── Getters ────────────────────────────────────────────────────────────────────
def get_all() -> list:           return list(AGENT_STATE.values())
def get(abbr: str) -> dict|None: return AGENT_STATE.get(abbr.upper())

def set_horizon(abbr: str, h: str) -> bool:
    if abbr in AGENT_STATE and h in ("scalping","day","swing","position"):
        AGENT_STATE[abbr]["horizon"] = h
        return True
    return False

def recommended_for(horizon: str) -> list:
    return [a for a, c in CATALOGUE.items() if horizon in c["best_horizons"]]

# ── Run one agent cycle (fetch data → train → predict) ────────────────────────
async def run_cycle(abbr: str, symbol: str, horizon: str = None, force: bool = False) -> dict:
    agent   = AGENT_STATE.get(abbr.upper())
    if not agent:
        return {"error": f"Unknown agent {abbr}"}
    horizon = horizon or agent.get("horizon", "swing")
    loop    = asyncio.get_event_loop()

    df_raw = await loop.run_in_executor(None, get_ohlcv, symbol, horizon)
    if df_raw is None or df_raw.empty:
        return {"action": "HOLD", "confidence": 0.5, "source": "no_data", "symbol": symbol}

    df = await loop.run_in_executor(None, add_indicators, df_raw)
    if df.empty:
        return {"action": "HOLD", "confidence": 0.5, "source": "no_indicators", "symbol": symbol}

    meta = await loop.run_in_executor(None, train, abbr, symbol, horizon, df, force)
    if meta.get("accuracy"):
        agent["accuracy"]   = round(meta["accuracy"] * 100, 1)
        agent["progress"]   = min(100, round(meta["accuracy"] * 110, 1))
        agent["model_meta"] = meta

    sig = await loop.run_in_executor(None, predict, abbr, symbol, horizon, df)
    sig.update({"symbol": symbol, "horizon": horizon,
                "ts": datetime.now(timezone.utc).isoformat(), "agent_abbr": abbr})

    # Sentiment agent gets news boost
    if abbr == "SEN":
        news = await loop.run_in_executor(None, get_news_sentiment, symbol)
        sig["sentiment_score"] = news["score"]
        if news["score"] > 0.2 and sig["action"] == "HOLD": sig["action"] = "BUY"
        elif news["score"] < -0.2 and sig["action"] == "HOLD": sig["action"] = "SELL"

    agent["last_signal"]  = sig
    agent["confidence"]   = round(sig["confidence"] * 100, 1)
    close_price           = float(df["close"].iloc[-1])
    agent["last_trade"]   = f"{sig['action']} {symbol} @ {close_price:.2f}"
    return sig

# ── Ensemble vote ──────────────────────────────────────────────────────────────
def ensemble_vote(signals: dict) -> dict:
    b = s = h = 0.0
    votes = {"BUY": [], "SELL": [], "HOLD": []}
    for abbr, sig in signals.items():
        if "error" in sig: continue
        a = sig.get("action", "HOLD")
        c = sig.get("confidence", 0.5)
        votes[a].append(abbr)
        if a == "BUY": b += c
        elif a == "SELL": s += c
        else: h += c
    total = b + s + h
    if not total:
        return {"action": "HOLD", "confidence": 0.5,
                "buy_agents": [], "sell_agents": [], "hold_agents": []}
    bw, sw = b / total, s / total
    if bw > sw and bw > 0.4:    action, conf = "BUY",  bw
    elif sw > bw and sw > 0.4:  action, conf = "SELL", sw
    else:                       action, conf = "HOLD", 1 - max(bw, sw)
    return {"action": action, "confidence": round(conf, 3),
            "buy_agents": votes["BUY"], "sell_agents": votes["SELL"],
            "hold_agents": votes["HOLD"], "buy_pct": round(bw*100,1),
            "sell_pct": round(sw*100,1)}
