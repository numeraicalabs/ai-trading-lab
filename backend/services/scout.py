"""
SCOUT — Senior Trader & Macro Analyst AI Agent

Combina 5 layer di analisi come farebbe un trader senior con 20 anni di esperienza:
  1. TECHNICAL  — momentum, trend, vol, breakout, mean reversion
  2. MACRO      — regime di mercato, correlazione settori, risk-on/off
  3. RELATIVE   — performance relativa vs peers e benchmark
  4. SENTIMENT  — news + positioning + fear/greed
  5. QUALITY    — fondamentali simulati (P/E, growth, profitability proxy)

Output: ranking di stock con thesis qualitativa da Ollama
"""
import asyncio, logging, os, time
from datetime import datetime, timezone
from typing import Optional
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ── Universo di screening ──────────────────────────────────────────────────────
SCREEN_UNIVERSE = {
    "mega_tech":  ["AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA"],
    "growth":     ["AMD","CRM","ADBE","NOW","SNOW","CRWD","PLTR"],
    "value":      ["JPM","BAC","GS","V","MA","BRK-B","WMT","COST"],
    "macro":      ["GLD","TLT","IWM","EEM","XLE","XLF","XLK","UVXY"],
    "crypto":     ["BTC-USD","ETH-USD","SOL-USD"],
}

# Fondamentali simulati (in produzione: rimpiazza con API finanziaria)
FUNDAMENTALS = {
    "AAPL":  {"pe":28,"rev_growth":5,  "margin":25,"debt_eq":1.8,"sector":"Tech"},
    "MSFT":  {"pe":32,"rev_growth":17, "margin":42,"debt_eq":0.4,"sector":"Tech"},
    "NVDA":  {"pe":45,"rev_growth":120,"margin":55,"debt_eq":0.4,"sector":"Semis"},
    "GOOGL": {"pe":23,"rev_growth":15, "margin":27,"debt_eq":0.1,"sector":"Tech"},
    "META":  {"pe":22,"rev_growth":25, "margin":38,"debt_eq":0.2,"sector":"Tech"},
    "AMZN":  {"pe":40,"rev_growth":13, "margin":8, "debt_eq":0.8,"sector":"Tech"},
    "TSLA":  {"pe":50,"rev_growth":2,  "margin":18,"debt_eq":0.2,"sector":"Auto"},
    "AMD":   {"pe":35,"rev_growth":8,  "margin":22,"debt_eq":0.2,"sector":"Semis"},
    "JPM":   {"pe":12,"rev_growth":9,  "margin":35,"debt_eq":1.2,"sector":"Finance"},
    "GLD":   {"pe":0, "rev_growth":0,  "margin":0, "debt_eq":0,  "sector":"Commodity"},
    "TLT":   {"pe":0, "rev_growth":0,  "margin":0, "debt_eq":0,  "sector":"Bonds"},
    "SPY":   {"pe":22,"rev_growth":8,  "margin":20,"debt_eq":0.5,"sector":"ETF"},
    "QQQ":   {"pe":30,"rev_growth":12, "margin":25,"debt_eq":0.4,"sector":"ETF"},
    "IWM":   {"pe":18,"rev_growth":5,  "margin":12,"debt_eq":0.6,"sector":"ETF"},
}

# Cache dei risultati dello screen
_screen_cache: dict = {}
_screen_ts: float   = 0
SCREEN_TTL  = 600   # 10 min


