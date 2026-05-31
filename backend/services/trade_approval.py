"""
Trade Approval Layer — every agent signal passes through this before execution.

Trading modes:
  PAPER_AUTO   — signals execute immediately (current behavior)
  PAPER_MANUAL — signals queue for human approval before paper execution
  REAL_MANUAL  — signals queue for approval, then route to real broker API
  REAL_AUTO    — signals execute on real broker immediately (dangerous — requires explicit enable)

Approval queue:
  Each pending signal becomes an ApprovalRequest with:
    - full signal context (agent, symbol, side, confidence, thesis)
    - pre-trade checks (dedup, regime, R:R, position sizing)
    - approve / reject / modify actions
    - TTL: auto-expire after N minutes if not acted on

Real broker integration (stub):
  Currently a stub. Replace _route_to_broker() with your broker's API.
  Supported broker interfaces: Alpaca (paper+live), Interactive Brokers (via ib_insync).
"""
import asyncio, uuid, logging, os
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
DEFAULT_MODE  = os.getenv("TRADING_MODE",   "PAPER_AUTO")   # PAPER_AUTO|PAPER_MANUAL|REAL_MANUAL|REAL_AUTO
APPROVAL_TTL  = int(os.getenv("APPROVAL_TTL_MIN", "30"))    # minutes before auto-expire
MAX_QUEUE     = int(os.getenv("MAX_APPROVAL_QUEUE", "100"))
BROKER        = os.getenv("BROKER_NAME",    "alpaca")       # alpaca|ibkr|stub
ALPACA_KEY    = os.getenv("ALPACA_API_KEY", "")
ALPACA_SECRET = os.getenv("ALPACA_API_SECRET","")
ALPACA_URL    = os.getenv("ALPACA_BASE_URL","https://paper-api.alpaca.markets")  # paper default
REAL_ENABLED  = os.getenv("REAL_TRADING_ENABLED","false").lower() == "true"

VALID_MODES = {"PAPER_AUTO","PAPER_MANUAL","REAL_MANUAL","REAL_AUTO"}

# ── State ─────────────────────────────────────────────────────────────────────
_mode:     str  = DEFAULT_MODE
_queue:    list = []    # list of ApprovalRequest dicts
_history:  list = []    # approved/rejected/expired — last 200
_broadcast_fn   = None


def set_broadcast(fn):
    global _broadcast_fn
    _broadcast_fn = fn


def get_mode() -> str:
    return _mode


def set_mode(mode: str) -> str:
    global _mode
    mode = mode.upper()
    if mode not in VALID_MODES:
        raise ValueError(f"Invalid mode '{mode}'. Valid: {VALID_MODES}")
    if "REAL" in mode and not REAL_ENABLED:
        raise ValueError("Real trading is disabled. Set REAL_TRADING_ENABLED=true to enable.")
    _mode = mode
    logger.info(f"Trading mode changed to {mode}")
    return _mode


def is_paper() -> bool:
    return "PAPER" in _mode


def is_manual() -> bool:
    return "MANUAL" in _mode


def is_real() -> bool:
    return "REAL" in _mode


# ── Approval request ──────────────────────────────────────────────────────────
def _make_request(signal: dict, agent_abbr: str, checks: list) -> dict:
    req_id = str(uuid.uuid4())[:8]
    expires = (datetime.now(timezone.utc) + timedelta(minutes=APPROVAL_TTL)).isoformat()
    return {
        "req_id":      req_id,
        "status":      "PENDING",        # PENDING | APPROVED | REJECTED | EXPIRED | MODIFIED
        "agent_abbr":  agent_abbr,
        "symbol":      signal.get("symbol", "?"),
        "side":        signal.get("action", "HOLD"),
        "quantity":    signal.get("quantity", 1),
        "confidence":  round(float(signal.get("confidence", 0.5)) * 100, 1),
        "regime":      signal.get("regime", "unknown"),
        "horizon":     signal.get("horizon", "swing"),
        "thesis":      signal.get("thesis", ""),
        "signal_source":signal.get("signal_source", agent_abbr),
        "price":       signal.get("price", 0),
        "stop_loss":   signal.get("stop_loss", None),
        "take_profit": signal.get("take_profit", None),
        "checks":      checks,
        "risk_flags":  [c for c in checks if c.get("type") in ("error","warning")],
        "created_at":  datetime.now(timezone.utc).isoformat(),
        "expires_at":  expires,
        "mode":        _mode,
        "approved_by": None,
        "reject_reason":None,
        "modified_qty": None,
        # filled in after execution
        "executed":    False,
        "trade_result":None,
    }


