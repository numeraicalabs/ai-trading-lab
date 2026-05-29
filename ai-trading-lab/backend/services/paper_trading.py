"""
Paper Trading Service
Handles simulated order execution with fees, slippage, and position tracking.
"""

import os
import uuid
import random
from datetime import datetime, timezone
from typing import Optional

TRANSACTION_FEE_PCT = float(os.getenv("TRANSACTION_FEE_PCT", "0.001"))
SLIPPAGE_PCT = float(os.getenv("SLIPPAGE_PCT", "0.0005"))
INITIAL_CAPITAL = float(os.getenv("INITIAL_CAPITAL", "100000"))

# In-memory book
_positions: dict = {}   # agent_abbr -> {symbol: {qty, avg_cost}}
_balances: dict = {}    # agent_abbr -> cash balance

def get_balance(agent_abbr: str) -> float:
    return _balances.setdefault(agent_abbr, INITIAL_CAPITAL / 9)

def get_positions(agent_abbr: str) -> dict:
    return _positions.setdefault(agent_abbr, {})

def execute_order(
    agent_abbr: str,
    symbol: str,
    side: str,
    quantity: float,
    market_price: float,
    reason: str = "",
    confidence: float = 0.5,
) -> dict:
    """
    Execute a paper trade with slippage + fees.
    Returns trade dict or raises ValueError.
    """
    side = side.upper()
    if side not in ("BUY", "SELL"):
        raise ValueError(f"Invalid side: {side}")

    # Apply slippage
    slippage = market_price * SLIPPAGE_PCT * (1 if side == "BUY" else -1)
    fill_price = round(market_price + slippage, 4)
    notional = round(fill_price * quantity, 4)
    fee = round(notional * TRANSACTION_FEE_PCT, 4)
    total_cost = notional + fee if side == "BUY" else -(notional - fee)

    balance = get_balance(agent_abbr)
    positions = get_positions(agent_abbr)

    # Validate
    if side == "BUY" and balance < total_cost:
        raise ValueError(f"Insufficient cash: need {total_cost:.2f}, have {balance:.2f}")
    if side == "SELL":
        held = positions.get(symbol, {}).get("qty", 0)
        if held < quantity:
            raise ValueError(f"Insufficient position: need {quantity}, have {held}")

    # Update book
    if side == "BUY":
        _balances[agent_abbr] -= total_cost
        pos = positions.setdefault(symbol, {"qty": 0, "avg_cost": 0.0})
        new_qty = pos["qty"] + quantity
        pos["avg_cost"] = (pos["avg_cost"] * pos["qty"] + fill_price * quantity) / new_qty
        pos["qty"] = new_qty
        pnl = 0.0
    else:
        _balances[agent_abbr] += notional - fee
        pos = positions[symbol]
        pnl = round((fill_price - pos["avg_cost"]) * quantity - fee, 4)
        pos["qty"] -= quantity
        if pos["qty"] <= 0:
            del positions[symbol]

    trade = {
        "id": str(uuid.uuid4()),
        "agent_abbr": agent_abbr,
        "symbol": symbol,
        "side": side,
        "quantity": quantity,
        "price": fill_price,
        "notional": notional,
        "fee": fee,
        "slippage": round(abs(slippage), 4),
        "pnl": pnl,
        "pnl_pct": round(pnl / (pos.get("avg_cost", fill_price) * quantity) * 100, 4) if quantity else 0,
        "reason": reason,
        "confidence": confidence,
        "status": "filled",
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    return trade
