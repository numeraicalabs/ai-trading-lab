"""
Market Data Service
- Primary:  yfinance (FREE, no key required)
- Secondary: Alpha Vantage (optional, free key from alphavantage.co)
- News:     NewsAPI (optional, free key from newsapi.org)

Time horizons supported:
  scalping   → 1m / 5m bars  (intraday, last 7 days)
  day        → 15m / 1h bars (intraday, last 60 days)
  swing      → 1d bars       (last 1 year)
  position   → 1wk bars      (last 5 years)
"""

import os
import time
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ── Time-horizon config ───────────────────────────────────────────────────────
HORIZON_CONFIG = {
    "scalping": {"interval": "5m",  "period": "7d",  "label": "Scalping (5m)"},
    "day":      {"interval": "1h",  "period": "60d", "label": "Day Trading (1h)"},
    "swing":    {"interval": "1d",  "period": "1y",  "label": "Swing Trading (1d)"},
    "position": {"interval": "1wk", "period": "5y",  "label": "Position (1wk)"},
}

# Simple in-memory cache (TTL: 60s for intraday, 300s for daily+)
_CACHE: dict = {}

def _cache_key(symbol: str, horizon: str) -> str:
    return f"{symbol}::{horizon}"

def _cache_ttl(horizon: str) -> int:
    return 60 if horizon in ("scalping", "day") else 300

def _is_fresh(key: str, ttl: int) -> bool:
    entry = _CACHE.get(key)
    return entry is not None and (time.time() - entry["ts"]) < ttl

# ── yfinance (primary, no key needed) ────────────────────────────────────────
def fetch_ohlcv_yfinance(symbol: str, horizon: str = "swing") -> Optional[pd.DataFrame]:
    """Fetch OHLCV using yfinance — no API key required."""
    cfg = HORIZON_CONFIG.get(horizon, HORIZON_CONFIG["swing"])
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=cfg["period"], interval=cfg["interval"])
        if df.empty:
            return None
        df = df.rename(columns={"Open":"open","High":"high","Low":"low","Close":"close","Volume":"volume"})
        df = df[["open","high","low","close","volume"]].dropna()
        df.index = pd.to_datetime(df.index, utc=True)
        return df
    except Exception as e:
        logger.warning(f"yfinance error [{symbol}]: {e}")
        return None

# ── Alpha Vantage (optional, free key at alphavantage.co) ─────────────────────
def fetch_ohlcv_alphavantage(symbol: str, horizon: str = "swing") -> Optional[pd.DataFrame]:
    """Fetch daily OHLCV from Alpha Vantage (requires free API key)."""
    key = os.getenv("ALPHA_VANTAGE_KEY", "")
    if not key or key == "demo":
        return None

    import requests
    func = "TIME_SERIES_INTRADAY" if horizon in ("scalping","day") else "TIME_SERIES_DAILY_ADJUSTED"
    interval_map = {"scalping":"5min","day":"60min"}
    params = {
        "function": func,
        "symbol": symbol,
        "apikey": key,
        "outputsize": "full",
        "datatype": "json",
    }
    if horizon in ("scalping","day"):
        params["interval"] = interval_map.get(horizon,"60min")

    try:
        resp = requests.get("https://www.alphavantage.co/query", params=params, timeout=10)
        data = resp.json()
        ts_key = [k for k in data if "Time Series" in k]
        if not ts_key:
            return None
        series = data[ts_key[0]]
        rows = []
        for dt_str, vals in series.items():
            rows.append({
                "datetime": pd.to_datetime(dt_str, utc=True),
                "open":   float(vals.get("1. open", vals.get("1. open",0))),
                "high":   float(vals.get("2. high",0)),
                "low":    float(vals.get("3. low",0)),
                "close":  float(vals.get("4. close", vals.get("5. adjusted close",0))),
                "volume": float(vals.get("5. volume", vals.get("6. volume",0))),
            })
        df = pd.DataFrame(rows).set_index("datetime").sort_index()
        return df
    except Exception as e:
        logger.warning(f"AlphaVantage error [{symbol}]: {e}")
        return None

# ── Polygon.io (optional, free key at polygon.io) ─────────────────────────────
def fetch_ohlcv_polygon(symbol: str, horizon: str = "swing") -> Optional[pd.DataFrame]:
    """Fetch from Polygon.io (requires free API key)."""
    key = os.getenv("POLYGON_KEY", "")
    if not key:
        return None

    import requests
    mult_map  = {"scalping":5,"day":60,"swing":1,"position":7}
    span_map  = {"scalping":"minute","day":"minute","swing":"day","position":"day"}
    mult  = mult_map.get(horizon,1)
    span  = span_map.get(horizon,"day")
    end   = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    delta = {"scalping":7,"day":60,"swing":365,"position":1825}
    start = (datetime.now(timezone.utc) - timedelta(days=delta[horizon])).strftime("%Y-%m-%d")

    url = f"https://api.polygon.io/v2/aggs/ticker/{symbol}/range/{mult}/{span}/{start}/{end}"
    try:
        resp = requests.get(url, params={"apiKey": key, "limit":50000}, timeout=10)
        data = resp.json()
        if data.get("status") != "OK" or not data.get("results"):
            return None
        rows = [{"datetime":pd.to_datetime(r["t"],unit="ms",utc=True),"open":r["o"],"high":r["h"],"low":r["l"],"close":r["c"],"volume":r["v"]} for r in data["results"]]
        return pd.DataFrame(rows).set_index("datetime").sort_index()
    except Exception as e:
        logger.warning(f"Polygon error [{symbol}]: {e}")
        return None