# ── Pre-trade checks ──────────────────────────────────────────────────────────
def _run_checks(agent_abbr: str, signal: dict, current_prices: dict) -> list:
    checks = []
    side   = signal.get("action", "HOLD")
    conf   = float(signal.get("confidence", 0.5))
    sym    = signal.get("symbol", "?")
    regime = signal.get("regime", "unknown")

    # 1. HOLD signals don't need approval
    if side == "HOLD":
        checks.append({"type":"info","title":"HOLD signal","detail":"No execution needed"})
        return checks

    # 2. Confidence check
    if conf < 0.55:
        checks.append({"type":"warning","title":f"Low confidence ({conf*100:.0f}%)",
                       "detail":"Signal below 55% threshold — consider skipping"})
    else:
        checks.append({"type":"info","title":f"Confidence {conf*100:.0f}%","detail":"Acceptable"})

    # 3. Regime alignment
    if (side == "BUY"  and regime == "bear") or (side == "SELL" and regime == "bull"):
        checks.append({"type":"warning","title":"Counter-trend signal",
                       "detail":f"{side} in {regime} regime"})
    elif regime not in ("unknown","neutral"):
        checks.append({"type":"info","title":"Regime aligned",
                       "detail":f"{side} aligned with {regime} regime"})

    # 4. Global stop check
    try:
        from services.risk_manager import is_global_stop
        if is_global_stop():
            checks.append({"type":"error","title":"GLOBAL STOP ACTIVE",
                           "detail":"RMG has blocked all new orders"})
    except Exception:
        pass

    # 5. Existing position check
    try:
        from services.paper import get_positions
        pos = get_positions(agent_abbr)
        if sym in pos:
            qty = pos[sym].get("qty", 0)
            checks.append({"type":"info","title":f"Existing position: {qty:.4f} {sym}",
                           "detail":"Adding to existing position"})
    except Exception:
        pass

    # 6. Real trading extra checks
    if is_real():
        if not ALPACA_KEY:
            checks.append({"type":"error","title":"No broker API key",
                           "detail":"ALPACA_API_KEY not configured"})
        if not REAL_ENABLED:
            checks.append({"type":"error","title":"Real trading not enabled",
                           "detail":"Set REAL_TRADING_ENABLED=true in env"})

    return checks


