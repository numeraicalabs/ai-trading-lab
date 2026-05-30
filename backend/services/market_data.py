"""Market Data — yfinance primary (no key needed), Alpha Vantage optional."""
import os, time, logging
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

HORIZON_CONFIG = {
    "scalping": {"interval": "5m",  "period": "5d"},
    "day":      {"interval": "1h",  "period": "60d"},
    "swing":    {"interval": "1d",  "period": "1y"},
    "position": {"interval": "1wk", "period": "5y"},
}
_CACHE = {}

def _key(sym, h): return f"{sym}::{h}"
def _ttl(h): return 60 if h in ("scalping","day") else 300
def _fresh(k, ttl): e=_CACHE.get(k); return e and (time.time()-e["ts"])<ttl

def fetch_yfinance(symbol, horizon="swing"):
    cfg = HORIZON_CONFIG.get(horizon, HORIZON_CONFIG["swing"])
    try:
        import yfinance as yf
        df = yf.Ticker(symbol).history(period=cfg["period"], interval=cfg["interval"])
        if df.empty: return None
        df = df.rename(columns={"Open":"open","High":"high","Low":"low","Close":"close","Volume":"volume"})
        df = df[["open","high","low","close","volume"]].dropna()
        df.index = pd.to_datetime(df.index, utc=True)
        return df
    except Exception as e:
        logger.warning(f"yfinance [{symbol}]: {e}")
        return None

def get_ohlcv(symbol, horizon="swing"):
    k = _key(symbol, horizon)
    if _fresh(k, _ttl(horizon)):
        return _CACHE[k]["df"]
    df = fetch_yfinance(symbol, horizon)
    if df is not None and not df.empty:
        _CACHE[k] = {"df": df, "ts": time.time()}
    return df

def add_indicators(df):
    df = df.copy()
    c = df["close"]
    df["sma_20"]  = c.rolling(20).mean()
    df["sma_50"]  = c.rolling(50).mean()
    df["ema_12"]  = c.ewm(span=12, adjust=False).mean()
    df["ema_26"]  = c.ewm(span=26, adjust=False).mean()
    df["macd"]    = df["ema_12"] - df["ema_26"]
    df["signal"]  = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"] = df["macd"] - df["signal"]
    delta = c.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    df["rsi"] = 100 - 100/(1+gain/(loss+1e-9))
    df["roc_5"]  = c.pct_change(5)
    df["roc_10"] = c.pct_change(10)
    df["roc_20"] = c.pct_change(20)
    df["momentum"] = c - c.shift(10)
    tr = pd.concat([df["high"]-df["low"],(df["high"]-c.shift()).abs(),(df["low"]-c.shift()).abs()],axis=1).max(axis=1)
    df["atr"] = tr.rolling(14).mean()
    bb_mid = c.rolling(20).mean(); bb_std = c.rolling(20).std()
    df["bb_upper"] = bb_mid + 2*bb_std; df["bb_lower"] = bb_mid - 2*bb_std
    df["bb_pct"] = (c-df["bb_lower"])/(df["bb_upper"]-df["bb_lower"]+1e-9)
    df["bb_width"] = (df["bb_upper"]-df["bb_lower"])/(bb_mid+1e-9)
    df["vol_ratio"] = df["volume"]/(df["volume"].rolling(20).mean()+1)
    df["ret_1"] = c.pct_change(1); df["ret_5"] = c.pct_change(5)
    df["above_sma50"] = (c>df["sma_50"]).astype(int)
    df["trend_slope"] = df["sma_20"].pct_change(5)
    return df.dropna()

def get_news_sentiment(symbol):
    key = os.getenv("NEWS_API_KEY","")
    if not key:
        return {"score": float(np.random.uniform(-0.2,0.6)), "headlines":[], "source":"simulated"}
    try:
        import requests
        r = requests.get("https://newsapi.org/v2/everything", params={
            "q": symbol.replace("-USD",""), "apiKey": key,
            "language":"en","sortBy":"publishedAt","pageSize":10
        }, timeout=8)
        articles = r.json().get("articles",[])
        headlines = [a["title"] for a in articles[:10] if a.get("title")]
        pos = ["beat","surge","rally","strong","growth","profit","upgrade","bullish"]
        neg = ["miss","fall","crash","loss","weak","decline","downgrade","bearish"]
        score = 0.0
        for h in headlines:
            hl = h.lower()
            score += sum(1 for w in pos if w in hl) - sum(1 for w in neg if w in hl)
        return {"score": float(np.clip(score/max(len(headlines),1)/3,-1,1)), "headlines":headlines[:5], "source":"newsapi"}
    except Exception as e:
        logger.warning(f"NewsAPI: {e}")
        return {"score":0.0,"headlines":[],"source":"error"}

def get_live_quote(symbol):
    try:
        import yfinance as yf
        info = yf.Ticker(symbol).fast_info
        price = float(getattr(info,"last_price",0) or 0)
        prev  = float(getattr(info,"previous_close",price) or price)
        chg   = (price-prev)/prev*100 if prev else 0
        return {"symbol":symbol,"price":round(price,4),"change_pct":round(chg,4),"prev_close":round(prev,4)}
    except:
        return {"symbol":symbol,"price":0.0,"change_pct":0.0,"prev_close":0.0}
