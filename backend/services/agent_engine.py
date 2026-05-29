"""
Agent Engine
Combines real market data, trained ML models, and time-horizon logic
to produce trading signals and manage agent state.

Time horizons and their best-fit agents:
  scalping  (seconds–minutes) → VOL, DQN, MRV
  day       (minutes–hours)   → MOM, SEN, PPO
  swing     (days–weeks)      → MOM, MAC, MRV, OPT
  position  (weeks–months)    → MAC, OPT, REG
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from services.market_data import get_ohlcv, add_indicators, get_news_sentiment, get_live_quote
from services.model_trainer import train_agent_model, predict, get_model_info

logger = logging.getLogger(__name__)

# ── Agent catalogue ────────────────────────────────────────────────────────────
AGENT_CATALOGUE = {
    "MOM": {
        "name": "Momentum Agent", "strategy": "Trend Following", "type": "Rule-Based + ML",
        "color": "#06b6d4", "icon": "↑", "state": "Live",
        "best_horizons": ["day", "swing"],
        "primary_assets": ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"],
        "risk": "Medium",
    },
    "MRV": {
        "name": "Mean Reversion", "strategy": "Contrarian / Stat Arb", "type": "Statistical ML",
        "color": "#8b5cf6", "icon": "⇄", "state": "Live",
        "best_horizons": ["scalping", "day"],
        "primary_assets": ["GLD", "TLT", "SPY"],
        "risk": "Low",
    },
    "PPO": {
        "name": "RL PPO Agent", "strategy": "Reinforcement Learning", "type": "Policy Gradient",
        "color": "#3b82f6", "icon": "🧠", "state": "Training",
        "best_horizons": ["day", "swing"],
        "primary_assets": ["BTC-USD", "ETH-USD", "QQQ"],
        "risk": "High",
    },
    "DQN": {
        "name": "DQN Agent", "strategy": "Deep Q-Learning", "type": "Value-Based RL",
        "color": "#ec4899", "icon": "⚡", "state": "Backtest",
        "best_horizons": ["scalping", "day"],
        "primary_assets": ["NVDA", "AMD", "TSLA"],
        "risk": "High",
    },
    "MAC": {
        "name": "Macro Agent", "strategy": "Macro / Top-Down", "type": "Factor Model",
        "color": "#f59e0b", "icon": "🌐", "state": "Live",
        "best_horizons": ["swing", "position"],
        "primary_assets": ["GLD", "TLT", "SPY"],
        "risk": "Medium",
    },
    "SEN": {
        "name": "Sentiment Agent", "strategy": "NLP / News Sentiment", "type": "LLM-Powered",
        "color": "#f97316", "icon": "📰", "state": "Live",
        "best_horizons": ["day", "swing"],
        "primary_assets": ["TSLA", "META", "AMZN"],
        "risk": "Medium",
    },
    "VOL": {
        "name": "Volatility Agent", "strategy": "Vol Trading / VIX", "type": "Options Simulation",
        "color": "#ef4444", "icon": "📊", "state": "Live",
        "best_horizons": ["scalping", "day"],
        "primary_assets": ["SPY", "QQQ"],
        "risk": "Very High",
    },
    "REG": {
        "name": "Market Regime", "strategy": "Regime Detection", "type": "HMM + Clustering",
        "color": "#14b8a6", "icon": "🔍", "state": "Training",
        "best_horizons": ["swing", "position"],
        "primary_assets": ["SPY", "TLT"],
        "risk": "Low",
    },
    "OPT": {
        "name": "Portfolio Optimizer", "strategy": "Dynamic Allocation", "type": "MVO + RL",
        "color": "#10b981", "icon": "⚖️", "state": "Live",
        "best_horizons": ["swing", "position"],
        "primary_assets": ["SPY", "GLD", "TLT"],
        "risk": "Low",
    },
}

# In-memory agent runtime state
_agent_state: dict = {}

def _init_state():
    """Initialize runtime state for all agents."""
    import random
    seeds = {"MOM":18.4,"MRV":12.1,"PPO":9.7,"DQN":7.3,"MAC":14.8,"SEN":11.2,"VOL":22.6,"REG":6.1,"OPT":16.3}
    sharpes = {"MOM":1.82,"MRV":2.11,"PPO":1.43,"DQN":1.21,"MAC":1.68,"SEN":1.55,"VOL":1.94,"REG":1.12,"OPT":2.28}
    for abbr, cfg in AGENT_CATALOGUE.items():
        p = seeds[abbr]
        _agent_state[abbr] = {
            **cfg,
            "abbr": abbr,
            "equity": round(100 + p, 4),
            "perf": round(p, 2),
            "sharpe": sharpes[abbr],
            "sortino": round(sharpes[abbr] * 1.2, 2),
            "max_drawdown": round(-p * 0.5, 1),
            "accuracy": 0.0,       # filled after training
            "reward": 300 + list(AGENT_CATALOGUE.keys()).index(abbr) * 90,
            "trades_count": 200 + list(AGENT_CATALOGUE.keys()).index(abbr) * 150,
            "win_rate": 49 + list(AGENT_CATALOGUE.keys()).index(abbr) * 2,
            "profit_factor": round(1.3 + list(AGENT_CATALOGUE.keys()).index(abbr) * 0.1, 1),
            "confidence": 55 + list(AGENT_CATALOGUE.keys()).index(abbr) * 4,
            "alpha": round(p * 0.5, 1),
            "progress": 0,
            "last_trade": f"INIT {abbr}",
            "last_signal": {},
            "model_meta": {},
            "horizon": "swing",    # default, overridable per request
        }

_init_state()

def get_all_agents() -> list[dict]:
    return list(_agent_state.values())

def get_agent(abbr: str) -> Optional[dict]:
    return _agent_state.get(abbr.upper())

def set_agent_horizon(abbr: str, horizon: str) -> bool:
    if abbr in _agent_state and horizon in ("scalping","day","swing","position"):
        _agent_state[abbr]["horizon"] = horizon
        return True
    return False

# ── Recommend best agents for a given horizon ─────────────────────────────────
def recommend_agents_for_horizon(horizon: str) -> list[str]:
    """Return agent abbrs best suited for the given time horizon."""
    return [abbr for abbr, cfg in AGENT_CATALOGUE.items() if horizon in cfg["best_horizons"]]

# ── Core: fetch data + train + signal for one agent ───────────────────────────
async def run_agent_cycle(
    abbr: str,
    symbol: str,
    horizon: str = None,
    force_retrain: bool = False,
) -> dict:
    """
    Full cycle for one agent on one symbol:
    1. Fetch real OHLCV
    2. Add indicators
    3. Train model (if not cached or force_retrain)
    4. Run prediction → signal
    5. Update in-memory state
    Returns the signal dict.
    """
    agent = _agent_state.get(abbr.upper())
    if not agent:
        return {"error": f"Unknown agent {abbr}"}

    horizon = horizon or agent.get("horizon", "swing")

    # 1 + 2: data
    loop = asyncio.get_event_loop()
    df_raw = await loop.run_in_executor(None, get_ohlcv, symbol, horizon)
    if df_raw is None or df_raw.empty:
        return {"action": "HOLD", "confidence": 0.5, "source": "no_data", "symbol": symbol}

    df = await loop.run_in_executor(None, add_indicators, df_raw)
    if df.empty:
        return {"action": "HOLD", "confidence": 0.5, "source": "no_indicators", "symbol": symbol}

    # 3: train / load model
    meta = await loop.run_in_executor(None, train_agent_model, abbr, symbol, horizon, df, force_retrain)

    # Update agent accuracy from model meta
    if meta.get("accuracy"):
        _agent_state[abbr]["accuracy"] = round(meta["accuracy"] * 100, 1)
        _agent_state[abbr]["progress"] = min(100, round(meta["accuracy"] * 100 * 1.1, 1))
        _agent_state[abbr]["model_meta"] = meta

    # 4: predict
    signal = await loop.run_in_executor(None, predict, abbr, symbol, horizon, df)
    signal["symbol"] = symbol
    signal["horizon"] = horizon
    signal["ts"] = datetime.now(timezone.utc).isoformat()
    signal["agent_abbr"] = abbr

    # 5: update state
    _agent_state[abbr]["last_signal"] = signal
    _agent_state[abbr]["last_trade"] = f"{signal['action']} {symbol} @ {round(df['close'].iloc[-1], 2)}"
    _agent_state[abbr]["confidence"] = round(signal["confidence"] * 100, 1)

    # Sentiment overlay for SEN agent
    if abbr == "SEN":
        news = await loop.run_in_executor(None, get_news_sentiment, symbol)
        signal["sentiment_score"] = news["score"]
        signal["headlines"] = news.get("headlines", [])
        if news["score"] > 0.2 and signal["action"] == "HOLD":
            signal["action"] = "BUY"
        elif news["score"] < -0.2 and signal["action"] == "HOLD":
            signal["action"] = "SELL"

    return signal

# ── Batch: run all agents on their primary assets ─────────────────────────────
async def run_all_agents(horizon_override: str = None) -> dict:
    """Run all 9 agents on their primary assets. Returns {abbr: signal}."""
    tasks = {}
    for abbr, cfg in AGENT_CATALOGUE.items():
        symbol  = cfg["primary_assets"][0]
        horizon = horizon_override or _agent_state[abbr].get("horizon", "swing")
        tasks[abbr] = run_agent_cycle(abbr, symbol, horizon)

    results = await asyncio.gather(*tasks.values(), return_exceptions=True)
    return {abbr: (r if not isinstance(r, Exception) else {"error": str(r)})
            for abbr, r in zip(tasks.keys(), results)}

# ── Ensemble vote ─────────────────────────────────────────────────────────────
def ensemble_vote(signals: dict) -> dict:
    """
    Combine signals from multiple agents into an ensemble decision.
    Weights by confidence score.
    """
    buy_score = sell_score = hold_score = 0.0
    total_weight = 0.0
    votes = {"BUY": [], "SELL": [], "HOLD": []}

    for abbr, sig in signals.items():
        if "error" in sig:
            continue
        action = sig.get("action", "HOLD")
        conf   = sig.get("confidence", 0.5)
        votes[action].append(abbr)
        if action == "BUY":   buy_score  += conf
        elif action == "SELL": sell_score += conf
        else:                  hold_score += conf
        total_weight += conf

    if total_weight == 0:
        return {"action": "HOLD", "confidence": 0.5, "buy_agents": [], "sell_agents": [], "hold_agents": []}

    buy_w  = buy_score  / total_weight
    sell_w = sell_score / total_weight

    if buy_w > sell_w and buy_w > 0.4:
        action, confidence = "BUY",  buy_w
    elif sell_w > buy_w and sell_w > 0.4:
        action, confidence = "SELL", sell_w
    else:
        action, confidence = "HOLD", 1 - max(buy_w, sell_w)

    return {
        "action": action,
        "confidence": round(confidence, 3),
        "buy_agents":  votes["BUY"],
        "sell_agents": votes["SELL"],
        "hold_agents": votes["HOLD"],
        "buy_pct":  round(buy_w * 100, 1),
        "sell_pct": round(sell_w * 100, 1),
    }
