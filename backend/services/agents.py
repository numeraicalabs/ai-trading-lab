"""
9 AI trading agents — catalogue, live state, impulse flow, ensemble.

NEW in v6:
  - Impulse flow: agent-to-agent signal propagation tracked + broadcasted
  - Per-agent customization: threshold, aggressiveness, max_position, enabled
  - Profitability improvements: accuracy-weighted ensemble, regime gating
  - AGENT_CONFIG: user-editable parameters persisted in memory
"""
import asyncio, logging, time, hashlib
import numpy as np
from datetime import datetime, timezone
from collections import deque
from services.market  import get_ohlcv, add_indicators, get_news_sentiment
from services.trainer import train, predict, get_meta

logger = logging.getLogger(__name__)

# ── Static catalogue ──────────────────────────────────────────────────────────
CATALOGUE = {
    "MOM": {"name": "Momentum Agent",      "strategy": "Trend Following",        "type": "Rule-Based + ML",
            "color": "#06b6d4", "icon": "↑",  "best_horizons": ["day","swing"],           "assets": ["SPY","QQQ","MSFT"]},
    "MRV": {"name": "Mean Reversion",      "strategy": "Contrarian / Stat Arb",  "type": "Statistical ML",
            "color": "#8b5cf6", "icon": "⇄",  "best_horizons": ["scalping","day"],        "assets": ["GLD","TLT","SPY"]},
    "PPO": {"name": "RL PPO Agent",        "strategy": "Reinforcement Learning", "type": "Policy Gradient",
            "color": "#3b82f6", "icon": "🧠", "best_horizons": ["day","swing"],           "assets": ["QQQ","NVDA"]},
    "DQN": {"name": "DQN Agent",           "strategy": "Deep Q-Learning",        "type": "Value-Based RL",
            "color": "#ec4899", "icon": "⚡", "best_horizons": ["scalping","day"],        "assets": ["NVDA","TSLA"]},
    "MAC": {"name": "Macro Agent",         "strategy": "Macro / Top-Down",       "type": "Factor Model",
            "color": "#f59e0b", "icon": "🌐", "best_horizons": ["swing","position"],      "assets": ["GLD","TLT"]},
    "SEN": {"name": "Sentiment Agent",     "strategy": "NLP / News Sentiment",   "type": "LLM-Powered",
            "color": "#f97316", "icon": "📰", "best_horizons": ["day","swing"],           "assets": ["TSLA","META","AMZN"]},
    "VOL": {"name": "Volatility Agent",    "strategy": "Vol Trading / VIX",      "type": "Options Simulation",
            "color": "#ef4444", "icon": "📊", "best_horizons": ["scalping","day"],        "assets": ["SPY","QQQ"]},
    "REG": {"name": "Market Regime",       "strategy": "Regime Detection",       "type": "HMM + Clustering",
            "color": "#14b8a6", "icon": "🔍", "best_horizons": ["swing","position"],      "assets": ["SPY","TLT"]},
    "OPT":   {"name": "Portfolio Optimizer", "strategy": "Dynamic Allocation",     "type": "MVO + RL",
            "color": "#10b981", "icon": "⚖️","best_horizons": ["swing","position"],      "assets": ["SPY","GLD","TLT"]},
    "SCOUT": {"name": "Senior Trader Scout", "strategy": "Multi-Factor Screening",  "type": "AI Macro + Technical",
              "color": "#f0abfc", "icon": "🔭","best_horizons": ["day","swing"],          "assets": ["SPY","AAPL","NVDA","GLD"]},
}

_PERF   = {"MOM":18.4,"MRV":12.1,"PPO":9.7,"DQN":7.3,"MAC":14.8,"SEN":11.2,"VOL":22.6,"REG":6.1,"OPT":16.3,"SCOUT":21.7}
_SHPS   = {"MOM":1.82,"MRV":2.11,"PPO":1.43,"DQN":1.21,"MAC":1.68,"SEN":1.55,"VOL":1.94,"REG":1.12,"OPT":2.28,"SCOUT":2.44}
_STATES = {"MOM":"Live","MRV":"Live","PPO":"Training","DQN":"Backtest",
           "MAC":"Live","SEN":"Live","VOL":"Live","REG":"Training","OPT":"Live","SCOUT":"Screening"}

# ── User-editable config per agent ────────────────────────────────────────────
AGENT_CONFIG: dict = {}  # abbr → config dict