# ── Primary fetch with fallback chain ─────────────────────────────────────────
def get_ohlcv(symbol: str, horizon: str = "swing") -> Optional[pd.DataFrame]:
    """
    Returns OHLCV DataFrame.
    Tries: yfinance → Alpha Vantage → Polygon → None
    Results are cached per symbol+horizon.
    """
    key = _cache_key(symbol, horizon)
    ttl = _cache_ttl(horizon)
    if _is_fresh(key, ttl):
        return _CACHE[key]["df"]

    df = (
        fetch_ohlcv_yfinance(symbol, horizon) or
        fetch_ohlcv_alphavantage(symbol, horizon) or
        fetch_ohlcv_polygon(symbol, horizon)
    )
    if df is not None and not df.empty:
        _CACHE[key] = {"df": df, "ts": time.time()}
    return df

# ── Technical indicators ──────────────────────────────────────────────────────
def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Add a rich set of TA features to an OHLCV DataFrame."""
    df = df.copy()
    c = df["close"]

    # Trend
    df["sma_10"]  = c.rolling(10).mean()
    df["sma_20"]  = c.rolling(20).mean()
    df["sma_50"]  = c.rolling(50).mean()
    df["ema_12"]  = c.ewm(span=12, adjust=False).mean()
    df["ema_26"]  = c.ewm(span=26, adjust=False).mean()
    df["macd"]    = df["ema_12"] - df["ema_26"]
    df["signal"]  = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"]= df["macd"] - df["signal"]

    # Momentum
    df["rsi"] = _rsi(c, 14)
    df["roc_5"]  = c.pct_change(5)
    df["roc_10"] = c.pct_change(10)
    df["roc_20"] = c.pct_change(20)
    df["momentum"] = c - c.shift(10)

    # Volatility
    df["atr"] = _atr(df, 14)
    bb_mid   = c.rolling(20).mean()
    bb_std   = c.rolling(20).std()
    df["bb_upper"] = bb_mid + 2 * bb_std
    df["bb_lower"] = bb_mid - 2 * bb_std
    df["bb_width"] = (df["bb_upper"] - df["bb_lower"]) / bb_mid
    df["bb_pct"]   = (c - df["bb_lower"]) / (df["bb_upper"] - df["bb_lower"] + 1e-9)

    # Volume
    df["vol_sma_20"] = df["volume"].rolling(20).mean()
    df["vol_ratio"]  = df["volume"] / (df["vol_sma_20"] + 1)

    # Returns
    df["ret_1"]  = c.pct_change(1)
    df["ret_5"]  = c.pct_change(5)
    df["ret_20"] = c.pct_change(20)

    # Regime
    df["above_sma50"] = (c > df["sma_50"]).astype(int)
    df["trend_slope"] = df["sma_20"].pct_change(5)

    return df.dropna()

def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain  = delta.clip(lower=0).rolling(period).mean()
    loss  = (-delta.clip(upper=0)).rolling(period).mean()
    rs    = gain / (loss + 1e-9)
    return 100 - 100 / (1 + rs)

def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - df["close"].shift()).abs(),
        (df["low"]  - df["close"].shift()).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period).mean()

# ── News sentiment (NewsAPI — optional free key) ───────────────────────────────
def get_news_sentiment(symbol: str) -> dict:
    """
    Fetch recent headlines and score sentiment.
    Returns: {score: float, headlines: list[str], source: str}
    """
    key = os.getenv("NEWS_API_KEY", "")
    if not key:
        # Fallback: random plausible score
        return {"score": float(np.random.uniform(-0.2, 0.6)), "headlines": [], "source": "simulated"}

    import requests
    try:
        resp = requests.get("https://newsapi.org/v2/everything", params={
            "q": symbol.replace("-USD","").replace("-",""),
            "apiKey": key,
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": 10,
        }, timeout=8)
        articles = resp.json().get("articles", [])
        headlines = [a["title"] for a in articles[:10] if a.get("title")]
        score = _score_headlines(headlines)
        return {"score": score, "headlines": headlines[:5], "source": "newsapi"}
    except Exception as e:
        logger.warning(f"NewsAPI error: {e}")
        return {"score": 0.0, "headlines": [], "source": "error"}

def _score_headlines(headlines: list[str]) -> float:
    """Keyword-based sentiment score [-1, +1]."""
    pos = ["beat","record","surge","rally","strong","growth","profit","upgrade","buy","bullish","positive"]
    neg = ["miss","fall","crash","loss","weak","decline","downgrade","sell","bearish","negative","concern","risk"]
    score = 0.0
    n = 0
    for h in headlines:
        h_lower = h.lower()
        p = sum(1 for w in pos if w in h_lower)
        n_neg = sum(1 for w in neg if w in h_lower)
        score += (p - n_neg)
        n += 1
    return float(np.clip(score / max(n, 1) / 3, -1, 1))

# ── Live quote ────────────────────────────────────────────────────────────────
def get_live_quote(symbol: str) -> dict:
    """Get latest price + basic info for a symbol."""
    try:
        import yfinance as yf
        t = yf.Ticker(symbol)
        info = t.fast_info
        price = float(getattr(info, "last_price", 0) or 0)
        prev  = float(getattr(info, "previous_close", price) or price)
        chg   = ((price - prev) / prev * 100) if prev else 0
        return {
            "symbol": symbol,
            "price": round(price, 4),
            "change_pct": round(chg, 4),
            "prev_close": round(prev, 4),
            "volume": int(getattr(info, "three_month_average_volume", 0) or 0),
        }
    except Exception:
        return {"symbol": symbol, "price": 0.0, "change_pct": 0.0, "prev_close": 0.0, "volume": 0}