# ── Scoring layer 1: Technical ────────────────────────────────────────────────
def _score_technical(df: pd.DataFrame) -> dict:
    if df is None or len(df) < 30:
        return {"score": 50, "signals": {}}
    c = df["close"]
    signals = {}

    # Momentum
    mom_20  = float(c.pct_change(20).iloc[-1]) * 100
    mom_5   = float(c.pct_change(5).iloc[-1])  * 100
    signals["momentum_20d"] = round(mom_20, 2)
    signals["momentum_5d"]  = round(mom_5, 2)

    # Trend (above SMA)
    sma_50  = float(c.rolling(50).mean().iloc[-1])
    sma_200 = float(c.rolling(min(200, len(c))).mean().iloc[-1])
    above_50  = float(c.iloc[-1]) > sma_50
    above_200 = float(c.iloc[-1]) > sma_200
    signals["above_sma50"]  = above_50
    signals["above_sma200"] = above_200

    # RSI
    delta = c.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    rsi   = float(100 - 100 / (1 + gain / (loss + 1e-9)).iloc[-1])
    signals["rsi"] = round(rsi, 1)

    # BB position
    bb_mid = c.rolling(20).mean()
    bb_std = c.rolling(20).std()
    bb_pct = float(((c - (bb_mid - 2*bb_std)) / (4*bb_std + 1e-9)).iloc[-1])
    signals["bb_pct"] = round(bb_pct, 3)

    # Volume surge
    vol_ratio = float((df["volume"] / df["volume"].rolling(20).mean()).iloc[-1])
    signals["vol_ratio"] = round(vol_ratio, 2)

    # Score composite (0-100)
    score = 50
    score += min(20, max(-20, mom_20 * 0.5))
    score += 10 if above_50 else -10
    score += 5  if above_200 else -5
    score += (rsi - 50) * 0.2
    score += (bb_pct - 0.5) * 10
    score += min(10, (vol_ratio - 1) * 5)
    return {"score": round(np.clip(score, 0, 100), 1), "signals": signals}


# ── Scoring layer 2: Macro context ────────────────────────────────────────────
def _score_macro(symbol: str, regime: str) -> dict:
    f = FUNDAMENTALS.get(symbol, {})
    sector = f.get("sector", "Unknown")

    # Risk-on / risk-off mapping
    RISK_ON  = {"Tech","Semis","Crypto","Growth","Auto"}
    RISK_OFF = {"Bonds","Commodity","Finance"}
    NEUTRAL  = {"ETF","Consumer","Industrial"}

    score = 50
    if regime == "bull":
        score += 15 if sector in RISK_ON else (-10 if sector in RISK_OFF else 0)
    elif regime == "bear":
        score -= 15 if sector in RISK_ON else (-10 if sector in RISK_OFF else 0)
        score += 20 if sector in RISK_OFF else 0

    return {
        "score":  round(np.clip(score, 0, 100), 1),
        "regime": regime,
        "sector": sector,
        "bias":   "risk-on" if sector in RISK_ON else "risk-off" if sector in RISK_OFF else "neutral",
    }


# ── Scoring layer 3: Fundamentals quality ─────────────────────────────────────
def _score_quality(symbol: str) -> dict:
    f = FUNDAMENTALS.get(symbol, {})
    if not f or f.get("pe", 0) == 0:
        return {"score": 50, "signals": {}}

    score = 50
    pe    = f.get("pe", 25)
    rev_g = f.get("rev_growth", 10)
    margin= f.get("margin", 20)
    peg   = pe / max(rev_g, 1)  # PEG ratio proxy

    # PEG < 1 = undervalued growth
    score += 20 if peg < 1 else (10 if peg < 2 else (-10 if peg > 4 else 0))
    # High revenue growth
    score += min(20, rev_g * 0.5)
    # Profitability
    score += min(15, margin * 0.4)
    # Debt
    score -= f.get("debt_eq", 0.5) * 5

    return {
        "score":  round(np.clip(score, 0, 100), 1),
        "signals": {"pe": pe, "rev_growth": rev_g, "margin": margin, "peg": round(peg, 2)},
    }


# ── Scoring layer 4: Relative strength ────────────────────────────────────────
def _score_relative(symbol: str, all_returns: dict) -> dict:
    if not all_returns or symbol not in all_returns:
        return {"score": 50}
    sym_ret    = all_returns.get(symbol, 0)
    sector_rets= list(all_returns.values())
    pct_rank   = float(sum(1 for r in sector_rets if r <= sym_ret) / max(len(sector_rets), 1))
    return {"score": round(pct_rank * 100, 1), "ret_20d": round(sym_ret * 100, 2),
            "rank": f"{int(pct_rank*100)}th percentile"}


