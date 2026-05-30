"""
Symbol Universe — manages the list of stocks used for training + backtesting.

Features:
  - Default universe of 60 liquid symbols across sectors
  - Add / remove symbols
  - Upload OHLCV CSV (any format auto-detected)
  - Per-symbol metadata: sector, description
  - Persistence in a JSON file (survives restarts)
"""
import json, logging
from pathlib import Path
from io import StringIO
from typing import Optional

import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

DATA_DIR    = Path(__file__).parent.parent / "universe_data"
UNIVERSE_FILE = DATA_DIR / "universe.json"
CUSTOM_DIR  = DATA_DIR / "custom_csv"

DATA_DIR.mkdir(exist_ok=True)
CUSTOM_DIR.mkdir(exist_ok=True)

# ── Default universe ──────────────────────────────────────────────────────────
DEFAULT_UNIVERSE = {
    # US Large Cap
    "SPY":  {"name": "S&P 500 ETF",          "sector": "ETF",        "type": "etf"},
    "QQQ":  {"name": "Nasdaq 100 ETF",        "sector": "ETF",        "type": "etf"},
    "IWM":  {"name": "Russell 2000 ETF",      "sector": "ETF",        "type": "etf"},
    "DIA":  {"name": "Dow Jones ETF",         "sector": "ETF",        "type": "etf"},
    # Tech
    "AAPL": {"name": "Apple",                 "sector": "Technology", "type": "stock"},
    "MSFT": {"name": "Microsoft",             "sector": "Technology", "type": "stock"},
    "NVDA": {"name": "Nvidia",                "sector": "Technology", "type": "stock"},
    "GOOGL":{"name": "Alphabet",              "sector": "Technology", "type": "stock"},
    "META": {"name": "Meta Platforms",        "sector": "Technology", "type": "stock"},
    "AMZN": {"name": "Amazon",                "sector": "Technology", "type": "stock"},
    "TSLA": {"name": "Tesla",                 "sector": "Tech/Auto",  "type": "stock"},
    "AMD":  {"name": "Advanced Micro Devices","sector": "Technology", "type": "stock"},
    "INTC": {"name": "Intel",                 "sector": "Technology", "type": "stock"},
    "CRM":  {"name": "Salesforce",            "sector": "Technology", "type": "stock"},
    "ADBE": {"name": "Adobe",                 "sector": "Technology", "type": "stock"},
    # Finance
    "JPM":  {"name": "JPMorgan Chase",        "sector": "Finance",    "type": "stock"},
    "BAC":  {"name": "Bank of America",       "sector": "Finance",    "type": "stock"},
    "GS":   {"name": "Goldman Sachs",         "sector": "Finance",    "type": "stock"},
    "V":    {"name": "Visa",                  "sector": "Finance",    "type": "stock"},
    "MA":   {"name": "Mastercard",            "sector": "Finance",    "type": "stock"},
    "BRK-B":{"name": "Berkshire Hathaway B",  "sector": "Finance",    "type": "stock"},
    # Healthcare
    "JNJ":  {"name": "Johnson & Johnson",     "sector": "Healthcare", "type": "stock"},
    "UNH":  {"name": "UnitedHealth",          "sector": "Healthcare", "type": "stock"},
    "PFE":  {"name": "Pfizer",                "sector": "Healthcare", "type": "stock"},
    "ABBV": {"name": "AbbVie",                "sector": "Healthcare", "type": "stock"},
    # Energy
    "XOM":  {"name": "ExxonMobil",            "sector": "Energy",     "type": "stock"},
    "CVX":  {"name": "Chevron",               "sector": "Energy",     "type": "stock"},
    "XLE":  {"name": "Energy Select ETF",     "sector": "ETF",        "type": "etf"},
    # Consumer
    "WMT":  {"name": "Walmart",               "sector": "Consumer",   "type": "stock"},
    "COST": {"name": "Costco",                "sector": "Consumer",   "type": "stock"},
    "MCD":  {"name": "McDonald's",            "sector": "Consumer",   "type": "stock"},
    "NKE":  {"name": "Nike",                  "sector": "Consumer",   "type": "stock"},
    # Industrial
    "CAT":  {"name": "Caterpillar",           "sector": "Industrial", "type": "stock"},
    "BA":   {"name": "Boeing",                "sector": "Industrial", "type": "stock"},
    "GE":   {"name": "GE Aerospace",          "sector": "Industrial", "type": "stock"},
    # Bonds / Macro
    "TLT":  {"name": "20Y Treasury ETF",      "sector": "Bonds",      "type": "etf"},
    "HYG":  {"name": "High Yield Bond ETF",   "sector": "Bonds",      "type": "etf"},
    "GLD":  {"name": "Gold ETF",              "sector": "Commodities","type": "etf"},
    "SLV":  {"name": "Silver ETF",            "sector": "Commodities","type": "etf"},
    "USO":  {"name": "Oil ETF",               "sector": "Commodities","type": "etf"},
    # Volatility
    "VIX":  {"name": "CBOE Volatility Index", "sector": "Volatility", "type": "index"},
    "UVXY": {"name": "ProShares Ultra VIX",   "sector": "Volatility", "type": "etf"},
    # Crypto
    "BTC-USD": {"name": "Bitcoin",            "sector": "Crypto",     "type": "crypto"},
    "ETH-USD": {"name": "Ethereum",           "sector": "Crypto",     "type": "crypto"},
    "BNB-USD": {"name": "Binance Coin",       "sector": "Crypto",     "type": "crypto"},
    "SOL-USD": {"name": "Solana",             "sector": "Crypto",     "type": "crypto"},
    # International ETFs
    "EEM":  {"name": "Emerging Markets ETF",  "sector": "ETF",        "type": "etf"},
    "EWJ":  {"name": "Japan ETF",             "sector": "ETF",        "type": "etf"},
    "FXI":  {"name": "China Large Cap ETF",   "sector": "ETF",        "type": "etf"},
}

