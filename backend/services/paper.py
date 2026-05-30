"""
Paper trading engine v2 — per-agent ledger + global deduplication.

DEDUPLICATION RULES (applied before execution):
  1. Duplicate block  — same agent + symbol + side within DEDUP_WINDOW seconds → rejected
  2. Flip block       — agent already has a position, new signal is opposite direction
                        → requires explicit close first
  3. Conflict block   — portfolio-level: if ≥2 agents already hold the same symbol
                        in opposite directions, new conflicting order is flagged
  4. Size cap         — notional > max_position_pct of agent capital → reduced to cap

OPT (Portfolio Optimizer) is the MASTER AGENT:
  - Has read access to ALL agents' positions via get_all_positions()
  - Can issue rebalance commands that close/open positions across agents
  - Its signals override lower-confidence conflicting signals from other agents
"""
import os, uuid, logging
from datetime import datetime, timezone, timedelta
from collections import defaultdict

logger = logging.getLogger(__name__)

FEE       = float(os.getenv("TRANSACTION_FEE_PCT",  "0.001"))
SLIP      = float(os.getenv("SLIPPAGE_PCT",         "0.0005"))
CAP       = float(os.getenv("INITIAL_CAPITAL",      "100000"))
MAX_POS   = float(os.getenv("MAX_POSITION_PCT",      "0.25"))   # max 25% of agent capital per symbol
DEDUP_WIN = int(os.getenv("DEDUP_WINDOW_SECONDS",    "30"))     # same order blocked within 30s

# ── Per-agent ledger ──────────────────────────────────────────────────────────
_balances:   dict = {}            # abbr → float (cash)
_positions:  dict = {}            # abbr → {symbol → {qty, avg_cost, side, opened_at}}
_last_orders: dict = defaultdict(dict)  # abbr → {symbol+side → datetime}

def _bal(abbr):  return _balances.setdefault(abbr, CAP / 9)
def _pos(abbr):  return _positions.setdefault(abbr, {})


# ── Read access for OPT master agent ─────────────────────────────────────────
def get_positions(agent_abbr: str) -> dict:
    """Return open positions for a specific agent."""
    return dict(_pos(agent_abbr))

def get_all_positions() -> dict:
    """OPT-only: return ALL agents' positions for portfolio-level view."""
    return {abbr: dict(pos) for abbr, pos in _positions.items() if pos}

def get_balance(agent_abbr: str) -> float:
    return _bal(agent_abbr)

def get_portfolio_exposure() -> dict:
    """Symbol-level exposure across all agents."""
    exposure: dict = {}
    for abbr, positions in _positions.items():
        for sym, pos in positions.items():
            if sym not in exposure:
                exposure[sym] = {"long_agents": [], "short_agents": [], "net_qty": 0.0}
            qty = float(pos.get("qty", 0))
            if qty > 0:
                exposure[sym]["long_agents"].append(abbr)
                exposure[sym]["net_qty"] += qty
            else:
                exposure[sym]["short_agents"].append(abbr)
    return exposure


# ── Deduplication checks ──────────────────────────────────────────────────────
class OrderRejected(Exception):
    def __init__(self, reason: str, code: str):
        super().__init__(reason)
        self.code   = code      # DUPLICATE | FLIP | CONFLICT | SIZE_CAP
        self.reason = reason

def _check_duplicate(abbr: str, symbol: str, side: str) -> None:
    """Block identical order within DEDUP_WIN seconds."""
    key  = f"{symbol}:{side}"
    last = _last_orders[abbr].get(key)
    if last and (datetime.now(timezone.utc) - last).total_seconds() < DEDUP_WIN:
        secs = int((datetime.now(timezone.utc) - last).total_seconds())
        raise OrderRejected(
            f"Duplicate order blocked: {abbr} already submitted {side} {symbol} {secs}s ago "
            f"(window={DEDUP_WIN}s)",
            "DUPLICATE"
        )

def _check_flip(abbr: str, symbol: str, side: str, allow_flip: bool = False) -> None:
    """
    Block an order that would flip an existing position without closing it first.
    BUY when you're already long is fine (add to position).
    SELL when you have no position is blocked (no short selling in paper mode).
    SELL when you're already long is a close — allowed.
    BUY when you have no position — always allowed.
    """
    pos = _pos(abbr).get(symbol)
    if side == "SELL" and (not pos or pos.get("qty", 0) <= 0):
        if not allow_flip:
            raise OrderRejected(
                f"No open position for {abbr} in {symbol} — cannot SELL what you don't own",
                "FLIP"
            )

def _check_portfolio_conflict(abbr: str, symbol: str, side: str) -> str | None:
    """
    Warning (not rejection) if other agents hold opposite positions in same symbol.
    Returns warning string or None.
    """
    exposure = get_portfolio_exposure()
    exp = exposure.get(symbol)
    if not exp:
        return None
    if side == "BUY" and exp["short_agents"] and abbr not in exp["short_agents"]:
        return f"⚠️ Conflict: {exp['short_agents']} hold SHORT {symbol} while you go LONG"
    if side == "SELL" and exp["long_agents"] and abbr not in exp["long_agents"]:
        return f"⚠️ Conflict: {exp['long_agents']} hold LONG {symbol} while you go SHORT"
    return None

