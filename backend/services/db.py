"""
Supabase DB — singleton client, health check, save helpers.
Tutti i metodi sono best-effort: non sollevano eccezioni se il DB non è disponibile.
"""
import os, logging
from typing import Optional

logger = logging.getLogger(__name__)

_client = None
_status: dict = {"connected": False, "checked": False, "error": ""}


def get_client():
    global _client, _status
    if _client is not None:
        return _client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY", "")
    if not url or not key or url == "https://YOUR_PROJECT_ID.supabase.co":
        _status = {"connected": False, "checked": True,
                   "error": "SUPABASE_URL / SUPABASE_KEY not set"}
        return None
    try:
        from supabase import create_client
        _client = create_client(url, key)
        return _client
    except Exception as e:
        _status = {"connected": False, "checked": True, "error": str(e)[:100]}
        logger.warning(f"Supabase init failed: {e}")
        return None


def health_check() -> dict:
    global _status
    sb = get_client()
    if not sb:
        return _status

    try:
        # Prova una query leggera
        sb.table("training_jobs").select("id").limit(1).execute()
        _status = {"connected": True, "checked": True, "error": ""}
        logger.info("Supabase: connected ✓")
    except Exception as e:
        _status = {"connected": False, "checked": True, "error": str(e)[:100]}
        logger.warning(f"Supabase health check failed: {e}")
    return _status


# ── Save helpers ──────────────────────────────────────────────────────────────
def save_trade(trade: dict):
    try:
        sb = get_client()
        if not sb:
            return
        # Mappa i campi alla colonna della tabella
        row = {
            "agent_abbr": trade.get("agent_abbr"),
            "symbol":     trade.get("symbol"),
            "side":       trade.get("side"),
            "quantity":   trade.get("quantity"),
            "price":      trade.get("price"),
            "notional":   trade.get("notional"),
            "fee":        trade.get("fee"),
            "slippage":   trade.get("slippage"),
            "pnl":        trade.get("pnl"),
            "horizon":    trade.get("horizon"),
            "order_type": trade.get("order_type", "MARKET"),
            "confidence": trade.get("confidence"),
            "reason":     trade.get("reason", ""),
            "source":     trade.get("source", "auto"),
            "status":     trade.get("status", "filled"),
        }
        sb.table("trades").insert(row).execute()
    except Exception as e:
        logger.debug(f"save_trade: {e}")


def save_model_version(meta: dict):
    try:
        sb = get_client()
        if not sb:
            return
        row = {
            "agent_abbr":          meta.get("abbr"),
            "symbol":              meta.get("symbol"),
            "horizon":             meta.get("horizon"),
            "accuracy":            meta.get("accuracy"),
            "samples":             meta.get("samples_total"),
            "feature_cols":        meta.get("feature_cols", []),
            "feature_importance":  meta.get("feature_importance", {}),
            "model_path":          meta.get("model_path", ""),
            "is_active":           True,
        }
        # Deactivate previous versions
        sb.table("model_versions")\
          .update({"is_active": False})\
          .eq("agent_abbr", row["agent_abbr"])\
          .eq("symbol",     row["symbol"])\
          .eq("horizon",    row["horizon"])\
          .execute()
        sb.table("model_versions").insert(row).execute()
    except Exception as e:
        logger.debug(f"save_model_version: {e}")


def save_portfolio_snapshot(portfolio: dict):
    try:
        sb = get_client()
        if not sb:
            return
        row = {
            "equity":       portfolio.get("equity"),
            "cash":         portfolio.get("cash"),
            "invested":     portfolio.get("invested"),
            "total_return": portfolio.get("total_return"),
            "daily_pnl":    portfolio.get("daily_pnl"),
            "sharpe":       portfolio.get("sharpe"),
            "sortino":      portfolio.get("sortino"),
            "max_drawdown": portfolio.get("max_drawdown"),
        }
        sb.table("portfolio_snapshots").insert(row).execute()
    except Exception as e:
        logger.debug(f"save_portfolio_snapshot: {e}")


def load_recent_trades(limit: int = 100) -> list:
    try:
        sb = get_client()
        if not sb:
            return []
        res = sb.table("trades")\
                .select("*")\
                .order("created_at", desc=True)\
                .limit(limit)\
                .execute()
        return res.data or []
    except Exception as e:
        logger.debug(f"load_recent_trades: {e}")
        return []


def load_model_versions(agent_abbr: Optional[str] = None) -> list:
    try:
        sb = get_client()
        if not sb:
            return []
        q = sb.table("model_versions").select("*").eq("is_active", True)
        if agent_abbr:
            q = q.eq("agent_abbr", agent_abbr)
        res = q.order("trained_at", desc=True).limit(50).execute()
        return res.data or []
    except Exception as e:
        logger.debug(f"load_model_versions: {e}")
        return []
