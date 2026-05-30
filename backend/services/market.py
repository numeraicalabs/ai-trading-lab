"""
Market data service — yfinance + robust cloud fallback.

Render / cloud platforms get blocked by Yahoo Finance (datacenter IPs
receive HTML error pages instead of JSON → "Expecting value: line 1 col 1").

Strategy:
  1. Try yf.download() with a browser User-Agent session
  2. Try yf.Ticker().history() as a second attempt
  3. Fall back to realistic synthetic OHLCV (seeded by symbol) so
     training always succeeds even without internet access.
"""
import os, time, logging, hashlib
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

HORIZONS = {
    "scalping": {"interval": "5m",  "period": "5d",  "bars": 288},
    "day":      {"interval": "1h",  "period": "60d", "bars": 480},
    "swing":    {"interval": "1d",  "period": "1y",  "bars": 252},
    "position": {"interval": "1wk", "period": "3y",  "bars": 156},
}

# Realistic base prices for synthetic fallback
BASE_PRICES = {
    "SPY": 480, "QQQ": 432, "AAPL": 189, "MSFT": 415, "NVDA": 840,
    "TSLA": 248, "META": 512, "AMZN": 185, "GLD": 184, "TLT": 96,
    "BTC-USD": 68200, "ETH-USD": 3800, "VIX": 14,
}
VOLS = {
    "SPY": 0.011, "QQQ": 0.013, "AAPL": 0.014, "MSFT": 0.013, "NVDA": 0.025,
    "TSLA": 0.030, "META": 0.022, "AMZN": 0.018, "GLD": 0.008, "TLT": 0.007,
    "BTC-USD": 0.035, "ETH-USD": 0.040, "VIX": 0.060,
}

_cache: dict = {}

def _ttl(horizon): return 60 if horizon in ("scalping", "day") else 300


# ── yfinance with browser headers ────────────────────────────────────────────
def _yf_session():
    """Create a requests Session that looks like a real browser."""
    try:
        import requests
        s = requests.Session()
        s.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })
        return s
    except Exception:
        return None


def _fetch_yfinance(symbol: str, horizon: str) -> Optional[pd.DataFrame]:
    cfg = HORIZONS.get(horizon, HORIZONS["swing"])
    try:
        import yfinance as yf

        # Attempt 1: yf.download (often more robust on cloud)
        try:
            df = yf.download(
                symbol,
                period=cfg["period"],
                interval=cfg["interval"],
                progress=False,
                auto_adjust=True,
                threads=False,
            )
            if df is not None and not df.empty:
                df.columns = [c.lower() for c in df.columns]
                df = df[["open", "high", "low", "close", "volume"]].dropna()
                df.index = pd.to_datetime(df.index, utc=True)
                return df
        except Exception as e1:
            logger.debug(f"yf.download [{symbol}]: {e1}")

        # Attempt 2: Ticker.history with session
        try:
            sess = _yf_session()
            ticker = yf.Ticker(symbol, session=sess) if sess else yf.Ticker(symbol)
            df = ticker.history(period=cfg["period"], interval=cfg["interval"])
            if df is not None and not df.empty:
                df = df.rename(columns={
                    "Open": "open", "High": "high", "Low": "low",
                    "Close": "close", "Volume": "volume",
                })
                df = df[["open", "high", "low", "close", "volume"]].dropna()
                df.index = pd.to_datetime(df.index, utc=True)
                return df
        except Exception as e2:
            logger.debug(f"Ticker.history [{symbol}]: {e2}")

        return None

    except Exception as e:
        logger.debug(f"yfinance import error: {e}")
        return None


# ── Synthetic OHLCV fallback ─────────────────────────────────────────────────
def _synthetic_ohlcv(symbol: str, horizon: str) -> pd.DataFrame:
    """
    Deterministic realistic OHLCV — seeded from symbol hash so the
    same symbol always produces the same series.  Used when Yahoo
    Finance is unavailable (cloud IP block / offline).
    """
    cfg  = HORIZONS.get(horizon, HORIZONS["swing"])
    n    = cfg["bars"]
    seed = int(hashlib.md5(symbol.encode()).hexdigest()[:8], 16) % (2**31)
    rng  = np.random.default_rng(seed)

    base = BASE_PRICES.get(symbol, 100.0)
    vol  = VOLS.get(symbol, 0.015)

    # Geometric random walk with mild mean reversion
    log_rets = rng.normal(0.0003, vol, n)
    prices   = base * np.exp(np.cumsum(log_rets))
    prices   = np.clip(prices, base * 0.3, base * 3.0)

    # Realistic OHLCV around close
    spread = prices * rng.uniform(0.001, vol * 1.5, n)
    opens  = prices * (1 + rng.normal(0, vol * 0.3, n))
    highs  = np.maximum(prices, opens) + spread
    lows   = np.minimum(prices, opens) - spread
    vols   = np.abs(rng.normal(1_000_000, 500_000, n)).astype(int)

    freq_map = {"scalping": "5min", "day": "h", "swing": "D", "position": "W"}
    freq = freq_map.get(horizon, "D")
    idx  = pd.date_range(end=pd.Timestamp.now(tz="UTC"), periods=n, freq=freq)

    df = pd.DataFrame({
        "open": opens, "high": highs, "low": lows,
        "close": prices, "volume": vols.astype(float),
    }, index=idx)
    logger.info(f"Synthetic OHLCV used for {symbol}/{horizon} ({n} bars)")
    return df


