"""Paper Trading Engine — simulated orders with slippage + fees."""
import os, uuid, random
from datetime import datetime, timezone

FEE     = float(os.getenv("TRANSACTION_FEE_PCT","0.001"))
SLIP    = float(os.getenv("SLIPPAGE_PCT","0.0005"))
CAPITAL = float(os.getenv("INITIAL_CAPITAL","100000"))
_positions = {}
_balances  = {}

def get_balance(abbr):  return _balances.setdefault(abbr, CAPITAL/9)
def get_positions(abbr): return _positions.setdefault(abbr, {})

def execute_order(agent_abbr, symbol, side, quantity, market_price, reason="", confidence=0.5):
    side = side.upper()
    slip = market_price * SLIP * (1 if side=="BUY" else -1)
    fill = round(market_price+slip, 4)
    notional = round(fill*quantity, 4)
    fee = round(notional*FEE, 4)
    bal = get_balance(agent_abbr)
    pos = get_positions(agent_abbr)
    if side=="BUY" and bal < notional+fee:
        raise ValueError(f"Insufficient cash: need {notional+fee:.2f}, have {bal:.2f}")
    if side=="SELL" and pos.get(symbol,{}).get("qty",0) < quantity:
        raise ValueError(f"Insufficient position in {symbol}")
    pnl = 0.0
    if side=="BUY":
        _balances[agent_abbr] -= notional+fee
        p = pos.setdefault(symbol,{"qty":0,"avg_cost":0.0})
        new_qty = p["qty"]+quantity
        p["avg_cost"] = (p["avg_cost"]*p["qty"]+fill*quantity)/new_qty
        p["qty"] = new_qty
    else:
        _balances[agent_abbr] += notional-fee
        p = pos[symbol]
        pnl = round((fill-p["avg_cost"])*quantity-fee, 4)
        p["qty"] -= quantity
        if p["qty"] <= 0: del pos[symbol]
    return {"id":str(uuid.uuid4()),"agent_abbr":agent_abbr,"symbol":symbol,
            "side":side,"quantity":quantity,"price":fill,"notional":notional,
            "fee":fee,"slippage":round(abs(slip),4),"pnl":pnl,
            "pnl_pct":round(pnl/(p.get("avg_cost",fill)*quantity)*100,4) if quantity else 0,
            "reason":reason,"confidence":confidence,"status":"filled",
            "ts":datetime.now(timezone.utc).isoformat()}