def _apply_size_cap(abbr: str, symbol: str, side: str,
                    quantity: float, price: float) -> float:
    """Reduce quantity if it would exceed MAX_POSITION_PCT of agent capital."""
    if side != "BUY":
        return quantity
    bal     = _bal(abbr)
    max_not = bal * MAX_POS
    max_qty = max_not / (price * (1 + SLIP) * (1 + FEE))
    if quantity > max_qty and max_qty > 0:
        logger.warning(
            f"Size cap: {abbr} {symbol} qty {quantity:.4f} -> {max_qty:.4f} "
            f"(max {MAX_POS*100:.0f}% of ${bal:.0f})"
        )
        return round(max_qty, 6)
    return quantity


# ── Core execute ──────────────────────────────────────────────────────────────
def execute(agent_abbr:  str,
            symbol:      str,
            side:        str,
            quantity:    float,
            market_price:float,
            reason:      str   = "",
            confidence:  float = 0.5,
            allow_flip:  bool  = False,
            bypass_dedup:bool  = False) -> dict:
    """
    Execute a paper trade with full deduplication and conflict checking.

    Returns a trade dict.  Raises OrderRejected (subclass of ValueError)
    if the order is blocked by a dedup/flip/size rule.
    """
    side   = side.upper()
    abbr   = agent_abbr.upper()

    # 1. Duplicate check
    if not bypass_dedup:
        _check_duplicate(abbr, symbol, side)

    # 2. Flip check
    _check_flip(abbr, symbol, side, allow_flip)

    # 3. Size cap
    quantity = _apply_size_cap(abbr, symbol, side, quantity, market_price)
    if quantity <= 0:
        raise OrderRejected(f"Quantity capped to 0 — insufficient capital", "SIZE_CAP")

    # 4. Portfolio conflict warning (non-blocking, logged)
    conflict_warning = _check_portfolio_conflict(abbr, symbol, side)
    if conflict_warning:
        logger.info(f"Portfolio conflict note for {abbr}: {conflict_warning}")

    # 5. Execute
    slippage = market_price * SLIP * (1 if side == "BUY" else -1)
    fill     = round(market_price + slippage, 4)
    notional = round(fill * quantity, 4)
    fee      = round(notional * FEE, 4)

    bal = _bal(abbr)
    pos = _pos(abbr)
    pnl = 0.0

    if side == "BUY":
        if bal < notional + fee:
            raise OrderRejected(
                f"Insufficient cash: need ${notional+fee:.2f}, have ${bal:.2f}",
                "SIZE_CAP"
            )
        _balances[abbr] -= notional + fee
        p = pos.setdefault(symbol, {"qty": 0.0, "avg_cost": 0.0, "opened_at": None})
        new_qty = p["qty"] + quantity
        p["avg_cost"]  = (p["avg_cost"] * p["qty"] + fill * quantity) / new_qty
        p["qty"]       = new_qty
        p["opened_at"] = p["opened_at"] or datetime.now(timezone.utc).isoformat()
        pnl = 0.0

    else:  # SELL
        p = pos.get(symbol)
        if not p or p["qty"] < quantity:
            actual_qty = p["qty"] if p else 0
            if actual_qty > 0 and actual_qty < quantity:
                # Partial close — sell what we have
                quantity = actual_qty
                notional = round(fill * quantity, 4)
                fee      = round(notional * FEE, 4)
                logger.info(f"{abbr}: partial close {symbol} qty={quantity:.4f}")
            else:
                raise OrderRejected(f"No position in {symbol} to sell", "FLIP")
        _balances[abbr] += notional - fee
        pnl = round((fill - p["avg_cost"]) * quantity - fee, 4)
        p["qty"] -= quantity
        if p["qty"] <= 1e-8:
            del pos[symbol]

    # 6. Record for dedup
    key = f"{symbol}:{side}"
    _last_orders[abbr][key] = datetime.now(timezone.utc)

    return {
        "id":               str(uuid.uuid4()),
        "agent_abbr":       abbr,
        "symbol":           symbol,
        "side":             side,
        "quantity":         round(quantity, 6),
        "price":            fill,
        "notional":         round(notional, 4),
        "fee":              fee,
        "slippage":         round(abs(slippage), 4),
        "pnl":              pnl,
        "reason":           reason,
        "confidence":       confidence,
        "status":           "filled",
        "conflict_warning": conflict_warning,
        "ts":               datetime.now(timezone.utc).isoformat(),
    }


# ── OPT master rebalance ──────────────────────────────────────────────────────
def opt_rebalance(target_weights: dict, prices: dict,
                  total_capital: float = None) -> list:
    """
    Called by OPT agent to rebalance the whole portfolio.
    target_weights: {symbol: float}  (e.g. {"SPY": 0.4, "GLD": 0.2, "TLT": 0.4})
    Returns list of suggested trades (not executed — OPT confirms first).
    """
    if total_capital is None:
        total_capital = sum(_bal(a) for a in _balances) if _balances else CAP

    trades_needed = []
    all_pos = get_all_positions()

    for symbol, target_w in target_weights.items():
        price       = prices.get(symbol, 100.0)
        target_val  = total_capital * target_w
        target_qty  = target_val / (price + 1e-9)

        # Current total qty across all agents
        current_qty = sum(
            float(pos.get(symbol, {}).get("qty", 0))
            for pos in all_pos.values()
        )

        delta = target_qty - current_qty
        if abs(delta) < 0.01:
            continue

        trades_needed.append({
            "symbol":       symbol,
            "side":         "BUY" if delta > 0 else "SELL",
            "quantity":     round(abs(delta), 4),
            "target_weight":target_w,
            "current_qty":  current_qty,
            "target_qty":   round(target_qty, 4),
            "price":        price,
        })

    return trades_needed