# ── Public API ───────────────────────────────────────────────────────────────
def get_ohlcv(symbol: str, horizon: str = "swing") -> Optional[pd.DataFrame]:
    key   = f"{symbol}::{horizon}"
    entry = _cache.get(key)
    if entry and (time.time() - entry["ts"]) < _ttl(horizon):
        return entry["df"]

    df = _fetch_yfinance(symbol, horizon)
    if df is None or len(df) < 30:
        logger.warning(f"yfinance returned no/few data for {symbol}/{horizon} — using synthetic")
        df = _synthetic_ohlcv(symbol, horizon)

    _cache[key] = {"df": df, "ts": time.time()}
    return df


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    c  = df["close"]

    df["sma_20"]      = c.rolling(20).mean()
    df["sma_50"]      = c.rolling(50).mean()
    df["ema_12"]      = c.ewm(span=12, adjust=False).mean()
    df["ema_26"]      = c.ewm(span=26, adjust=False).mean()
    df["macd"]        = df["ema_12"] - df["ema_26"]
    df["signal"]      = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"]   = df["macd"] - df["signal"]

    delta = c.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    df["rsi"]         = 100 - 100 / (1 + gain / (loss + 1e-9))

    df["roc_5"]       = c.pct_change(5)
    df["roc_10"]      = c.pct_change(10)
    df["roc_20"]      = c.pct_change(20)
    df["momentum"]    = c - c.shift(10)

    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - c.shift()).abs(),
        (df["low"]  - c.shift()).abs(),
    ], axis=1).max(axis=1)
    df["atr"]         = tr.rolling(14).mean()

    bb_mid = c.rolling(20).mean()
    bb_std = c.rolling(20).std()
    df["bb_upper"]    = bb_mid + 2 * bb_std
    df["bb_lower"]    = bb_mid - 2 * bb_std
    df["bb_pct"]      = (c - df["bb_lower"]) / (df["bb_upper"] - df["bb_lower"] + 1e-9)
    df["bb_width"]    = (df["bb_upper"] - df["bb_lower"]) / (bb_mid + 1e-9)
    df["vol_ratio"]   = df["volume"] / (df["volume"].rolling(20).mean() + 1)
    df["ret_1"]       = c.pct_change(1)
    df["ret_5"]       = c.pct_change(5)
    df["above_sma50"] = (c > df["sma_50"]).astype(int)
    df["trend_slope"] = df["sma_20"].pct_change(5)

    # Extra alpha features
    df["z_score_20"]  = (c - c.rolling(20).mean()) / (c.rolling(20).std() + 1e-9)
    df["vol_expansion"] = df["atr"] / (df["atr"].rolling(20).mean() + 1e-9) - 1
    df["gap"]         = (c - c.shift(1)) / (c.shift(1) + 1e-9)
    df["hl_range"]    = (df["high"] - df["low"]) / (c + 1e-9)

    return df.dropna()


def get_live_quote(symbol: str) -> dict:
    try:
        import yfinance as yf
        sess   = _yf_session()
        ticker = yf.Ticker(symbol, session=sess) if sess else yf.Ticker(symbol)
        info   = ticker.fast_info
        price  = float(getattr(info, "last_price", 0) or 0)
        prev   = float(getattr(info, "previous_close", price) or price)
        chg    = (price - prev) / prev * 100 if prev else 0
        if price > 0:
            return {"symbol": symbol, "price": round(price, 4),
                    "change_pct": round(chg, 4), "prev_close": round(prev, 4),
                    "source": "live"}
    except Exception:
        pass
    base  = BASE_PRICES.get(symbol, 100.0)
    noise = np.random.uniform(-0.005, 0.005)
    return {"symbol": symbol, "price": round(base * (1 + noise), 4),
            "change_pct": round(noise * 100, 4), "prev_close": round(base, 4),
            "source": "simulated"}


def get_news_sentiment(symbol: str) -> dict:
    key = os.getenv("NEWS_API_KEY", "")
    if not key:
        score = float(np.random.uniform(-0.3, 0.7))
        return {"score": score, "headlines": [], "source": "simulated"}
    try:
        import requests
        r = requests.get("https://newsapi.org/v2/everything", params={
            "q": symbol.replace("-USD", ""), "apiKey": key,
            "language": "en", "sortBy": "publishedAt", "pageSize": 10,
        }, timeout=8)
        articles  = r.json().get("articles", [])
        headlines = [a["title"] for a in articles[:10] if a.get("title")]
        pos = ["beat", "surge", "rally", "strong", "growth", "profit", "upgrade", "bullish"]
        neg = ["miss", "fall", "crash", "loss", "weak", "decline", "downgrade", "bearish"]
        score = sum(
            sum(1 for w in pos if w in h.lower()) -
            sum(1 for w in neg if w in h.lower())
            for h in headlines
        )
        return {"score": float(np.clip(score / max(len(headlines), 1) / 3, -1, 1)),
                "headlines": headlines[:5], "source": "newsapi"}
    except Exception as e:
        logger.warning(f"NewsAPI: {e}")
        return {"score": 0.0, "headlines": [], "source": "error"}
