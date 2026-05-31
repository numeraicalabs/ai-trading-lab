"""
Price Store — persists OHLCV price history to Supabase Storage.

Architecture:
  1. Local disk cache  (/universe_data/ohlcv/{symbol}_{horizon}.json)
  2. Supabase Storage  (bucket: price-data, path: ohlcv/{symbol}_{horizon}.json)
  3. Supabase table    (price_cache: latest price per symbol, updated on every tick)

On startup: check which symbols have no local cache → restore from Storage.
After fetching: save to local + upload to Storage (background, non-blocking).
The DB table `price_cache` stores only the latest tick per symbol for the UI.
"""
import json, gzip, logging, asyncio
from datetime import datetime, timezone
from pathlib import Path as FilePath

import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

CACHE_DIR    = FilePath(__file__).parent.parent / "universe_data" / "ohlcv"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
BUCKET       = "price-data"
MAX_BARS     = 2000   # keep last 2000 bars per symbol/horizon


# ── Serialise / deserialise ───────────────────────────────────────────────────
def _df_to_json(df: pd.DataFrame) -> bytes:
    """Compact JSON serialisation: {cols, data} gzip-compressed."""
    cols = list(df.columns)
    data = []
    for idx, row in df.iterrows():
        r = [str(idx)] + [round(float(v), 6) if isinstance(v, float) else v
                          for v in row.values]
        data.append(r)
    raw = json.dumps({"cols": cols, "data": data[-MAX_BARS:]}).encode()
    return gzip.compress(raw, compresslevel=6)


def _json_to_df(raw: bytes) -> pd.DataFrame:
    obj  = json.loads(gzip.decompress(raw).decode())
    cols = obj["cols"]
    rows = obj["data"]
    df   = pd.DataFrame([r[1:] for r in rows], columns=cols,
                        index=pd.to_datetime([r[0] for r in rows]))
    df.index.name = "date"
    for c in df.columns:
        try:
            df[c] = pd.to_numeric(df[c])
        except Exception:
            pass
    return df


# ── Local cache ───────────────────────────────────────────────────────────────
def _local_path(symbol: str, horizon: str) -> FilePath:
    return CACHE_DIR / f"{symbol.upper()}_{horizon}.json.gz"


def load_local(symbol: str, horizon: str) -> pd.DataFrame | None:
    p = _local_path(symbol, horizon)
    if not p.exists():
        return None
    try:
        return _json_to_df(p.read_bytes())
    except Exception as e:
        logger.debug(f"local cache read error {symbol}/{horizon}: {e}")
        return None


def save_local(symbol: str, horizon: str, df: pd.DataFrame) -> None:
    try:
        _local_path(symbol, horizon).write_bytes(_df_to_json(df))
    except Exception as e:
        logger.debug(f"local cache write error {symbol}/{horizon}: {e}")


# ── Supabase Storage ──────────────────────────────────────────────────────────
def _storage_key(symbol: str, horizon: str) -> str:
    return f"ohlcv/{symbol.upper()}_{horizon}.json.gz"


def upload_price_history(symbol: str, horizon: str, df: pd.DataFrame) -> bool:
    try:
        from services.db import get_client
        sb = get_client()
        if not sb:
            return False
        raw = _df_to_json(df)
        key = _storage_key(symbol, horizon)
        try:
            sb.storage.from_(BUCKET).remove([key])
        except Exception:
            pass
        sb.storage.from_(BUCKET).upload(
            key, raw, {"content-type": "application/octet-stream"}
        )
        logger.debug(f"Uploaded price history {key} ({len(raw)//1024}kb)")
        return True
    except Exception as e:
        logger.debug(f"upload_price_history {symbol}/{horizon}: {e}")
        return False


def download_price_history(symbol: str, horizon: str) -> pd.DataFrame | None:
    try:
        from services.db import get_client
        sb = get_client()
        if not sb:
            return None
        raw = sb.storage.from_(BUCKET).download(_storage_key(symbol, horizon))
        if raw:
            df = _json_to_df(raw)
            save_local(symbol, horizon, df)
            return df
    except Exception as e:
        logger.debug(f"download_price_history {symbol}/{horizon}: {e}")
    return None