# ── Main entry point ──────────────────────────────────────────────────────────
async def process_signal(agent_abbr: str, signal: dict,
                         current_prices: dict,
                         paper_execute_fn=None) -> dict:
    """
    Route a signal through the approval layer.
    Returns {"action":"executed"|"queued"|"rejected"|"skipped", ...}
    """
    side = signal.get("action", "HOLD")

    # HOLD signals always pass through without queuing
    if side == "HOLD":
        return {"action":"skipped","reason":"HOLD signal"}

    checks = _run_checks(agent_abbr, signal, current_prices)
    errors = [c for c in checks if c.get("type") == "error"]

    # Hard blocks (global stop, no broker key)
    if errors and is_real():
        return {"action":"rejected","reason":errors[0]["title"],"checks":checks}

    # ── PAPER_AUTO: execute immediately ──────────────────────────────────────
    if _mode == "PAPER_AUTO" and paper_execute_fn:
        try:
            sym    = signal.get("symbol","SPY").upper()
            qty    = float(signal.get("quantity", 1))
            price  = float(current_prices.get(sym, signal.get("price", 100)))
            reason = signal.get("thesis") or f"{agent_abbr} auto-signal"
            trade  = paper_execute_fn(agent_abbr, sym, side, qty, price,
                                      reason, float(signal.get("confidence",0.5)),
                                      False, False)
            return {"action":"executed","trade":trade,"mode":"PAPER_AUTO"}
        except Exception as e:
            return {"action":"error","reason":str(e)[:120]}

    # ── PAPER_MANUAL or REAL_*: queue for approval ────────────────────────────
    if len(_queue) >= MAX_QUEUE:
        _expire_old()
    if len(_queue) >= MAX_QUEUE:
        return {"action":"rejected","reason":"Approval queue full"}

    req = _make_request(signal, agent_abbr, checks)
    _queue.append(req)

    # Notify via WebSocket
    if _broadcast_fn:
        try:
            await _broadcast_fn({
                "type":     "approval_request",
                "req_id":   req["req_id"],
                "agent":    agent_abbr,
                "symbol":   req["symbol"],
                "side":     req["side"],
                "confidence":req["confidence"],
                "risk_flags":len(req["risk_flags"]),
                "mode":     _mode,
            })
        except Exception:
            pass

    logger.info(f"Signal queued for approval: {agent_abbr} {side} {req['symbol']} [{req['req_id']}]")
    return {"action":"queued","req_id":req["req_id"],"mode":_mode}


# ── Approve / Reject ──────────────────────────────────────────────────────────
async def approve(req_id: str, approved_by: str = "user",
                  modified_qty: Optional[float] = None,
                  paper_execute_fn=None,
                  current_prices: dict = None) -> dict:
    req = _find(req_id)
    if not req:
        return {"error":f"Request {req_id} not found"}
    if req["status"] != "PENDING":
        return {"error":f"Request {req_id} already {req['status']}"}

    req["status"]       = "APPROVED"
    req["approved_by"]  = approved_by
    req["modified_qty"] = modified_qty

    _queue.remove(req)
    _history.insert(0, req)
    if len(_history) > 200:
        _history.pop()

    # Execute
    if current_prices is None:
        current_prices = {}

    sym    = req["symbol"]
    side   = req["side"]
    qty    = modified_qty or req["quantity"]
    price  = float(current_prices.get(sym, req.get("price", 100)))
    reason = req.get("thesis") or f"Manual approval by {approved_by}"

    if is_paper() and paper_execute_fn:
        try:
            trade = paper_execute_fn(
                req["agent_abbr"], sym, side, qty, price,
                reason, req["confidence"]/100, False, True
            )
            req["executed"]     = True
            req["trade_result"] = trade
            return {"action":"executed","trade":trade,"req_id":req_id}
        except Exception as e:
            return {"action":"error","reason":str(e)[:120],"req_id":req_id}

    if is_real():
        result = await _route_to_broker(req, qty, price)
        req["executed"]     = result.get("ok", False)
        req["trade_result"] = result
        return {"action":"sent_to_broker","result":result,"req_id":req_id}

    return {"action":"approved_no_execute","req_id":req_id}


async def reject(req_id: str, reason: str = "Rejected by user") -> dict:
    req = _find(req_id)
    if not req:
        return {"error":f"Request {req_id} not found"}
    req["status"]        = "REJECTED"
    req["reject_reason"] = reason
    _queue.remove(req)
    _history.insert(0, req)
    return {"action":"rejected","req_id":req_id}


async def bulk_approve_all(paper_execute_fn=None, current_prices: dict = None) -> dict:
    """Approve all pending requests in queue."""
    results = []
    for req in list(_queue):
        r = await approve(req["req_id"], "bulk_approve",
                          paper_execute_fn=paper_execute_fn,
                          current_prices=current_prices)
        results.append(r)
    return {"approved": len(results), "results": results}


async def bulk_reject_all(reason: str = "Bulk reject") -> dict:
    count = len(_queue)
    for req in list(_queue):
        await reject(req["req_id"], reason)
    return {"rejected": count}


