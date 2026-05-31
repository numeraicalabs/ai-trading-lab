"""
Supabase DB — singleton client, health check, save helpers.
Best-effort: non solleva eccezioni se il DB non è disponibile.
Usa la SERVICE_ROLE_KEY per bypassare RLS.
"""
import os, logging, json
from typing import Optional

logger = logging.getLogger(__name__)

_client = None
_status: dict = {"connected": False, "checked": False, "error": "", "url": ""}


def get_client():
    global _client, _status
    if _client is not None:
        return _client
    url = os.getenv("SUPABASE_URL", "").strip()
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY", "")).strip()
    if not url or not key or "YOUR_PROJECT" in url:
        _status = {"connected": False, "checked": True,
                   "error": "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured",
                   "url": url[:30] + "…" if url else ""}
        return None
    try:
        from supabase import create_client
        _client = create_client(url, key)
        _status["url"] = url[:40] + "…"
        logger.info(f"Supabase client created: {url[:40]}")
        return _client
    except Exception as e:
        _status = {"connected": False, "checked": True,
                   "error": str(e)[:120], "url": url[:30]}
        logger.warning(f"Supabase init failed: {e}")
        return None


def health_check() -> dict:
    global _status
    sb = get_client()
    if not sb:
        return _status
    try:
        sb.table("training_jobs").select("id").limit(1).execute()
        _status = {"connected": True, "checked": True,
                   "error": "", "url": _status.get("url","")}
        logger.info("Supabase health check: OK")
    except Exception as e:
        _status = {"connected": False, "checked": True,
                   "error": str(e)[:120], "url": _status.get("url","")}
        logger.warning(f"Supabase health check failed: {e}")
    return _status


def _safe(fn, label="db"):
    """Execute fn(), log errors, never raise."""
    try:
        return fn()
    except Exception as e:
        logger.debug(f"DB [{label}]: {e}")
        return None


# ── Trades ────────────────────────────────────────────────────────────────────
def save_trade(trade: dict):
    sb = get_client()
    if not sb: return
    row = {
        "agent_abbr": trade.get("agent_abbr") or "UNKNOWN",
        "symbol":     (trade.get("symbol") or "SPY").upper(),
        "side":       (trade.get("side") or "BUY").upper(),
        "quantity":   float(trade.get("quantity") or 1),
        "price":      float(trade.get("price") or 0),
        "notional":   float(trade.get("notional") or 0),
        "fee":        float(trade.get("fee") or 0),
        "slippage":   float(trade.get("slippage") or 0),
        "pnl":        float(trade.get("pnl") or 0),
        "horizon":    trade.get("horizon") or "swing",
        "order_type": trade.get("order_type") or "MARKET",
        "confidence": float(trade.get("confidence") or 0.5),
        "reason":     (trade.get("reason") or "")[:200],
        "source":     trade.get("source") or "auto",
        "status":     trade.get("status") or "filled",
    }
    _safe(lambda: sb.table("trades").insert(row).execute(), "save_trade")


def save_training_job(job_dict: dict):
    sb = get_client()
    if not sb: return
    result_val = job_dict.get("result") or {}
    if isinstance(result_val, dict):
        # Remove non-JSON-serializable fields
        result_val = {k: v for k, v in result_val.items()
                      if isinstance(v, (str, int, float, bool, list, dict, type(None)))}
    row = {
        "id":           job_dict.get("job_id"),
        "agent_abbr":   job_dict.get("agent_abbr"),
        "symbol":       job_dict.get("symbol"),
        "horizon":      job_dict.get("horizon"),
        "force":        bool(job_dict.get("force")),
        "status":       job_dict.get("status") or "queued",
        "progress":     int(job_dict.get("progress") or 0),
        "stage":        job_dict.get("stage") or "",
        "result":       result_val,
        "error":        (job_dict.get("error") or "")[:200],
        "created_at":   job_dict.get("created_at"),
        "started_at":   job_dict.get("started_at"),
        "completed_at": job_dict.get("completed_at"),
    }
    _safe(lambda: sb.table("training_jobs").upsert(row, on_conflict="id").execute(), "save_job")


def save_model_version(meta: dict):
    sb = get_client()
    if not sb: return
    fi = meta.get("feature_importance", {})
    if not isinstance(fi, dict): fi = {}
    row = {
        "agent_abbr":          meta.get("abbr") or meta.get("agent_abbr"),
        "symbol":              meta.get("symbol"),
        "horizon":             meta.get("horizon"),
        "accuracy":            float(meta.get("accuracy") or 0),
        "samples":             int(meta.get("samples_total") or meta.get("samples") or 0),
        "feature_cols":        meta.get("feature_cols", []),
        "feature_importance":  fi,
        "model_path":          meta.get("model_path", ""),
        "version_num":         1,
        "is_active":           True,
    }
    def _do():
        sb.table("model_versions")\
          .update({"is_active": False})\
          .eq("agent_abbr", row["agent_abbr"])\
          .eq("symbol",     row["symbol"])\
          .eq("horizon",    row["horizon"])\
          .execute()
        sb.table("model_versions").insert(row).execute()
    _safe(_do, "save_model_version")