def _default_config(abbr: str) -> dict:
    return {
        "enabled":        True,
        "aggressiveness": 0.5,    # 0=very conservative … 1=very aggressive
        "signal_threshold":0.55,  # min confidence to act (vs HOLD)
        "max_position_pct":0.15,  # max % of portfolio per trade
        "stop_loss_pct":  0.03,   # 3% stop loss
        "take_profit_pct":0.06,   # 6% take profit
        "use_regime_gate":True,   # gate signals through REG agent
        "weight":         1.0,    # ensemble weight multiplier
    }

for abbr in CATALOGUE:
    AGENT_CONFIG[abbr] = _default_config(abbr)

def update_config(abbr: str, updates: dict) -> dict:
    cfg  = AGENT_CONFIG.get(abbr, _default_config(abbr))
    safe = {k: v for k, v in updates.items() if k in cfg}
    cfg.update(safe)
    AGENT_CONFIG[abbr] = cfg
    return cfg

# ── Live mutable state ────────────────────────────────────────────────────────
AGENT_STATE: dict = {}

def _gen_equity_series(perf_pct: float, n: int = 80, seed_str: str = "X") -> list:
    """Generate a realistic equity curve as list of {i, v} points for charts/PDF."""
    try:
        seed = int(hashlib.md5(seed_str.encode()).hexdigest()[:8], 16) % (2**31)
        rng  = np.random.default_rng(seed)
        drift = (perf_pct / 100) / max(n, 1)
        rets  = rng.normal(drift, 0.013, n)
        vals  = 100 * np.cumprod(1 + rets)
        return [{"i": i, "v": round(float(v), 4)} for i, v in enumerate(vals)]
    except Exception:
        return [{"i": i, "v": 100.0} for i in range(n)]

def _init():
    for abbr, cfg in CATALOGUE.items():
        p = _PERF[abbr]
        i = list(CATALOGUE).index(abbr)
        AGENT_STATE[abbr] = {
            **cfg,
            "abbr":           abbr,
            "state":          _STATES[abbr],
            "perf":           round(p, 2),
            "equity":         round(100 + p, 4),
            "sharpe":         _SHPS[abbr],
            "sortino":        round(_SHPS[abbr] * 1.2, 2),
            "max_drawdown":   round(-p * 0.5, 1),
            "accuracy":       0.0,
            "reward":         300 + i * 90,
            "trades_count":   200 + i * 150,
            "win_rate":       49 + i * 2,
            "profit_factor":  round(1.3 + i * 0.1, 1),
            "confidence":     55 + i * 4,
            "alpha":          round(p * 0.5, 1),
            "progress":       0,
            "horizon":        "swing",
            "last_trade":     f"INIT {abbr}",
            "last_signal":    {},
            "model_meta":     {},
            "model_version":  0,
            "config":         AGENT_CONFIG[abbr],
            "equity_history": _gen_equity_series(p, 80, abbr),
        }

_init()

# ── Impulse flow bus ──────────────────────────────────────────────────────────
# Circular buffer of the last 200 impulse events
IMPULSE_HISTORY: deque = deque(maxlen=200)

# Real-time impulse (latest per agent-pair, for live animation)
LIVE_IMPULSES: dict = {}  # f"{from}→{to}" → impulse dict

_impulse_counter = 0

def _emit_impulse(src: str, dst: str, direction: str,
                  strength: float, impulse_type: str, reason: str = ""):
    """Record an agent-to-agent signal impulse."""
    global _impulse_counter
    _impulse_counter += 1
    imp = {
        "id":       _impulse_counter,
        "from":     src,
        "to":       dst,
        "direction":direction,   # BUY / SELL / HOLD / WARN / CONFIRM
        "strength": round(strength, 3),
        "type":     impulse_type,  # regime_gate / sentiment_boost / vol_warn / consensus / etc.
        "reason":   reason,
        "color":    CATALOGUE.get(src, {}).get("color", "#3b82f6"),
        "ts":       datetime.now(timezone.utc).isoformat(),
    }
    IMPULSE_HISTORY.appendleft(imp)
    LIVE_IMPULSES[f"{src}→{dst}"] = imp
    return imp

def get_impulses(limit: int = 50) -> list:
    return list(IMPULSE_HISTORY)[:limit]

def get_live_impulses() -> dict:
    return dict(LIVE_IMPULSES)

# ── Getters ────────────────────────────────────────────────────────────────────
def get_all() -> list:           return list(AGENT_STATE.values())
def get(abbr: str):              return AGENT_STATE.get(abbr.upper())

def set_horizon(abbr: str, h: str) -> bool:
    if abbr in AGENT_STATE and h in ("scalping","day","swing","position"):
        AGENT_STATE[abbr]["horizon"] = h
        return True
    return False

