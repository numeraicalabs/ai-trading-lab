"""
Trade Repository — structured analytics layer on top of the in-memory trade list.

Provides:
  - Per-strategy P&L analysis
  - Per-agent deep metrics (MAE/MFE, hold time, tag breakdown)
  - Strategy comparison table (agents ranked by multiple metrics)
  - Signal accuracy: did agent's predicted direction match actual outcome?
  - Rolling performance (7d, 30d, 90d windows)
  - Drawdown per agent
  - Tag / risk-level / horizon analytics
"""
import json
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from typing import Optional
import numpy as np


# ── Core analytics ─────────────────────────────────────────────────────────────
def _pct(v, total):
    return round(v / total * 100, 1) if total else 0.0


def _safe_mean(lst):
    return round(float(np.mean(lst)), 4) if lst else 0.0


def _safe_std(lst):
    return round(float(np.std(lst)), 4) if lst else 0.0


def _drawdown_series(equity_curve: list) -> dict:
    if len(equity_curve) < 2:
        return {"max_dd": 0.0, "current_dd": 0.0}
    eq   = np.array(equity_curve, dtype=float)
    peak = np.maximum.accumulate(eq)
    dd   = (eq - peak) / (peak + 1e-9) * 100
    return {
        "max_dd":     round(float(dd.min()), 2),
        "current_dd": round(float(dd[-1]),   2),
        "series":     [round(float(d), 2) for d in dd[-60:]],
    }


def _holding_period(trade: dict) -> float:
    """Return holding time in hours from opened_at → ts, or 0."""
    try:
        opened = trade.get("opened_at") or trade.get("created_at") or ""
        closed = trade.get("ts") or trade.get("filled_at") or ""
        if opened and closed:
            fmt = "%Y-%m-%dT%H:%M:%S"
            t1 = datetime.fromisoformat(opened.replace("Z", "+00:00"))
            t2 = datetime.fromisoformat(closed.replace("Z", "+00:00"))
            return round(abs((t2 - t1).total_seconds() / 3600), 2)
    except Exception:
        pass
    return 0.0


# ── Agent analytics ────────────────────────────────────────────────────────────
def agent_analytics(trades: list, abbr: str) -> dict:
    """Deep metrics for one agent."""
    agent_trades = [t for t in trades if t.get("agent_abbr") == abbr]
    if not agent_trades:
        return {"abbr": abbr, "trades": 0, "message": "no trades"}

    pnls    = [float(t.get("pnl") or 0) for t in agent_trades]
    wins    = [p for p in pnls if p > 0]
    losses  = [p for p in pnls if p <= 0]
    gross_w = sum(wins)
    gross_l = abs(sum(losses)) or 1e-9

    # Equity curve (cumulative sum from a base of 100)
    equity = [100.0 + sum(pnls[:i+1]) for i in range(len(pnls))]

    # Rolling windows
    now  = datetime.now(timezone.utc)
    def _period(days):
        cutoff = (now - timedelta(days=days)).isoformat()
        pts = [float(t.get("pnl") or 0) for t in agent_trades
               if (t.get("ts") or "") >= cutoff]
        return {"trades": len(pts), "pnl": round(sum(pts), 4),
                "win_rate": _pct(sum(1 for p in pts if p > 0), max(len(pts),1))}

    # Streak
    streak = cur = 0
    for p in reversed(pnls):
        if (p > 0 and cur >= 0) or (p <= 0 and cur <= 0):
            cur += 1 if p > 0 else -1
            streak = cur
        else:
            break

    # Tags breakdown
    tag_pnl: dict = defaultdict(float)
    tag_cnt: dict = defaultdict(int)
    for t in agent_trades:
        for tag in (t.get("memo", {}) or {}).get("tags", []):
            tag_pnl[tag] += float(t.get("pnl") or 0)
            tag_cnt[tag] += 1

    # By symbol
    sym_pnl: dict = defaultdict(float)
    sym_cnt: dict = defaultdict(int)
    for t in agent_trades:
        sym = t.get("symbol", "?")
        sym_pnl[sym] += float(t.get("pnl") or 0)
        sym_cnt[sym] += 1

    # Hold times
    hold_times = [_holding_period(t) for t in agent_trades]

    # Memo quality
    memo_scores = [t.get("memo_score") or 0 for t in agent_trades]
    has_memo    = [t for t in agent_trades if t.get("memo") and
                   (t["memo"].get("thesis") or t["memo"].get("signal_source"))]

    dd = _drawdown_series(equity)

    return {
        "abbr":            abbr,
        "trades":          len(agent_trades),
        "pnl_total":       round(sum(pnls), 4),
        "pnl_avg":         _safe_mean(pnls),
        "pnl_std":         _safe_std(pnls),
        "win_rate":        _pct(len(wins), len(pnls)),
        "profit_factor":   round(gross_w / gross_l, 3),
        "avg_win":         _safe_mean(wins)  if wins   else 0,
        "avg_loss":        _safe_mean(losses) if losses else 0,
        "best_trade":      round(max(pnls), 4),
        "worst_trade":     round(min(pnls), 4),
        "sharpe":          round(
                               float(np.mean(pnls) / (np.std(pnls) + 1e-9) * np.sqrt(252))
                               if len(pnls) > 5 else 0, 3),
        "max_drawdown":    dd["max_dd"],
        "current_drawdown":dd["current_dd"],
        "streak":          streak,           # positive = win streak, negative = loss streak
        "avg_hold_hours":  _safe_mean([h for h in hold_times if h > 0]),
        "rolling_7d":      _period(7),
        "rolling_30d":     _period(30),
        "rolling_90d":     _period(90),
        "by_tag":          {tag: {"pnl": round(tag_pnl[tag], 4), "count": tag_cnt[tag]}
                            for tag in sorted(tag_pnl, key=lambda k: -tag_pnl[k])},
        "by_symbol":       {sym: {"pnl": round(sym_pnl[sym], 4), "count": sym_cnt[sym]}
                            for sym in sorted(sym_pnl, key=lambda k: -sym_pnl[k])[:10]},
        "memo_coverage":   _pct(len(has_memo), len(agent_trades)),
        "avg_memo_score":  _safe_mean(memo_scores),
        "equity_curve":    [round(e, 2) for e in equity[-80:]],
        "drawdown_series": dd["series"],
    }


