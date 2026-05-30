"""
Market data — yfinance con timeout hard + synthetic fallback garantito.

Render / cloud: Yahoo Finance blocca le IP datacenter.
Strategia:
  1. Se USE_SYNTHETIC_DATA=true → salta yfinance direttamente
  2. Altrimenti prova yf.download con timeout 8s via signal/threading
  3. Fallback garantito: OHLCV sintetico deterministico (seed dal simbolo)
     → il training NON fallisce MAI per mancanza di dati
"""
import os, time, logging, hashlib, threading
from typing import Optional
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
USE_SYNTHETIC = os.getenv("USE_SYNTHETIC_DATA", "false").lower() == "true"
YF_TIMEOUT    = int(os.getenv("YFINANCE_TIMEOUT", "8"))   # secondi
ENVIRONMENT   = os.getenv("ENVIRONMENT", "development")

HORIZONS = {
    "scalping": {"interval": "5m",  "period": "5d",  "bars": 288},
    "day":      {"interval": "1h",  "period": "60d", "bars": 480},
    "swing":    {"interval": "1d",  "period": "1y",  "bars": 252},
    "position": {"interval": "1wk", "period": "3y",  "bars": 156},
}

BASE_PRICES = {
    "SPY": 480, "QQQ": 432, "AAPL": 189, "MSFT": 415, "NVDA": 840,
    "TSLA": 248, "META": 512, "AMZN": 185, "GLD": 184, "TLT": 96,
    "BTC-USD": 68200, "ETH-USD": 3800, "VIX": 14,
    "IWM": 198, "DIA": 382, "AMD": 168, "INTC": 31, "CRM": 295,
    "ADBE": 465, "JPM": 198, "BAC": 38, "GS": 462, "V": 275,
    "MA": 465, "JNJ": 152, "UNH": 524, "PFE": 28, "XOM": 118,
    "CVX": 158, "WMT": 68, "COST": 788, "MCD": 282, "NKE": 94,
    "HYG": 77, "SLV": 27, "USO": 72, "UVXY": 12,
    "BNB-USD": 580, "SOL-USD": 148, "EEM": 43, "EWJ": 68, "FXI": 25,
}
VOLS = {
    "SPY": 0.011, "QQQ": 0.013, "AAPL": 0.014, "MSFT": 0.013, "NVDA": 0.025,
    "TSLA": 0.030, "META": 0.022, "AMZN": 0.018, "GLD": 0.008, "TLT": 0.007,
    "BTC-USD": 0.035, "ETH-USD": 0.040,
}

_cache: dict = {}
_yf_works: Optional[bool] = None   # None=untested, True=works, False=blocked


def _ttl(horizon): return 60 if horizon in ("scalping", "day") else 300


