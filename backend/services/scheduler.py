"""
Auto-Scheduler — riaddestra gli agenti automaticamente quando:
  1. L'accuracy OOS scende sotto la soglia (degradation detection)
  2. È passato troppo tempo dall'ultimo training (staleness)
  3. Il mercato ha cambiato regime (regime-triggered retraining)
  4. Schedule fisso (ogni N ore per horizon)

Mantiene uno storico delle performance per ogni agente nel tempo.
"""
import asyncio, logging, os
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from pathlib import Path
import json

logger = logging.getLogger(__name__)

# ── Config (override via env) ─────────────────────────────────────────────────
MIN_ACCURACY         = float(os.getenv("MIN_ACCURACY",          "0.52"))  # 52% min OOS
STALENESS_HOURS      = int(os.getenv("STALENESS_HOURS",         "24"))    # max hours without retraining
REGIME_RETRAIN       = os.getenv("REGIME_RETRAIN",              "true").lower() == "true"
SCHEDULER_INTERVAL   = int(os.getenv("SCHEDULER_INTERVAL_MIN",  "30"))    # check ogni 30 min
AUTO_RETRAIN_ENABLED = os.getenv("AUTO_RETRAIN_ENABLED",        "true").lower() == "true"

SCHEDULE = {  # horizon -> retrain ogni N ore
    "scalping": 4,
    "day":      12,
    "swing":    24,
    "position": 72,
}

# ── Storico performance (in-memory + file JSON) ───────────────────────────────
PERF_DIR  = Path(__file__).parent.parent / "agent_perf_history"
PERF_DIR.mkdir(exist_ok=True)

_history: dict = defaultdict(list)   # abbr -> [{ts, accuracy, cv, overfit, symbol, horizon}]
_last_retrain: dict = {}             # f"{abbr}_{symbol}_{horizon}" -> ISO timestamp
_retrain_reasons: list = []          # [{ts, abbr, symbol, horizon, reason, triggered_by}]


def _load_history():
    for p in PERF_DIR.glob("*.json"):
        try:
            abbr = p.stem
            _history[abbr] = json.loads(p.read_text())
        except Exception:
            pass

def _save_history(abbr: str):
    try:
        (PERF_DIR / f"{abbr}.json").write_text(
            json.dumps(_history[abbr][-200:], indent=2)  # keep last 200 entries
        )
    except Exception:
        pass

_load_history()


# ── Record a training result ──────────────────────────────────────────────────
def record_training(abbr: str, symbol: str, horizon: str, meta: dict):
    """Chiamato dopo ogni training completato."""
    key   = f"{abbr}_{symbol}_{horizon}"
    entry = {
        "ts":       datetime.now(timezone.utc).isoformat(),
        "abbr":     abbr,
        "symbol":   symbol,
        "horizon":  horizon,
        "accuracy": round(meta.get("accuracy", 0) * 100, 2),      # OOS %
        "train_acc":round(meta.get("train_accuracy", 0) * 100, 2),
        "cv_mean":  round(meta.get("cv_mean", 0) * 100, 2),
        "cv_std":   round(meta.get("cv_std", 0) * 100, 2),
        "overfit":  round(meta.get("overfit_gap", 0) * 100, 2),
        "samples":  meta.get("samples_total", 0),
        "f1":       meta.get("oos_metrics", {}).get("f1", 0),
        "precision":meta.get("oos_metrics", {}).get("precision", 0),
        "recall":   meta.get("oos_metrics", {}).get("recall", 0),
    }
    _history[abbr].append(entry)
    _save_history(abbr)
    _last_retrain[key] = entry["ts"]

def get_history(abbr: str, limit: int = 50) -> list:
    return list(reversed(_history.get(abbr, [])))[:limit]

def get_all_history() -> dict:
    return {k: list(reversed(v))[:20] for k, v in _history.items()}

def get_retrain_log(limit: int = 40) -> list:
    return list(reversed(_retrain_reasons))[:limit]


# ── Degradation detection ─────────────────────────────────────────────────────
def _is_stale(abbr: str, symbol: str, horizon: str) -> bool:
    key   = f"{abbr}_{symbol}_{horizon}"
    last  = _last_retrain.get(key)
    if not last:
        # Check disk
        from services.trainer import get_meta
        meta = get_meta(abbr, symbol, horizon)
        if not meta.get("trained"):
            return True  # never trained
        last = meta.get("trained_at")
    if not last:
        return True
    try:
        dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        age_hours = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
        return age_hours > SCHEDULE.get(horizon, STALENESS_HOURS)
    except Exception:
        return True