# ── Composite scoring ─────────────────────────────────────────────────────────
WEIGHTS = {
    "technical": 0.35,
    "macro":     0.25,
    "quality":   0.20,
    "relative":  0.15,
    "sentiment": 0.05,
}

def _composite(tech, macro, quality, rel, sent=50) -> dict:
    score = (tech["score"] * WEIGHTS["technical"] +
             macro["score"] * WEIGHTS["macro"] +
             quality["score"] * WEIGHTS["quality"] +
             rel["score"]  * WEIGHTS["relative"] +
             sent           * WEIGHTS["sentiment"])
    score = round(np.clip(score, 0, 100), 1)
    conviction = "HIGH" if score >= 70 else "MEDIUM" if score >= 55 else "LOW"
    direction  = "LONG" if score >= 60 else "SHORT" if score <= 40 else "NEUTRAL"
    return {
        "composite": score,
        "conviction": conviction,
        "direction":  direction,
        "breakdown": {
            "technical": tech["score"],
            "macro":     macro["score"],
            "quality":   quality["score"],
            "relative":  rel["score"],
        },
    }


# ── AI narrative (Ollama) ─────────────────────────────────────────────────────
_SCOUT_SYS = """You are SCOUT — a senior portfolio manager and macro analyst with 20 years experience
at a top hedge fund. You analyze stocks with deep conviction and clear reasoning.
Respond in JSON with keys: thesis (2 sentences), catalysts (list of 2-3), risks (list of 2),
timeframe (string), conviction_narrative (1 sentence as if briefing the PM).
Be direct, opinionated, specific. Avoid generic statements."""

async def _generate_thesis(symbol: str, score_data: dict, regime: str) -> dict:
    try:
        import httpx
        base  = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        model = os.getenv("OLLAMA_MODEL", "llama3")

        prompt = (
            f"Stock: {symbol}\n"
            f"Composite Score: {score_data['composite']}/100 ({score_data['conviction']})\n"
            f"Direction: {score_data['direction']}\n"
            f"Market Regime: {regime}\n"
            f"Sector: {FUNDAMENTALS.get(symbol,{}).get('sector','Unknown')}\n"
            f"Technical: {score_data['breakdown']['technical']:.0f}/100, "
            f"Macro: {score_data['breakdown']['macro']:.0f}/100, "
            f"Quality: {score_data['breakdown']['quality']:.0f}/100\n"
            f"Generate investment thesis as senior PM. JSON only."
        )

        async with httpx.AsyncClient(timeout=25.0) as c:
            r = await c.post(f"{base}/api/generate",
                             json={"model": model, "prompt": prompt,
                                   "system": _SCOUT_SYS, "stream": False,
                                   "options": {"temperature": 0.4, "num_predict": 400}})
            text  = r.json().get("response", "").strip()
            clean = text.replace("```json","").replace("```","").strip()
            s, e  = clean.find("{"), clean.rfind("}") + 1
            if s >= 0 and e > s:
                import json
                return json.loads(clean[s:e])
    except Exception as e:
        logger.debug(f"SCOUT Ollama: {e}")

    # Fallback thesis
    f = FUNDAMENTALS.get(symbol, {})
    return {
        "thesis": f"{symbol} ({f.get('sector','')}) shows "
                  f"{'strong' if score_data['composite']>=65 else 'weak'} composite signals "
                  f"in a {regime} regime.",
        "catalysts": ["Technical momentum", "Macro alignment", "Sector rotation"],
        "risks": ["Market regime reversal", "Execution risk"],
        "timeframe": "2-4 weeks (swing)",
        "conviction_narrative": (
            f"{'Adding to position' if score_data['composite']>=70 else 'Monitoring closely'}."
        ),
    }


