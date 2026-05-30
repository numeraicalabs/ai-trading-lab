"""Paper trading engine — simulated orders with slippage + fees."""
import os, uuid
from datetime import datetime, timezone

FEE  = float(os.getenv("TRANSACTION_FEE_PCT", "0.001"))
SLIP = float(os.getenv("SLIPPAGE_PCT", "0.0005"))
CAP  = float(os.getenv("INITIAL_CAPITAL", "100000"))

# In-memory per-agent ledger
_balances:  dict = {}
_positions: dict = {}

def _bal(abbr):  return _balances.setdefault(abbr, CAP / 9)
def _pos(abbr):  return _positions.setdefault(abbr, {})

def execute(agent_abbr: str, symbol: str, side: str,
            quantity: float, market_price: float,
            reason: str = "", confidence: float = 0.5) -> dict:
    side     = side.upper()
    slippage = market_price * SLIP * (1 if side == "BUY" else -1)
    fill     = round(market_price + slippage, 4)
    notional = round(fill * quantity, 4)
    fee      = round(notional * FEE, 4)

    bal = _bal(agent_abbr)
    pos = _pos(agent_abbr)

    if side == "BUY":
        if bal < notional + fee:
            raise ValueError(f"Insufficient cash: need {notional+fee:.2f}, have {bal:.2f}")
        _balances[agent_abbr] -= notional + fee
        p = pos.setdefault(symbol, {"qty": 0.0, "avg_cost": 0.0})
        new_qty = p["qty"] + quantity
        p["avg_cost"] = (p["avg_cost"] * p["qty"] + fill * quantity) / new_qty
        p["qty"] = new_qty
        pnl = 0.0

    else:  # SELL
        p = pos.get(symbol)
        if not p or p["qty"] < quantity:
            raise ValueError(f"Insufficient position in {symbol}")
        _balances[agent_abbr] += notional - fee
        pnl = round((fill - p["avg_cost"]) * quantity - fee, 4)
        p["qty"] -= quantity
        if p["qty"] <= 0:
            del pos[symbol]

    return {
        "id":          str(uuid.uuid4()),
        "agent_abbr":  agent_abbr,
        "symbol":      symbol,
        "side":        side,
        "quantity":    quantity,
        "price":       fill,
        "notional":    notional,
        "fee":         fee,
        "slippage":    round(abs(slippage), 4),
        "pnl":         pnl,
        "reason":      reason,
        "confidence":  confidence,
        "status":      "filled",
        "ts":          datetime.now(timezone.utc).isoformat(),
    }
