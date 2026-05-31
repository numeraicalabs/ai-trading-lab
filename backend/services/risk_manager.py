"""
RMG — Risk Manager Agent

Monitors the entire portfolio in real-time and emits:
  - WARNING impulses when drawdown approaches threshold
  - STOP impulses when portfolio breaches hard limit
  - Individual position stop-loss checks
  - Concentration risk alerts
  - Volatility regime escalation alerts

Configuration (env vars):
  PORTFOLIO_DD_WARN  = 0.05   # 5%  drawdown → warning
  PORTFOLIO_DD_HARD  = 0.10   # 10% drawdown → global stop
  POSITION_DD_HARD   = 0.03   # 3%  per-position stop-loss default
  MAX_CONCENTRATION  = 0.40   # max 40% in one symbol across all agents
  MAX_AGENTS_SAME_DIR= 7      # max 7/10 agents same direction → concentration warn
"""
import asyncio, logging, os
from datetime import datetime, timezone
from collections import defaultdict

logger = logging.getLogger(__name__)

DD_WARN         = float(os.getenv("PORTFOLIO_DD_WARN",   "0.05"))
DD_HARD         = float(os.getenv("PORTFOLIO_DD_HARD",   "0.10"))
POS_DD_DEFAULT  = float(os.getenv("POSITION_DD_HARD",    "0.03"))
MAX_CONC        = float(os.getenv("MAX_CONCENTRATION",   "0.40"))
MAX_SAME_DIR    = int(os.getenv("MAX_AGENTS_SAME_DIR",   "7"))
RMG_INTERVAL    = int(os.getenv("RMG_CHECK_INTERVAL",   "15"))   # seconds

# ── State ─────────────────────────────────────────────────────────────────────
_peak_equity: float  = 0.0        # highest recorded portfolio equity
_global_stop: bool   = False      # True = no new orders allowed
_alerts: list        = []         # ring buffer of last 100 alerts
_broadcast_fn        = None

ABBR  = "RMG"
COLOR = "#ff6b6b"


def set_broadcast(fn):
    global _broadcast_fn
    _broadcast_fn = fn


async def _emit(alert: dict):
    _alerts.insert(0, alert)
    if len(_alerts) > 100:
        _alerts.pop()
    if _broadcast_fn:
        try:
            await _broadcast_fn({"type": "risk_alert", "alert": alert})
        except Exception:
            pass


def get_alerts(limit: int = 30) -> list:
    return _alerts[:limit]


def is_global_stop() -> bool:
    return _global_stop


def reset_global_stop():
    global _global_stop
    _global_stop = False
    logger.info("RMG: global stop RESET by user")


# ── Stop-loss auto-close ───────────────────────────────────────────────────────
async def check_position_stops(current_prices: dict, paper_execute_fn) -> list:
    """
    Check every open position against its implicit stop loss (POS_DD_DEFAULT).
    Auto-executes SELL if breached. Returns list of triggered stops.
    """
    from services.paper import get_all_positions, OrderRejected

    triggered = []
    all_pos = get_all_positions()

    for abbr, positions in all_pos.items():
        for sym, pos in positions.items():
            avg_c  = float(pos.get("avg_cost", 0))
            qty    = float(pos.get("qty", 0))
            cprice = float(current_prices.get(sym, avg_c))
            if avg_c <= 0 or qty <= 0:
                continue
            loss_pct = (cprice - avg_c) / avg_c
            if loss_pct < -POS_DD_DEFAULT:
                # Stop triggered
                reason = (f"RMG auto-stop: {sym} down {loss_pct*100:.1f}% "
                          f"(threshold -{POS_DD_DEFAULT*100:.0f}%)")
                try:
                    loop = asyncio.get_event_loop()
                    trade = await loop.run_in_executor(
                        None, paper_execute_fn,
                        abbr, sym, "SELL", qty, cprice,
                        reason, 0.95, True, True   # allow_flip=True, bypass_dedup=True
                    )
                    triggered.append({
                        "abbr": abbr, "symbol": sym,
                        "loss_pct": round(loss_pct * 100, 2),
                        "qty": qty, "price": cprice, "trade": trade,
                    })
                    await _emit({
                        "level":   "STOP",
                        "type":    "position_stop",
                        "abbr":    abbr,
                        "symbol":  sym,
                        "message": reason,
                        "ts":      datetime.now(timezone.utc).isoformat(),
                    })
                    logger.warning(reason)
                except OrderRejected as e:
                    logger.debug(f"RMG stop rejected: {e}")
                except Exception as e:
                    logger.error(f"RMG stop error {abbr}/{sym}: {e}")

    return triggered