# ── Thread-safe yfinance call with hard timeout ────────────────────────────────
def _fetch_with_timeout(fn, *args, timeout=YF_TIMEOUT):
    """Run fn(*args) in a thread; return result or None if it exceeds timeout."""
    result    = [None]
    exception = [None]

    def target():
        try:
            result[0] = fn(*args)
        except Exception as e:
            exception[0] = e

    t = threading.Thread(target=target, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        logger.warning(f"yfinance call timed out after {timeout}s — using synthetic data")
        return None
    if exception[0]:
        logger.debug(f"yfinance error: {exception[0]}")
        return None
    return result[0]


def _yf_download(symbol: str, horizon: str) -> Optional[pd.DataFrame]:
    """Try yf.download with a hard timeout."""
    try:
        import yfinance as yf
        cfg = HORIZONS.get(horizon, HORIZONS["swing"])

        def _do():
            df = yf.download(
                symbol,
                period=cfg["period"],
                interval=cfg["interval"],
                progress=False,
                auto_adjust=True,
                threads=False,
            )
            return df

        df = _fetch_with_timeout(_do, timeout=YF_TIMEOUT)
        if df is None or df.empty:
            return None

        df.columns = [c.lower() if isinstance(c, str) else c[0].lower()
                      for c in df.columns]
        if "close" not in df.columns:
            return None
        df = df[["open","high","low","close","volume"]].dropna()
        df.index = pd.to_datetime(df.index, utc=True)
        if len(df) < 20:
            return None
        return df

    except Exception as e:
        logger.debug(f"_yf_download failed: {e}")
        return None


# ── Synthetic OHLCV ────────────────────────────────────────────────────────────
def _synthetic_ohlcv(symbol: str, horizon: str) -> pd.DataFrame:
    """
    Deterministico e realistico — stesso seed per stesso simbolo.
    Sempre disponibile, anche offline / su Render.
    """
    cfg  = HORIZONS.get(horizon, HORIZONS["swing"])
    n    = cfg["bars"]
    seed = int(hashlib.md5(symbol.encode()).hexdigest()[:8], 16) % (2**31)
    rng  = np.random.default_rng(seed)

    base = BASE_PRICES.get(symbol, 100.0)
    vol  = VOLS.get(symbol, 0.015)

    # Random walk con leggero trend positivo + mean reversion
    log_rets = rng.normal(0.0003, vol, n)
    # Aggiungi cicli realistici (momentum + reversion)
    for i in range(1, n):
        log_rets[i] += log_rets[i-1] * 0.05   # momentum
    prices = base * np.exp(np.cumsum(log_rets))
    prices = np.clip(prices, base * 0.2, base * 5.0)

    spread = prices * rng.uniform(0.001, vol * 1.5, n)
    opens  = prices * (1 + rng.normal(0, vol * 0.3, n))
    highs  = np.maximum(prices, opens) + spread
    lows   = np.minimum(prices, opens) - spread
    vols   = np.abs(rng.normal(1_500_000, 600_000, n)).astype(float)

    freq_map = {"scalping": "5min", "day": "h", "swing": "D", "position": "W"}
    freq = freq_map.get(horizon, "D")
    idx  = pd.date_range(end=pd.Timestamp.now(tz="UTC"), periods=n, freq=freq)

    df = pd.DataFrame({
        "open": opens.clip(min=0.01), "high": highs.clip(min=0.01),
        "low":  lows.clip(min=0.01),  "close": prices.clip(min=0.01),
        "volume": vols,
    }, index=idx)

    logger.info(f"[SYNTHETIC] {symbol}/{horizon} — {n} bars (yfinance not available)")
    return df


# ── Public API ────────────────────────────────────────────────────────────────
def get_ohlcv(symbol: str, horizon: str = "swing") -> pd.DataFrame:
    """
    Restituisce SEMPRE un DataFrame valido.
    Ordine di priorità:
      1. Cache (se non scaduta)
      2. Custom CSV caricato dall'utente
      3. yfinance (se non in modalità synthetic e non già noto come bloccato)
      4. Synthetic fallback garantito
    """
    global _yf_works
    key   = f"{symbol}::{horizon}"
    entry = _cache.get(key)
    if entry and (time.time() - entry["ts"]) < _ttl(horizon):
        return entry["df"]

    # 1. Prova CSV caricato dall'utente
    try:
        from services.universe import get_custom_ohlcv
        custom = get_custom_ohlcv(symbol)
        if custom is not None and len(custom) >= 30:
            _cache[key] = {"df": custom, "ts": time.time()}
            logger.info(f"[CSV] {symbol}/{horizon} — {len(custom)} bars")
            return custom
    except Exception:
        pass

    # 2. yfinance (solo se non siamo in modalità synthetic e non già noto come bloccato)
    df = None
    # Skip yfinance on production/Render — datacenter IPs are blocked by Yahoo Finance
    _skip_yf = USE_SYNTHETIC or ENVIRONMENT == "production" or _yf_works is False
    if not _skip_yf:
        df = _yf_download(symbol, horizon)
        if df is not None and len(df) >= 20:
            if _yf_works is None:
                _yf_works = True
                logger.info("yfinance: working ✓")
        else:
            if _yf_works is None:
                # Prima volta che fallisce — segnalo ma non disabilito ancora
                logger.warning(f"yfinance returned no data for {symbol} — switching to synthetic")
                _yf_works = False   # disabilita per questo processo
            df = None

    # 3. Synthetic fallback (sempre)
    if df is None:
        df = _synthetic_ohlcv(symbol, horizon)

    _cache[key] = {"df": df, "ts": time.time()}
    return df


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    c  = df["close"]

    df["sma_20"]       = c.rolling(20).mean()
    df["sma_50"]       = c.rolling(50).mean()
    df["ema_12"]       = c.ewm(span=12, adjust=False).mean()
    df["ema_26"]       = c.ewm(span=26, adjust=False).mean()
    df["macd"]         = df["ema_12"] - df["ema_26"]
    df["signal"]       = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"]    = df["macd"] - df["signal"]

    delta = c.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    df["rsi"]          = 100 - 100 / (1 + gain / (loss + 1e-9))

    df["roc_5"]        = c.pct_change(5)
    df["roc_10"]       = c.pct_change(10)
    df["roc_20"]       = c.pct_change(20)
    df["momentum"]     = c - c.shift(10)

    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - c.shift()).abs(),
        (df["low"]  - c.shift()).abs(),
    ], axis=1).max(axis=1)
    df["atr"]          = tr.rolling(14).mean()

    bb_mid = c.rolling(20).mean()
    bb_std = c.rolling(20).std()
    df["bb_upper"]     = bb_mid + 2 * bb_std
    df["bb_lower"]     = bb_mid - 2 * bb_std
    df["bb_pct"]       = (c - df["bb_lower"]) / (df["bb_upper"] - df["bb_lower"] + 1e-9)
    df["bb_width"]     = (df["bb_upper"] - df["bb_lower"]) / (bb_mid + 1e-9)
    df["vol_ratio"]    = df["volume"] / (df["volume"].rolling(20).mean() + 1)
    df["ret_1"]        = c.pct_change(1)
    df["ret_5"]        = c.pct_change(5)
    df["above_sma50"]  = (c > df["sma_50"]).astype(int)
    df["trend_slope"]  = df["sma_20"].pct_change(5)
    df["z_score_20"]   = (c - c.rolling(20).mean()) / (c.rolling(20).std() + 1e-9)
    df["vol_expansion"]= df["atr"] / (df["atr"].rolling(20).mean() + 1e-9) - 1
    df["gap"]          = (c - c.shift(1)) / (c.shift(1) + 1e-9)
    df["hl_range"]     = (df["high"] - df["low"]) / (c + 1e-9)

    return df.dropna()