# ── Strategy comparison ────────────────────────────────────────────────────────
def strategy_comparison_table(trades: list) -> list:
    """Rank all agents by multiple metrics — one row per agent."""
    agents = list({t.get("agent_abbr") for t in trades if t.get("agent_abbr")})
    rows   = []
    for abbr in sorted(agents):
        a = agent_analytics(trades, abbr)
        if a.get("trades", 0) < 1:
            continue
        rows.append({
            "abbr":           abbr,
            "trades":         a["trades"],
            "pnl_total":      a["pnl_total"],
            "win_rate":       a["win_rate"],
            "profit_factor":  a["profit_factor"],
            "sharpe":         a["sharpe"],
            "max_drawdown":   a["max_drawdown"],
            "avg_win":        a["avg_win"],
            "avg_loss":       a["avg_loss"],
            "best_trade":     a["best_trade"],
            "worst_trade":    a["worst_trade"],
            "streak":         a["streak"],
            "rolling_30d_pnl":a["rolling_30d"]["pnl"],
            "memo_coverage":  a["memo_coverage"],
        })

    # Rank: composite score (higher = better)
    if rows:
        max_pf = max(r["profit_factor"] for r in rows) or 1
        max_sh = max(r["sharpe"]        for r in rows) or 1
        for r in rows:
            score = (
                r["win_rate"]         * 0.30 +
                (r["profit_factor"] / max_pf) * 100 * 0.25 +
                (r["sharpe"]        / max_sh) * 100 * 0.25 +
                r["memo_coverage"]  * 0.10 +
                (max(0, r["rolling_30d_pnl"]) * 10) * 0.10
            )
            r["composite_score"] = round(score, 1)
        rows.sort(key=lambda r: -r["composite_score"])
        for i, r in enumerate(rows):
            r["rank"] = i + 1

    return rows


# ── Portfolio-level analytics ──────────────────────────────────────────────────
def portfolio_analytics(trades: list) -> dict:
    """Aggregate across all agents."""
    if not trades:
        return {"trades": 0, "message": "no trades"}

    pnls = [float(t.get("pnl") or 0) for t in trades]
    wins = [p for p in pnls if p > 0]

    # By horizon
    horiz_pnl: dict = defaultdict(float)
    horiz_cnt: dict = defaultdict(int)
    for t in trades:
        h = t.get("horizon") or "unknown"
        horiz_pnl[h] += float(t.get("pnl") or 0)
        horiz_cnt[h] += 1

    # By risk level
    risk_pnl: dict = defaultdict(float)
    for t in trades:
        rl = (t.get("memo") or {}).get("risk_level") or t.get("risk_level") or "MEDIUM"
        risk_pnl[rl] += float(t.get("pnl") or 0)

    # By month
    monthly: dict = defaultdict(float)
    for t in trades:
        ts = t.get("ts") or t.get("created_at") or ""
        if len(ts) >= 7:
            monthly[ts[:7]] += float(t.get("pnl") or 0)

    # Signal accuracy: did signal direction match realized P&L?
    signal_ok  = sum(1 for t in trades if
                     (t.get("side") == "BUY"  and (t.get("pnl") or 0) > 0) or
                     (t.get("side") == "SELL" and (t.get("pnl") or 0) > 0))
    signal_acc = _pct(signal_ok, len(trades))

    gross_w = sum(wins)
    gross_l = abs(sum(p for p in pnls if p <= 0)) or 1e-9

    equity = [100.0 + sum(pnls[:i+1]) for i in range(len(pnls))]
    dd     = _drawdown_series(equity)

    return {
        "total_trades":     len(trades),
        "total_pnl":        round(sum(pnls), 4),
        "win_rate":         _pct(len(wins), len(pnls)),
        "profit_factor":    round(gross_w / gross_l, 3),
        "avg_pnl":          _safe_mean(pnls),
        "best_trade":       round(max(pnls), 4),
        "worst_trade":      round(min(pnls), 4),
        "signal_accuracy":  signal_acc,
        "max_drawdown":     dd["max_dd"],
        "sharpe":           round(
                                float(np.mean(pnls) / (np.std(pnls) + 1e-9) * np.sqrt(252))
                                if len(pnls) > 5 else 0, 3),
        "by_horizon":       {h: {"pnl": round(horiz_pnl[h], 4), "count": horiz_cnt[h]}
                             for h in horiz_pnl},
        "by_risk_level":    {r: round(risk_pnl[r], 4) for r in risk_pnl},
        "by_month":         dict(sorted(monthly.items())),
        "equity_curve":     [round(e, 2) for e in equity[-100:]],
    }