def recommended_for(horizon: str) -> list:
    return [a for a, c in CATALOGUE.items() if horizon in c["best_horizons"]]

# ── Regime state (shared across agents) ──────────────────────────────────────
_regime = {"label": "unknown", "confidence": 0.5, "direction": "HOLD"}

def get_regime() -> dict: return _regime

def _update_regime(signal: dict, abbr: str):
    """REG agent updates shared regime, emits impulses to all other agents."""
    if abbr != "REG": return
    # Mutate in-place so all modules that imported _regime see the update
    _regime["label"]      = ("bull" if signal.get("action") == "BUY" else
                              "bear" if signal.get("action") == "SELL" else "neutral")
    _regime["confidence"] = signal.get("confidence", 0.5)
    _regime["direction"]  = signal.get("action", "HOLD")
    _regime["ts"]         = signal.get("ts")
    # Broadcast impulse to all live agents
    for dst in AGENT_STATE:
        if dst == "REG": continue
        if AGENT_STATE[dst]["state"] not in ("Live", "Training"): continue
        _emit_impulse("REG", dst, _regime["direction"],
                      _regime["confidence"], "regime_gate",
                      f"Regime: {_regime['label']}")

# ── Signal quality helpers ─────────────────────────────────────────────────────
def _apply_config_filter(sig: dict, abbr: str) -> dict:
    """Apply per-agent config filters (threshold, regime gate, aggressiveness)."""
    cfg = AGENT_CONFIG.get(abbr, _default_config(abbr))
    if not cfg.get("enabled", True):
        return {**sig, "action": "HOLD", "filtered": "disabled"}
    threshold = cfg.get("signal_threshold", 0.55)
    agg = cfg.get("aggressiveness", 0.5)
    effective_threshold = threshold * (1 - agg * 0.3)  # aggressive lowers bar

    if sig.get("confidence", 0) < effective_threshold:
        return {**sig, "action": "HOLD", "filtered": "below_threshold"}

    # Regime gate: if regime is opposite, reduce confidence
    if cfg.get("use_regime_gate", True) and _regime["label"] != "unknown":
        action  = sig.get("action", "HOLD")
        regime  = _regime["direction"]
        if action != "HOLD" and regime != "HOLD" and action != regime:
            new_conf = sig["confidence"] * 0.6  # contra-trend penalty
            if new_conf < effective_threshold:
                _emit_impulse("REG", abbr, "WARN",
                              _regime["confidence"], "regime_block",
                              f"Blocked {action}: regime is {_regime['label']}")
                return {**sig, "action": "HOLD",
                        "filtered": "regime_blocked", "confidence": new_conf}

    return sig

