"""
Notifications — event bus that broadcasts toast notifications via WebSocket.

Event types:
  training_complete   → ✅ green  — model trained with OOS accuracy
  training_failed     → ❌ red    — job error
  stop_triggered      → 🛑 red    — position auto-closed by RMG
  risk_warning        → ⚠️ yellow — drawdown warning
  global_stop         → 🚨 red    — portfolio hard stop
  scout_opportunity   → 🔭 purple — SCOUT high-conviction pick
  signal_high_conf    → 💡 blue   — agent signal > 80% confidence
  regime_change       → 🔍 cyan   — REG detects new regime
  model_restored      → 💾 gray   — model loaded from Supabase Storage
"""
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_broadcast_fn = None
_history: list = []


def set_broadcast(fn):
    global _broadcast_fn
    _broadcast_fn = fn


async def notify(event_type: str, title: str, message: str,
                 level: str = "info", data: dict = None):
    """
    Levels: info | success | warning | error | critical
    """
    toast = {
        "type":       "notification",
        "event_type": event_type,
        "title":      title,
        "message":    message,
        "level":      level,
        "data":       data or {},
        "ts":         datetime.now(timezone.utc).isoformat(),
        "id":         len(_history) + 1,
    }
    _history.insert(0, toast)
    if len(_history) > 200:
        _history.pop()

    if _broadcast_fn:
        try:
            await _broadcast_fn(toast)
        except Exception as e:
            logger.debug(f"notify broadcast: {e}")

    logger.info(f"[{level.upper()}] {title}: {message}")


def get_history(limit: int = 50) -> list:
    return _history[:limit]


# ── Convenience helpers ───────────────────────────────────────────────────────
async def notify_training_complete(abbr: str, symbol: str, horizon: str,
                                    accuracy: float, cv: float):
    await notify(
        "training_complete",
        f"✅ {abbr} trained",
        f"{symbol}/{horizon} — OOS {accuracy*100:.1f}%  CV {cv*100:.1f}%",
        "success",
        {"abbr": abbr, "symbol": symbol, "horizon": horizon,
         "accuracy": accuracy, "cv": cv},
    )


async def notify_training_failed(abbr: str, error: str):
    await notify(
        "training_failed",
        f"❌ {abbr} training failed",
        error[:120],
        "error",
        {"abbr": abbr},
    )


async def notify_stop_triggered(abbr: str, symbol: str, loss_pct: float):
    await notify(
        "stop_triggered",
        f"🛑 Stop Loss — {abbr} {symbol}",
        f"Auto-closed at {loss_pct:.1f}% loss (RMG threshold)",
        "error",
        {"abbr": abbr, "symbol": symbol, "loss_pct": loss_pct},
    )


async def notify_risk_warning(drawdown: float, threshold: float):
    await notify(
        "risk_warning",
        "⚠️ Drawdown Warning",
        f"Portfolio down {drawdown:.1f}% (hard stop at {threshold:.0f}%)",
        "warning",
        {"drawdown": drawdown},
    )


async def notify_global_stop(drawdown: float):
    await notify(
        "global_stop",
        "🚨 GLOBAL STOP ACTIVE",
        f"Portfolio drawdown {drawdown:.1f}% — all new orders blocked",
        "critical",
        {"drawdown": drawdown},
    )


async def notify_scout_opportunity(symbol: str, direction: str,
                                    score: float, conviction: str):
    await notify(
        "scout_opportunity",
        f"🔭 SCOUT: {direction} {symbol}",
        f"{conviction} conviction — score {score:.0f}/100",
        "info",
        {"symbol": symbol, "direction": direction,
         "score": score, "conviction": conviction},
    )


async def notify_regime_change(old_regime: str, new_regime: str, confidence: float):
    await notify(
        "regime_change",
        f"🔍 Regime: {old_regime} &rarr; {new_regime}",
        f"REG agent confidence {confidence*100:.0f}%",
        "info",
        {"old": old_regime, "new": new_regime, "confidence": confidence},
    )


async def notify_model_restored(count: int):
    if count > 0:
        await notify(
            "model_restored",
            f"💾 {count} models restored",
            "Models loaded from Supabase Storage",
            "info",
            {"count": count},
        )