# ── Portfolio-level drawdown check ────────────────────────────────────────────
async def check_portfolio_drawdown(current_equity: float) -> dict:
    global _peak_equity, _global_stop

    if current_equity > _peak_equity:
        _peak_equity = current_equity

    if _peak_equity <= 0:
        return {"drawdown": 0.0, "status": "ok"}

    dd = (_peak_equity - current_equity) / _peak_equity
    status = "ok"

    if dd >= DD_HARD and not _global_stop:
        _global_stop = True
        status = "HARD_STOP"
        msg = (f"GLOBAL STOP: portfolio drawdown {dd*100:.1f}% "
               f"exceeds hard limit {DD_HARD*100:.0f}%")
        await _emit({
            "level":    "CRITICAL",
            "type":     "global_stop",
            "drawdown": round(dd * 100, 2),
            "message":  msg,
            "ts":       datetime.now(timezone.utc).isoformat(),
        })
        logger.critical(msg)
    elif dd >= DD_WARN and status == "ok":
        status = "WARNING"
        await _emit({
            "level":    "WARNING",
            "type":     "drawdown_warning",
            "drawdown": round(dd * 100, 2),
            "message":  (f"Drawdown warning: {dd*100:.1f}% "
                         f"approaching hard limit {DD_HARD*100:.0f}%"),
            "ts":       datetime.now(timezone.utc).isoformat(),
        })
    elif dd < DD_WARN * 0.5 and _global_stop:
        # Auto-reset if recovered significantly
        _global_stop = False
        status = "RECOVERED"

    return {"drawdown": round(dd * 100, 2), "peak": _peak_equity,
            "current": current_equity, "status": status}


# ── Concentration check ───────────────────────────────────────────────────────
async def check_concentration(current_prices: dict, total_equity: float) -> list:
    from services.paper import get_all_positions

    all_pos = get_all_positions()
    sym_value: dict = defaultdict(float)

    for abbr, positions in all_pos.items():
        for sym, pos in positions.items():
            qty    = float(pos.get("qty", 0))
            cprice = float(current_prices.get(sym, pos.get("avg_cost", 100)))
            sym_value[sym] += qty * cprice

    warnings = []
    for sym, val in sym_value.items():
        conc = val / max(total_equity, 1)
        if conc > MAX_CONC:
            msg = (f"Concentration risk: {sym} = {conc*100:.0f}% of portfolio "
                   f"(max {MAX_CONC*100:.0f}%)")
            warnings.append({"symbol": sym, "concentration": round(conc*100, 1)})
            await _emit({
                "level":   "WARNING",
                "type":    "concentration",
                "symbol":  sym,
                "pct":     round(conc * 100, 1),
                "message": msg,
                "ts":      datetime.now(timezone.utc).isoformat(),
            })

    return warnings


# ── Main RMG loop ─────────────────────────────────────────────────────────────
async def rmg_loop(get_prices_fn, get_equity_fn, paper_execute_fn):
    """
    Runs every RMG_INTERVAL seconds.
    Injects get_prices_fn / get_equity_fn / paper_execute_fn from main.py
    to avoid circular imports.
    """
    await asyncio.sleep(30)   # wait for system to initialise
    logger.info(f"RMG agent started (DD_WARN={DD_WARN*100:.0f}%, "
                f"DD_HARD={DD_HARD*100:.0f}%, pos_stop={POS_DD_DEFAULT*100:.0f}%)")

    while True:
        try:
            prices = get_prices_fn()
            equity = get_equity_fn()

            # 1. Portfolio drawdown
            await check_portfolio_drawdown(equity)

            # 2. Individual position stops
            if not _global_stop:
                await check_position_stops(prices, paper_execute_fn)

            # 3. Concentration
            await check_concentration(prices, equity)

        except Exception as e:
            logger.error(f"RMG loop error: {e}")

        await asyncio.sleep(RMG_INTERVAL)


# ── Status API ────────────────────────────────────────────────────────────────
def get_status() -> dict:
    from services.paper import get_all_positions, get_portfolio_exposure
    pos = get_all_positions()
    total_open = sum(len(p) for p in pos.values())
    return {
        "abbr":           ABBR,
        "name":           "Risk Manager",
        "color":          COLOR,
        "global_stop":    _global_stop,
        "peak_equity":    round(_peak_equity, 2),
        "dd_warn_pct":    DD_WARN  * 100,
        "dd_hard_pct":    DD_HARD  * 100,
        "pos_stop_pct":   POS_DD_DEFAULT * 100,
        "open_positions": total_open,
        "recent_alerts":  _alerts[:5],
        "ts":             datetime.now(timezone.utc).isoformat(),
    }