# ── Filtered trade list ────────────────────────────────────────────────────────
def filter_trades(trades: list,
                  agent:      Optional[str]  = None,
                  symbol:     Optional[str]  = None,
                  horizon:    Optional[str]  = None,
                  side:       Optional[str]  = None,
                  risk_level: Optional[str]  = None,
                  tag:        Optional[str]  = None,
                  from_date:  Optional[str]  = None,
                  to_date:    Optional[str]  = None,
                  min_pnl:    Optional[float]= None,
                  max_pnl:    Optional[float]= None,
                  has_memo:   Optional[bool] = None,
                  search:     Optional[str]  = None) -> list:
    out = trades
    if agent:      out = [t for t in out if t.get("agent_abbr","").upper() == agent.upper()]
    if symbol:     out = [t for t in out if t.get("symbol","").upper() == symbol.upper()]
    if horizon:    out = [t for t in out if t.get("horizon") == horizon]
    if side:       out = [t for t in out if t.get("side","").upper() == side.upper()]
    if risk_level:
        out = [t for t in out if
               (t.get("memo") or {}).get("risk_level","") == risk_level.upper() or
               t.get("risk_level","") == risk_level.upper()]
    if tag:
        out = [t for t in out if
               tag in ((t.get("memo") or {}).get("tags", []))]
    if from_date:  out = [t for t in out if (t.get("ts") or "") >= from_date]
    if to_date:    out = [t for t in out if (t.get("ts") or "") <= to_date]
    if min_pnl is not None:
        out = [t for t in out if float(t.get("pnl") or 0) >= min_pnl]
    if max_pnl is not None:
        out = [t for t in out if float(t.get("pnl") or 0) <= max_pnl]
    if has_memo is True:
        out = [t for t in out if t.get("memo") and
               ((t["memo"].get("thesis") or "") + (t["memo"].get("signal_source") or "")).strip()]
    if has_memo is False:
        out = [t for t in out if not t.get("memo") or
               not ((t["memo"].get("thesis") or "") + (t["memo"].get("signal_source") or "")).strip()]
    if search:
        sl = search.lower()
        out = [t for t in out if
               sl in str(t.get("symbol","")).lower() or
               sl in str(t.get("agent_abbr","")).lower() or
               sl in str((t.get("memo") or {}).get("thesis","")).lower() or
               sl in str(t.get("reason","")).lower()]
    return out


# ── Trade memo enrichment ─────────────────────────────────────────────────────
def enrich_trade(trade: dict, current_price: Optional[float] = None) -> dict:
    """Add computed fields to a trade dict."""
    t     = dict(trade)
    pnl   = float(t.get("pnl") or 0)
    price = float(t.get("price") or 0)
    entry = float(t.get("entry") or price)

    t["pnl_pct"]      = round((pnl / (price + 1e-9)) * 100, 3) if price else 0
    t["outcome"]      = "WIN" if pnl > 0 else "LOSS" if pnl < 0 else "BREAK_EVEN"
    t["hold_hours"]   = _holding_period(t)

    memo = t.get("memo") or {}
    sl   = float(memo.get("stop_loss_price") or 0)
    tp   = float(memo.get("take_profit_price") or 0)
    if sl and tp and price:
        risk   = abs(price - sl)
        reward = abs(tp - price)
        t["rr_ratio"] = round(reward / (risk + 1e-9), 2)
    else:
        t["rr_ratio"] = None

    if current_price and entry and t.get("side") == "BUY":
        t["unrealized_pct"] = round((current_price - entry) / (entry + 1e-9) * 100, 3)
    else:
        t["unrealized_pct"] = None

    return t