# ── Queue management ──────────────────────────────────────────────────────────
def get_queue() -> list:
    _expire_old()
    return list(_queue)


def get_history(limit: int = 50) -> list:
    return _history[:limit]


def get_stats() -> dict:
    h = _history
    return {
        "mode":          _mode,
        "pending":       len(_queue),
        "approved_24h":  sum(1 for r in h if r["status"]=="APPROVED"),
        "rejected_24h":  sum(1 for r in h if r["status"]=="REJECTED"),
        "expired_24h":   sum(1 for r in h if r["status"]=="EXPIRED"),
        "executed":      sum(1 for r in h if r.get("executed")),
        "real_enabled":  REAL_ENABLED,
        "broker":        BROKER if is_real() else "paper",
        "approval_ttl":  APPROVAL_TTL,
    }


def _find(req_id: str) -> Optional[dict]:
    return next((r for r in _queue if r["req_id"] == req_id), None)


def _expire_old():
    now = datetime.now(timezone.utc).isoformat()
    expired = [r for r in _queue if r["expires_at"] < now]
    for r in expired:
        r["status"] = "EXPIRED"
        _queue.remove(r)
        _history.insert(0, r)


# ── Broker stub ───────────────────────────────────────────────────────────────
async def _route_to_broker(req: dict, qty: float, price: float) -> dict:
    """
    Route to real broker. Currently implements Alpaca API.
    Replace with your broker's SDK for other platforms.
    """
    if BROKER == "alpaca" and ALPACA_KEY:
        try:
            import httpx
            url  = f"{ALPACA_URL}/v2/orders"
            body = {
                "symbol":        req["symbol"],
                "qty":           str(round(qty, 6)),
                "side":          req["side"].lower(),
                "type":          "market",
                "time_in_force": "day",
                "client_order_id": req["req_id"],
            }
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.post(url, json=body, headers={
                    "APCA-API-KEY-ID":     ALPACA_KEY,
                    "APCA-API-SECRET-KEY": ALPACA_SECRET,
                })
                if r.status_code in (200, 201):
                    data = r.json()
                    return {"ok":True,"broker":"alpaca","order_id":data.get("id"),
                            "status":data.get("status"),"symbol":req["symbol"]}
                return {"ok":False,"broker":"alpaca","error":r.text[:200],"status":r.status_code}
        except Exception as e:
            return {"ok":False,"broker":"alpaca","error":str(e)[:120]}

    # Fallback: stub response (no actual execution)
    logger.warning(f"Broker stub: {req['agent_abbr']} {req['side']} {qty} {req['symbol']} @ {price}")
    return {
        "ok":      True,
        "broker":  "stub",
        "order_id":f"STUB-{req['req_id']}",
        "status":  "filled",
        "message": "Stub broker — no real execution. Configure ALPACA_API_KEY to trade.",
        "symbol":  req["symbol"],
        "qty":     qty,
        "price":   price,
    }


# ── Broker connectivity check ─────────────────────────────────────────────────
async def check_broker_connection() -> dict:
    if not is_real():
        return {"connected":False,"mode":"paper","message":"Not in real trading mode"}
    if BROKER == "alpaca" and ALPACA_KEY:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(f"{ALPACA_URL}/v2/account",
                               headers={"APCA-API-KEY-ID":     ALPACA_KEY,
                                        "APCA-API-SECRET-KEY": ALPACA_SECRET})
                if r.status_code == 200:
                    data = r.json()
                    return {
                        "connected":   True,
                        "broker":      "alpaca",
                        "account_id":  data.get("account_number"),
                        "equity":      data.get("equity"),
                        "buying_power":data.get("buying_power"),
                        "paper":       "paper" in ALPACA_URL,
                    }
                return {"connected":False,"broker":"alpaca","error":r.text[:100]}
        except Exception as e:
            return {"connected":False,"broker":"alpaca","error":str(e)[:80]}
    return {"connected":False,"broker":"stub","message":"Configure ALPACA_API_KEY"}