def _is_degraded(abbr: str, symbol: str, horizon: str) -> tuple[bool, float]:
    """Restituisce (True, current_accuracy) se la performance è peggiorata."""
    from services.trainer import get_meta
    meta = get_meta(abbr, symbol, horizon)
    if not meta.get("trained"):
        return True, 0.0
    oos = meta.get("accuracy", 0)
    return oos < MIN_ACCURACY, round(oos * 100, 1)

def _accuracy_trend(abbr: str, horizon: str, n: int = 5) -> float:
    """Trend di accuracy negli ultimi n training: positivo = migliorando."""
    entries = [e for e in _history.get(abbr, []) if e.get("horizon") == horizon][-n:]
    if len(entries) < 2:
        return 0.0
    accs = [e["accuracy"] for e in entries]
    return round(accs[-1] - accs[0], 2)


# ── Regime-triggered retraining ───────────────────────────────────────────────
_last_regime = "unknown"

def notify_regime_change(new_regime: str):
    """Chiamato quando REG agent rileva un cambio di regime."""
    global _last_regime
    if new_regime != _last_regime and _last_regime != "unknown" and REGIME_RETRAIN:
        logger.info(f"Regime change: {_last_regime} -> {new_regime} — scheduling retrains")
        _retrain_reasons.append({
            "ts":          datetime.now(timezone.utc).isoformat(),
            "abbr":        "ALL",
            "symbol":      "*",
            "horizon":     "*",
            "reason":      f"Regime change: {_last_regime} -> {new_regime}",
            "triggered_by":"regime_detection",
        })
    _last_regime = new_regime


# ── Main scheduler loop ───────────────────────────────────────────────────────
async def scheduler_loop():
    if not AUTO_RETRAIN_ENABLED:
        logger.info("Auto-scheduler disabled (AUTO_RETRAIN_ENABLED=false)")
        return

    await asyncio.sleep(60)   # attende 1 min al boot prima di partire
    logger.info(f"Auto-scheduler started (interval={SCHEDULER_INTERVAL}min, min_acc={MIN_ACCURACY*100:.0f}%)")

    from services.agents        import CATALOGUE, AGENT_STATE
    from services.trainer_queue import enqueue, queue_size

    while True:
        try:
            await asyncio.sleep(SCHEDULER_INTERVAL * 60)

            if queue_size() > 3:
                logger.info("Scheduler: queue busy, skipping cycle")
                continue

            for abbr, cfg in CATALOGUE.items():
                if abbr == "SCOUT":
                    continue  # SCOUT ha il suo loop
                state   = AGENT_STATE.get(abbr, {})
                horizon = state.get("horizon", "swing")
                symbol  = cfg.get("assets", ["SPY"])[0]

                # 1. Staleness check
                if _is_stale(abbr, symbol, horizon):
                    reason = f"Stale model ({SCHEDULE.get(horizon,24)}h schedule)"
                    _retrain_reasons.append({
                        "ts": datetime.now(timezone.utc).isoformat(),
                        "abbr": abbr, "symbol": symbol, "horizon": horizon,
                        "reason": reason, "triggered_by": "staleness",
                    })
                    await enqueue(abbr, symbol, horizon, force=False)
                    logger.info(f"Scheduler: queued {abbr}/{symbol}/{horizon} — {reason}")
                    await asyncio.sleep(2)
                    continue

                # 2. Degradation check
                degraded, acc = _is_degraded(abbr, symbol, horizon)
                if degraded:
                    reason = f"OOS accuracy {acc:.1f}% < {MIN_ACCURACY*100:.0f}%"
                    _retrain_reasons.append({
                        "ts": datetime.now(timezone.utc).isoformat(),
                        "abbr": abbr, "symbol": symbol, "horizon": horizon,
                        "reason": reason, "triggered_by": "degradation",
                    })
                    await enqueue(abbr, symbol, horizon, force=True)
                    logger.info(f"Scheduler: queued {abbr} — {reason}")
                    await asyncio.sleep(2)

        except Exception as e:
            logger.error(f"Scheduler error: {e}")
            await asyncio.sleep(30)