def list_stored_symbols() -> list:
    """Return list of {symbol, horizon} available in Storage."""
    try:
        from services.db import get_client
        sb = get_client()
        if not sb:
            return []
        items = sb.storage.from_(BUCKET).list("ohlcv")
        result = []
        for item in (items or []):
            name = item.get("name", "")
            if name.endswith(".json.gz"):
                parts = name.replace(".json.gz","").split("_")
                if len(parts) == 2:
                    result.append({
                        "symbol":  parts[0],
                        "horizon": parts[1],
                        "key":     f"ohlcv/{name}",
                        "size_kb": round((item.get("metadata",{}).get("size",0))/1024,1),
                    })
        return result
    except Exception as e:
        logger.debug(f"list_stored_symbols: {e}")
        return []


# ── Main entry: get_or_fetch ──────────────────────────────────────────────────
def get_or_fetch(symbol: str, horizon: str,
                 force_refresh: bool = False) -> pd.DataFrame | None:
    """
    Priority:
      1. Local cache (if not force_refresh)
      2. Supabase Storage
      3. yfinance / synthetic
    Always saves back to local + schedules async Storage upload.
    """
    symbol = symbol.upper()

    if not force_refresh:
        df = load_local(symbol, horizon)
        if df is not None and len(df) >= 30:
            return df

    # Try storage
    if not force_refresh:
        df = download_price_history(symbol, horizon)
        if df is not None and len(df) >= 30:
            return df

    # Fetch fresh
    from services.market import get_ohlcv
    df = get_ohlcv(symbol, horizon)
    if df is not None and len(df) >= 20:
        save_local(symbol, horizon, df)
        # Upload to storage in background (non-blocking)
        try:
            loop = asyncio.get_running_loop()
            loop.run_in_executor(None, upload_price_history, symbol, horizon, df)
        except RuntimeError:
            # No running loop (called from sync context)
            upload_price_history(symbol, horizon, df)
    return df


async def get_or_fetch_async(symbol: str, horizon: str,
                             force_refresh: bool = False) -> pd.DataFrame | None:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, get_or_fetch, symbol, horizon, force_refresh)


# ── Bulk prefetch ─────────────────────────────────────────────────────────────
async def prefetch_universe(symbols: list, horizon: str = "swing",
                            max_concurrent: int = 5) -> dict:
    """
    Download and cache OHLCV for all symbols concurrently.
    Returns {symbol: "ok"|"error"|"cached"}.
    """
    sem = asyncio.Semaphore(max_concurrent)
    results = {}

    async def _one(sym):
        async with sem:
            # Check local first
            if _local_path(sym, horizon).exists():
                results[sym] = "cached"
                return
            try:
                df = await get_or_fetch_async(sym, horizon, force_refresh=False)
                results[sym] = "ok" if df is not None and len(df) >= 20 else "no_data"
            except Exception as e:
                results[sym] = f"error: {str(e)[:40]}"

    await asyncio.gather(*[_one(sym) for sym in symbols])
    return results


# ── Latest price cache (DB) ───────────────────────────────────────────────────
def upsert_latest_price(symbol: str, price: float,
                        change_pct: float = 0.0, source: str = "sim") -> None:
    """Update the price_cache table in Supabase with the latest tick."""
    try:
        from services.db import get_client, _safe
        sb = get_client()
        if not sb:
            return
        row = {
            "symbol":      symbol,
            "price":       round(price, 6),
            "change_pct":  round(change_pct, 4),
            "source":      source,
            "updated_at":  datetime.now(timezone.utc).isoformat(),
        }
        _safe(lambda: sb.table("price_cache").upsert(row, on_conflict="symbol").execute(),
              "upsert_price")
    except Exception:
        pass


def bulk_upsert_prices(prices: dict) -> None:
    """Upsert multiple prices at once (called from sim tick)."""
    try:
        from services.db import get_client
        sb = get_client()
        if not sb or not prices:
            return
        rows = [{"symbol": sym, "price": round(float(p), 6),
                 "updated_at": datetime.now(timezone.utc).isoformat()}
                for sym, p in prices.items() if isinstance(p, (int, float))]
        if rows:
            sb.table("price_cache").upsert(rows, on_conflict="symbol").execute()
    except Exception:
        pass


# ── Stats ─────────────────────────────────────────────────────────────────────
def local_cache_stats() -> dict:
    files = list(CACHE_DIR.glob("*.json.gz"))
    total_kb = sum(f.stat().st_size for f in files) // 1024
    by_horizon: dict = {}
    for f in files:
        parts = f.name.replace(".json.gz","").split("_")
        if len(parts) == 2:
            h = parts[1]
            by_horizon[h] = by_horizon.get(h, 0) + 1
    return {
        "total_files":  len(files),
        "total_kb":     total_kb,
        "by_horizon":   by_horizon,
        "cache_dir":    str(CACHE_DIR),
    }