# ── Persistence ───────────────────────────────────────────────────────────────
_universe: dict = {}

def _load():
    global _universe
    if UNIVERSE_FILE.exists():
        try:
            _universe = json.loads(UNIVERSE_FILE.read_text())
            return
        except Exception:
            pass
    _universe = dict(DEFAULT_UNIVERSE)
    _save()

def _save():
    UNIVERSE_FILE.write_text(json.dumps(_universe, indent=2))

_load()

# ── API ───────────────────────────────────────────────────────────────────────
def get_universe() -> dict:
    return dict(_universe)

def get_symbols(sector: Optional[str] = None, typ: Optional[str] = None) -> list:
    return [
        {"symbol": sym, **meta}
        for sym, meta in _universe.items()
        if (sector is None or meta.get("sector") == sector)
        and (typ is None or meta.get("type") == typ)
    ]

def add_symbol(symbol: str, name: str = "", sector: str = "Custom",
               typ: str = "stock") -> dict:
    sym = symbol.upper().strip()
    _universe[sym] = {"name": name or sym, "sector": sector, "type": typ, "custom": True}
    _save()
    return _universe[sym]

def remove_symbol(symbol: str) -> bool:
    sym = symbol.upper()
    if sym in _universe:
        del _universe[sym]
        _save()
        return True
    return False

def list_sectors() -> list:
    return sorted(set(m["sector"] for m in _universe.values()))

def symbols_for_agent(abbr: str) -> list:
    """Return symbols relevant for a given agent strategy."""
    AGENT_UNIVERSE = {
        "MOM": ["SPY","QQQ","AAPL","MSFT","NVDA","AMZN","GOOGL","META"],
        "MRV": ["SPY","GLD","TLT","QQQ","IWM","HYG"],
        "PPO": ["QQQ","NVDA","AMD","TSLA","AAPL"],
        "DQN": ["NVDA","TSLA","AMD","META","AMZN"],
        "MAC": ["GLD","TLT","SLV","USO","EEM","EWJ"],
        "SEN": ["TSLA","META","AMZN","AAPL","NVDA","GOOGL"],
        "VOL": ["SPY","QQQ","UVXY","IWM"],
        "REG": ["SPY","TLT","GLD","IWM"],
        "OPT": ["SPY","GLD","TLT","QQQ","IWM"],
    }
    return [s for s in AGENT_UNIVERSE.get(abbr, ["SPY"]) if s in _universe]