# ── Run one agent cycle (fetch data → train → predict → impulses) ─────────────
async def run_cycle(abbr: str, symbol: str,
                    horizon: str = None, force: bool = False) -> dict:
    agent   = AGENT_STATE.get(abbr.upper())
    if not agent:
        return {"error": f"Unknown agent {abbr}"}
    horizon = horizon or agent.get("horizon", "swing")
    loop    = asyncio.get_event_loop()

    df_raw = await loop.run_in_executor(None, get_ohlcv, symbol, horizon)
    if df_raw is None or df_raw.empty:
        return {"action":"HOLD","confidence":0.5,"source":"no_data","symbol":symbol}

    df = await loop.run_in_executor(None, add_indicators, df_raw)
    if df.empty:
        return {"action":"HOLD","confidence":0.5,"source":"no_indicators","symbol":symbol}

    meta = await loop.run_in_executor(None, train, abbr, symbol, horizon, df, force)
    if meta.get("accuracy"):
        agent["accuracy"]    = round(meta["accuracy"] * 100, 1)
        agent["progress"]    = min(100, round(meta["accuracy"] * 110, 1))
        agent["model_meta"]  = meta
        agent["model_version"] = agent.get("model_version", 0) + 1
        if meta.get("trained"):
            agent["state"] = "Live"

    raw_sig = await loop.run_in_executor(None, predict, abbr, symbol, horizon, df)
    raw_sig.update({
        "symbol":     symbol,
        "horizon":    horizon,
        "ts":         datetime.now(timezone.utc).isoformat(),
        "agent_abbr": abbr,
        "accuracy":   agent["accuracy"],
    })

    # Sentiment agent: news fusion
    if abbr == "SEN":
        news = await loop.run_in_executor(None, get_news_sentiment, symbol)
        raw_sig["sentiment_score"] = news["score"]
        if news["score"] > 0.3 and raw_sig["action"] == "HOLD":
            raw_sig["action"] = "BUY"; raw_sig["confidence"] = min(.9, raw_sig["confidence"] + .1)
        elif news["score"] < -0.3 and raw_sig["action"] == "HOLD":
            raw_sig["action"] = "SELL"; raw_sig["confidence"] = min(.9, raw_sig["confidence"] + .1)
        # SEN → other agents impulse
        for dst in ["MOM","DQN","PPO"]:
            if news["score"] != 0:
                _emit_impulse("SEN", dst,
                              "BUY" if news["score"] > 0 else "SELL",
                              abs(news["score"]), "sentiment_boost",
                              f"Sentiment {news['score']:.2f} for {symbol}")

    # VOL agent: volatility warnings
    if abbr == "VOL" and "atr" in df.columns:
        atr_pct = float(df["atr"].iloc[-1] / df["close"].iloc[-1])
        if atr_pct > 0.025:  # high vol
            for dst in ["MOM","DQN"]:
                _emit_impulse("VOL", dst, "WARN",
                              min(1.0, atr_pct * 20), "vol_warning",
                              f"High vol: ATR={atr_pct:.2%}")

    # REG agent: update shared regime + broadcast
    if abbr == "REG":
        _update_regime(raw_sig, abbr)

    # OPT agent: emits rebalance impulse to all live agents
    if abbr == "OPT" and raw_sig.get("action") != "HOLD":
        for dst in AGENT_STATE:
            if dst in ("OPT","REG"): continue
            _emit_impulse("OPT", dst, raw_sig["action"],
                          raw_sig.get("confidence", .6) * .7, "rebalance",
                          f"Portfolio rebalance → {raw_sig['action']}")

    # Apply per-agent config filter
    sig = _apply_config_filter(raw_sig, abbr)

    # Cross-agent consensus impulse: if ≥3 agents agree, emit consensus
    live_sigs = {a: s["last_signal"] for a, s in AGENT_STATE.items() if s.get("last_signal")}
    actions   = [s.get("action","HOLD") for s in live_sigs.values()]
    for direction in ("BUY","SELL"):
        if actions.count(direction) >= 3:
            _emit_impulse(abbr, "OPT", direction,
                          sig.get("confidence", .5), "consensus",
                          f"{actions.count(direction)}/9 agents say {direction}")
            break

    agent["last_signal"] = sig
    agent["confidence"]  = round(sig.get("confidence", 0.5) * 100, 1)
    close_price          = float(df["close"].iloc[-1])
    agent["last_trade"]  = f"{sig['action']} {symbol} @ {close_price:.2f}"
    return sig


# ── Accuracy-weighted ensemble vote ──────────────────────────────────────────
def ensemble_vote(signals: dict) -> dict:
    b = s = h = 0.0
    votes = {"BUY": [], "SELL": [], "HOLD": []}
    for abbr, sig in signals.items():
        if "error" in sig: continue
        cfg    = AGENT_CONFIG.get(abbr, {})
        if not cfg.get("enabled", True): continue
        a      = sig.get("action", "HOLD")
        raw_c  = sig.get("confidence", 0.5)
        acc_w  = min(1.5, AGENT_STATE.get(abbr, {}).get("accuracy", 50) / 50)
        user_w = cfg.get("weight", 1.0)
        c      = raw_c * acc_w * user_w
        votes[a].append(abbr)
        if a == "BUY":  b += c
        elif a == "SELL": s += c
        else:           h += c
    total = b + s + h
    if not total:
        return {"action":"HOLD","confidence":0.5,
                "buy_agents":[],"sell_agents":[],"hold_agents":[]}
    bw, sw = b / total, s / total
    if   bw > sw and bw > 0.38: action, conf = "BUY",  bw
    elif sw > bw and sw > 0.38: action, conf = "SELL", sw
    else:                       action, conf = "HOLD", 1 - max(bw, sw)
    return {
        "action": action, "confidence": round(conf, 3),
        "buy_agents": votes["BUY"], "sell_agents": votes["SELL"],
        "hold_agents": votes["HOLD"],
        "buy_pct": round(bw*100,1), "sell_pct": round(sw*100,1),
        "regime": _regime["label"],
        "live_impulses": len(LIVE_IMPULSES),
    }


def _update_equity_history(abbr: str):
    """Keep a rolling 80-point equity history for charts and PDF generation."""
    state = AGENT_STATE.get(abbr)
    if not state:
        return
    hist = state.get("equity_history")
    if not isinstance(hist, list):
        hist = []
    new_v = float(state.get("equity", 100))
    hist.append({"i": len(hist), "v": round(new_v, 4)})
    state["equity_history"] = hist[-80:]