def get_live_quote(symbol: str) -> dict:
    """Quote live — se yfinance fallisce usa il prezzo base con noise."""
    if not USE_SYNTHETIC and _yf_works is not False:
        try:
            import yfinance as yf
            def _do():
                info  = yf.Ticker(symbol).fast_info
                price = float(getattr(info, "last_price", 0) or 0)
                prev  = float(getattr(info, "previous_close", price) or price)
                return price, prev
            res = _fetch_with_timeout(_do, timeout=5)
            if res and res[0] > 0:
                price, prev = res
                chg = (price - prev) / prev * 100 if prev else 0
                return {"symbol": symbol, "price": round(price, 4),
                        "change_pct": round(chg, 4), "prev_close": round(prev, 4),
                        "source": "live"}
        except Exception:
            pass

    base  = BASE_PRICES.get(symbol, 100.0)
    noise = float(np.random.uniform(-0.008, 0.008))
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
        pos = ["beat","surge","rally","strong","growth","profit","upgrade","bullish"]
        neg = ["miss","fall","crash","loss","weak","decline","downgrade","bearish"]
        score = sum(
            sum(1 for w in pos if w in h.lower()) -
            sum(1 for w in neg if w in h.lower())
            for h in headlines
        )
        return {"score": float(np.clip(score / max(len(headlines),1) / 3, -1, 1)),
                "headlines": headlines[:5], "source": "newsapi"}
    except Exception as e:
        logger.warning(f"NewsAPI: {e}")
        return {"score": 0.0, "headlines": [], "source": "error"}


def data_source_status() -> dict:
    """Testa yfinance e ritorna lo stato delle sorgenti dati."""
    yf_ok = False
    yf_msg = "not tested"
    if not USE_SYNTHETIC:
        try:
            import yfinance as yf
            def _test():
                df = yf.download("SPY", period="5d", interval="1d",
                                  progress=False, auto_adjust=True, threads=False)
                return df
            result = _fetch_with_timeout(_test, timeout=6)
            yf_ok  = result is not None and not result.empty
            yf_msg = "ok" if yf_ok else "blocked (using synthetic)"
        except Exception as e:
            yf_msg = f"error: {str(e)[:50]}"
    else:
        yf_msg = "disabled (USE_SYNTHETIC_DATA=true)"

    from services.universe import list_custom_uploads
    uploads = list_custom_uploads()

    return {
        "yfinance":       {"ok": yf_ok, "status": yf_msg},
        "synthetic":      {"ok": True,  "status": "always available"},
        "custom_uploads": {"ok": True,  "count": len(uploads), "files": uploads},
        "environment":    ENVIRONMENT,
        "use_synthetic":  USE_SYNTHETIC or not yf_ok,
    }