# ── Full screen run ────────────────────────────────────────────────────────────
async def run_screen(symbols: list = None, horizon: str = "swing",
                     top_n: int = 10, regime: str = "unknown") -> dict:
    """
    Fa lo screening di `symbols` e restituisce i top_n con thesis AI.
    """
    global _screen_cache, _screen_ts

    if not symbols:
        symbols = []
        for s in SCREEN_UNIVERSE.values():
            symbols.extend(s)
        symbols = list(dict.fromkeys(symbols))  # deduplicate

    from services.market import get_ohlcv, add_indicators

    loop = asyncio.get_event_loop()

    # Raccogli dati per tutti i simboli
    dfs: dict = {}
    for sym in symbols[:30]:  # cap a 30 per performance
        try:
            df_raw = await loop.run_in_executor(None, get_ohlcv, sym, horizon)
            if df_raw is not None and len(df_raw) >= 30:
                dfs[sym] = await loop.run_in_executor(None, add_indicators, df_raw)
        except Exception:
            pass

    # Calcola ritorni 20d per relative strength
    returns_20d = {}
    for sym, df in dfs.items():
        try:
            returns_20d[sym] = float(df["close"].pct_change(20).iloc[-1])
        except Exception:
            pass

    # Scoreboard
    picks = []
    for sym in symbols[:30]:
        df = dfs.get(sym)
        tech     = _score_technical(df)
        macro    = _score_macro(sym, regime)
        quality  = _score_quality(sym)
        relative = _score_relative(sym, returns_20d)
        comp     = _composite(tech, macro, quality, relative)

        picks.append({
            "symbol":    sym,
            "name":      FUNDAMENTALS.get(sym, {}).get("sector", ""),
            "sector":    FUNDAMENTALS.get(sym, {}).get("sector", "Unknown"),
            **comp,
            "technical_signals": tech.get("signals", {}),
            "fundamental":       FUNDAMENTALS.get(sym, {}),
            "relative":          relative,
        })

    # Sort by composite score
    longs  = sorted([p for p in picks if p["direction"]  == "LONG"],
                    key=lambda x: -x["composite"])[:top_n]
    shorts = sorted([p for p in picks if p["direction"] == "SHORT"],
                    key=lambda x:  x["composite"])[:3]
    neutral= [p for p in picks if p["direction"] == "NEUTRAL"][:3]

    # Generate AI thesis for top picks (async)
    for pick in (longs[:5] + shorts[:2]):
        pick["thesis"] = await _generate_thesis(pick["symbol"], pick, regime)
        await asyncio.sleep(0.1)

    result = {
        "ts":          datetime.now(timezone.utc).isoformat(),
        "regime":      regime,
        "horizon":     horizon,
        "screened":    len(picks),
        "longs":       longs,
        "shorts":      shorts,
        "neutral":     neutral,
        "top_long":    longs[0]["symbol"]  if longs  else None,
        "top_short":   shorts[0]["symbol"] if shorts else None,
    }

    _screen_cache = result
    _screen_ts    = time.time()
    # Persist to Supabase
    try:
        from services.db import save_scout_screen
        save_scout_screen(result)
    except Exception:
        pass
    return result


def get_cached_screen() -> Optional[dict]:
    if _screen_cache and (time.time() - _screen_ts) < SCREEN_TTL:
        return _screen_cache
    return None


# ── SCOUT background loop ─────────────────────────────────────────────────────
async def scout_loop():
    """Esegue lo screen automaticamente ogni ora."""
    await asyncio.sleep(120)   # aspetta 2 min al boot
    logger.info("SCOUT agent loop started")

    from services.agents import get_regime

    while True:
        try:
            regime = get_regime().get("label", "unknown")
            result = await run_screen(regime=regime)
            logger.info(
                f"SCOUT screen: {result['screened']} symbols — "
                f"top long: {result.get('top_long')} | "
                f"top short: {result.get('top_short')}"
            )
        except Exception as e:
            logger.error(f"SCOUT loop error: {e}")
        await asyncio.sleep(3600)  # ogni ora