def save_scout_screen(result: dict):
    sb = get_client()
    if not sb: return
    def _do():
        row = {
            "regime":   result.get("regime"),
            "horizon":  result.get("horizon"),
            "screened": result.get("screened"),
            "top_long": result.get("top_long"),
            "top_short":result.get("top_short"),
            "results":  {
                "longs":  result.get("longs",  [])[:10],
                "shorts": result.get("shorts", [])[:5],
            },
        }
        sb.table("scout_screens").insert(row).execute()
    _safe(_do, "save_scout_screen")


def save_portfolio_snapshot(portfolio: dict):
    sb = get_client()
    if not sb: return
    row = {
        "equity":       float(portfolio.get("equity") or 0),
        "cash":         float(portfolio.get("cash") or 0),
        "invested":     float(portfolio.get("invested") or 0),
        "total_return": float(portfolio.get("total_return") or 0),
        "daily_pnl":    float(portfolio.get("daily_pnl") or 0),
        "sharpe":       float(portfolio.get("sharpe") or 0),
        "sortino":      float(portfolio.get("sortino") or 0),
        "max_drawdown": float(portfolio.get("max_drawdown") or 0),
    }
    _safe(lambda: sb.table("portfolio_snapshots").insert(row).execute(), "save_portfolio")


def load_recent_trades(limit: int = 100) -> list:
    sb = get_client()
    if not sb: return []
    def _do():
        res = sb.table("trades").select("*")\
                .order("created_at", desc=True).limit(limit).execute()
        return res.data or []
    return _safe(_do, "load_trades") or []


def load_model_versions(agent_abbr: Optional[str] = None) -> list:
    sb = get_client()
    if not sb: return []
    def _do():
        q = sb.table("model_versions").select("*").eq("is_active", True)
        if agent_abbr:
            q = q.eq("agent_abbr", agent_abbr)
        res = q.order("trained_at", desc=True).limit(50).execute()
        return res.data or []
    return _safe(_do, "load_models") or []


# ── Supabase Storage — model .pkl persistence ──────────────────────────────────
import base64, gzip as _gzip
from pathlib import Path as _FP

STORAGE_BUCKET = "model-storage"

def upload_model(abbr: str, symbol: str, horizon: str, pkl_path) -> bool:
    """Gzip + base64 encode a .pkl file and upload to Supabase Storage."""
    sb = get_client()
    if not sb:
        return False
    try:
        pkl_path = _FP(pkl_path)
        if not pkl_path.exists():
            return False
        raw         = pkl_path.read_bytes()
        compressed  = _gzip.compress(raw, compresslevel=6)
        storage_key = f"models/{abbr}/{symbol}/{horizon}.pkl.gz"
        def _do():
            # upsert: remove old then upload
            try:
                sb.storage.from_(STORAGE_BUCKET).remove([storage_key])
            except Exception:
                pass
            sb.storage.from_(STORAGE_BUCKET).upload(
                storage_key, compressed,
                {"content-type": "application/octet-stream"}
            )
        _safe(_do, "upload_model")
        logger.info(f"Uploaded model {storage_key} ({len(compressed)//1024}kb)")
        return True
    except Exception as e:
        logger.debug(f"upload_model error: {e}")
        return False


def download_model(abbr: str, symbol: str, horizon: str, dest_path) -> bool:
    """Download and decompress a .pkl.gz from Supabase Storage."""
    sb = get_client()
    if not sb:
        return False
    try:
        storage_key = f"models/{abbr}/{symbol}/{horizon}.pkl.gz"
        def _do():
            return sb.storage.from_(STORAGE_BUCKET).download(storage_key)
        compressed = _safe(_do, "download_model")
        if not compressed:
            return False
        raw = _gzip.decompress(compressed)
        _FP(dest_path).parent.mkdir(parents=True, exist_ok=True)
        _FP(dest_path).write_bytes(raw)
        logger.info(f"Downloaded model {storage_key} -> {dest_path}")
        return True
    except Exception as e:
        logger.debug(f"download_model error: {e}")
        return False


def list_stored_models() -> list:
    """List all models in the storage bucket."""
    sb = get_client()
    if not sb:
        return []
    def _do():
        items = sb.storage.from_(STORAGE_BUCKET).list("models")
        result = []
        for folder in (items or []):
            abbr = folder.get("name","")
            sub  = sb.storage.from_(STORAGE_BUCKET).list(f"models/{abbr}")
            for sym_folder in (sub or []):
                sym  = sym_folder.get("name","")
                sub2 = sb.storage.from_(STORAGE_BUCKET).list(f"models/{abbr}/{sym}")
                for f in (sub2 or []):
                    result.append({
                        "abbr":    abbr,
                        "symbol":  sym,
                        "horizon": f.get("name","").replace(".pkl.gz",""),
                        "size":    f.get("metadata",{}).get("size",0),
                        "key":     f"models/{abbr}/{sym}/{f.get('name','')}",
                    })
        return result
    return _safe(_do, "list_stored_models") or []