# ── CSV upload + parsing ──────────────────────────────────────────────────────
REQUIRED_COLS = {"close"}
OHLCV_COLS    = {"open", "high", "low", "close", "volume"}
DATE_NAMES    = {"date","datetime","timestamp","time","Date","DateTime","Timestamp"}

def parse_uploaded_csv(content: str, symbol: str) -> dict:
    """
    Parse a user-uploaded CSV into a standard OHLCV DataFrame.
    Auto-detects column names, date formats, separators.

    Returns {"df": df, "symbol": symbol, "rows": n, "columns": [...], "source": "csv"}
    """
    symbol = symbol.upper().strip()
    errors = []

    # Try different separators
    df = None
    for sep in [",", ";", "\t", "|"]:
        try:
            candidate = pd.read_csv(StringIO(content), sep=sep)
            if len(candidate.columns) >= 2:
                df = candidate
                break
        except Exception:
            continue

    if df is None or df.empty:
        return {"error": "Could not parse CSV — check separator and format"}

    # Normalise column names
    df.columns = [c.strip().lower().replace(" ", "_").replace("-","_") for c in df.columns]

    # Find date column
    date_col = None
    for dc in ["date","datetime","timestamp","time","index","period"]:
        if dc in df.columns:
            date_col = dc
            break
    if date_col is None and df.columns[0] not in OHLCV_COLS:
        date_col = df.columns[0]   # assume first column is date

    # Parse dates
    if date_col:
        try:
            df.index = pd.to_datetime(df[date_col], utc=True, infer_datetime_format=True)
            df = df.drop(columns=[date_col])
        except Exception as e:
            errors.append(f"Date parse warning: {e}")

    df = df.sort_index()

    # Map common column aliases
    ALIASES = {
        "open":   ["open","o","open_price","op"],
        "high":   ["high","h","high_price","hi"],
        "low":    ["low","l","low_price","lo"],
        "close":  ["close","c","close_price","cl","adj_close","adjclose","adj close","last"],
        "volume": ["volume","v","vol","qty"],
    }
    for std, alts in ALIASES.items():
        if std not in df.columns:
            for alt in alts:
                if alt in df.columns:
                    df = df.rename(columns={alt: std})
                    break

    missing = REQUIRED_COLS - set(df.columns)
    if missing:
        return {"error": f"Missing required columns: {missing}. Found: {list(df.columns)}"}

    # Fill missing OHLCV columns from close
    for col in ["open","high","low"]:
        if col not in df.columns:
            df[col] = df["close"]
    if "volume" not in df.columns:
        df["volume"] = 0.0

    df = df[["open","high","low","close","volume"]].apply(pd.to_numeric, errors="coerce")
    df = df.dropna(subset=["close"])

    if len(df) < 30:
        return {"error": f"Too few rows after parsing: {len(df)} (need ≥30)"}

    # Save to disk for reuse in training
    out_path = CUSTOM_DIR / f"{symbol}.csv"
    df.to_csv(out_path)

    # Register in universe if not already present
    if symbol not in _universe:
        _universe[symbol] = {"name": f"{symbol} (uploaded)", "sector": "Custom",
                              "type": "custom", "custom": True}
        _save()

    return {
        "symbol":   symbol,
        "rows":     len(df),
        "columns":  list(df.columns),
        "date_from":str(df.index[0]),
        "date_to":  str(df.index[-1]),
        "source":   "csv",
        "saved_to": str(out_path),
        "errors":   errors,
        "preview":  df.tail(5).round(4).reset_index().to_dict("records"),
    }

def get_custom_ohlcv(symbol: str) -> Optional[pd.DataFrame]:
    """Load a previously uploaded CSV for a symbol."""
    p = CUSTOM_DIR / f"{symbol.upper()}.csv"
    if not p.exists():
        return None
    try:
        df = pd.read_csv(p, index_col=0, parse_dates=True)
        df.index = pd.to_datetime(df.index, utc=True)
        return df
    except Exception:
        return None

def list_custom_uploads() -> list:
    return [
        {"symbol": p.stem, "file": p.name,
         "size_kb": round(p.stat().st_size / 1024, 1),
         "modified": pd.Timestamp(p.stat().st_mtime, unit="s").isoformat()}
        for p in sorted(CUSTOM_DIR.glob("*.csv"))
    ]
