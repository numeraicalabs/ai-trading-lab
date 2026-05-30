"""
Backtest engine — vectorized simulation of model signals on historical data.

Supports:
  - Single agent × single symbol × horizon
  - Multi-symbol: run the same agent across a symbol universe, return aggregated stats
  - Benchmark comparison: buy-and-hold on the same data
  - Proper metrics: Sharpe, Sortino, Calmar, Max Drawdown, Win Rate, Profit Factor
"""
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

logger = logging.getLogger(__name__)

RESULTS_DIR = Path(__file__).parent.parent / "backtest_results"
RESULTS_DIR.mkdir(exist_ok=True)

FEE   = 0.001   # 0.1% per side
SLIP  = 0.0005  # 0.05% slippage per side


# ── Core metrics ──────────────────────────────────────────────────────────────
def _sharpe(rets: np.ndarray, freq: int = 252) -> float:
    if len(rets) < 5 or rets.std() == 0:
        return 0.0
    return float(np.sqrt(freq) * rets.mean() / (rets.std() + 1e-9))

def _sortino(rets: np.ndarray, freq: int = 252) -> float:
    neg = rets[rets < 0]
    if len(neg) < 3 or neg.std() == 0:
        return 0.0
    return float(np.sqrt(freq) * rets.mean() / (neg.std() + 1e-9))

def _max_drawdown(equity: np.ndarray) -> float:
    peak = np.maximum.accumulate(equity)
    dd   = (equity - peak) / (peak + 1e-9)
    return float(dd.min())

def _calmar(total_ret: float, max_dd: float) -> float:
    return round(total_ret / abs(max_dd + 1e-9), 3) if max_dd < 0 else 0.0

def _win_stats(trades: list) -> dict:
    if not trades:
        return {"win_rate": 0, "profit_factor": 1, "avg_win": 0, "avg_loss": 0}
    wins  = [t["pnl"] for t in trades if t["pnl"] > 0]
    loses = [t["pnl"] for t in trades if t["pnl"] <= 0]
    gross_win  = sum(wins)  or 0
    gross_loss = abs(sum(loses)) or 1e-9
    return {
        "win_rate":      round(len(wins) / max(len(trades), 1) * 100, 1),
        "profit_factor": round(gross_win / gross_loss, 3),
        "avg_win":       round(float(np.mean(wins))  if wins  else 0, 4),
        "avg_loss":      round(float(np.mean(loses)) if loses else 0, 4),
        "total_trades":  len(trades),
        "winning_trades":len(wins),
        "losing_trades": len(loses),
    }


# ── Signal generation from saved model ───────────────────────────────────────
def _generate_signals(abbr: str, symbol: str, horizon: str,
                      df: pd.DataFrame) -> pd.Series:
    """
    Roll through the test window generating predictions.
    Returns a Series of actions indexed like df: 'BUY', 'SELL', 'HOLD'.
    """
    from services.trainer import _build_features, REGRESSORS
    from pathlib import Path
    import joblib

    CACHE_DIR  = Path(__file__).parent.parent / "models_cache"
    model_path = CACHE_DIR / f"{abbr}_{symbol}_{horizon}.pkl"
    if not model_path.exists():
        logger.warning(f"No model for {abbr}/{symbol}/{horizon}")
        return pd.Series("HOLD", index=df.index)

    model  = joblib.load(model_path)
    X, _   = _build_features(df)
    if X.empty:
        return pd.Series("HOLD", index=df.index)

    if abbr in REGRESSORS:
        preds  = model.predict(X.values)
        actions = np.where(preds > 0.005, "BUY", np.where(preds < -0.005, "SELL", "HOLD"))
    else:
        proba  = model.predict_proba(X.values) if hasattr(model, "predict_proba") else None
        preds  = model.predict(X.values)
        if proba is not None:
            conf    = proba.max(axis=1)
            actions = np.where(conf < 0.55, "HOLD",
                      np.where(preds == 1, "BUY", "SELL"))
        else:
            actions = np.where(preds == 1, "BUY", "SELL")

    return pd.Series(actions, index=X.index)


# ── Single-symbol backtest ────────────────────────────────────────────────────
def run_backtest(abbr: str, symbol: str, horizon: str,
                 df: pd.DataFrame,
                 initial_capital: float = 10_000.0) -> dict:
    """
    Vectorized simulation: open position on BUY signal, close on SELL/opposite.
    Returns a full result dict with equity curve, trades, metrics.
    """
    from services.market import add_indicators
    df = add_indicators(df)
    if df.empty or len(df) < 50:
        return {"error": "insufficient_data", "abbr": abbr, "symbol": symbol}

    signals = _generate_signals(abbr, symbol, horizon, df)

    # Align with df
    common  = df.index.intersection(signals.index)
    df      = df.loc[common]
    signals = signals.reindex(common).fillna("HOLD")

    closes     = df["close"].values
    n          = len(closes)
    equity     = np.zeros(n)
    equity[0]  = initial_capital
    cash       = initial_capital
    position   = 0.0   # shares held
    entry_price= 0.0
    trade_log  = []
    eq_series  = []

    for i in range(1, n):
        price = closes[i]
        sig   = signals.iloc[i]

        if sig == "BUY" and position == 0 and cash > price:
            qty       = (cash * 0.95) / (price * (1 + SLIP))
            cost      = qty * price * (1 + SLIP) * (1 + FEE)
            if cost <= cash:
                cash       -= cost
                position   = qty
                entry_price= price

        elif sig == "SELL" and position > 0:
            proceeds  = position * price * (1 - SLIP) * (1 - FEE)
            pnl       = proceeds - (position * entry_price * (1 + SLIP + FEE))
            pnl_pct   = pnl / (position * entry_price + 1e-9)
            trade_log.append({
                "ts":         str(df.index[i]),
                "side":       "SELL",
                "price":      round(float(price), 4),
                "entry":      round(float(entry_price), 4),
                "pnl":        round(float(pnl), 4),
                "pnl_pct":    round(float(pnl_pct), 4),
                "qty":        round(float(position), 4),
            })
            cash       += proceeds
            position   = 0.0
            entry_price= 0.0

        equity[i] = cash + position * price

    # Close any open position at last bar
    if position > 0:
        p  = closes[-1]
        prc = position * p * (1 - SLIP) * (1 - FEE)
        trade_log.append({
            "ts": str(df.index[-1]), "side": "CLOSE",
            "price": round(float(p), 4), "entry": round(float(entry_price), 4),
            "pnl": round(float(prc - position * entry_price), 4),
            "pnl_pct": round(float((prc - position * entry_price) / (position * entry_price + 1e-9)), 4),
            "qty": round(float(position), 4),
        })
        equity[-1] = cash + prc

    # Metrics
    rets      = np.diff(equity) / (equity[:-1] + 1e-9)
    total_ret = (equity[-1] - initial_capital) / initial_capital
    max_dd    = _max_drawdown(equity)

    # Benchmark: buy-and-hold from start to end
    bh_ret  = (closes[-1] - closes[0]) / closes[0]
    bh_eq   = initial_capital * (1 + np.linspace(0, bh_ret, n))
    bh_rets = np.diff(bh_eq) / (bh_eq[:-1] + 1e-9)

    freq  = {"scalping": 1440, "day": 252*6, "swing": 252, "position": 52}.get(horizon, 252)
    win_s = _win_stats(trade_log)

    equity_curve = [
        {"i": i, "equity": round(float(equity[i]), 2),
         "bh": round(float(bh_eq[i]), 2)}
        for i in range(0, n, max(1, n // 200))   # downsample to ~200 points
    ]

    result = {
        "abbr":            abbr,
        "symbol":          symbol,
        "horizon":         horizon,
        "start":           str(df.index[0]),
        "end":             str(df.index[-1]),
        "bars":            n,
        "initial_capital": initial_capital,
        "final_equity":    round(float(equity[-1]), 2),
        "total_return":    round(float(total_ret * 100), 2),
        "benchmark_return":round(float(bh_ret * 100), 2),
        "alpha":           round(float((total_ret - bh_ret) * 100), 2),
        "sharpe":          round(_sharpe(rets, freq), 3),
        "sortino":         round(_sortino(rets, freq), 3),
        "max_drawdown":    round(float(max_dd * 100), 2),
        "calmar":          _calmar(total_ret, max_dd),
        "bh_sharpe":       round(_sharpe(bh_rets, freq), 3),
        **win_s,
        "equity_curve":    equity_curve,
        "trades":          trade_log[-50:],   # last 50 for display
        "backtest_at":     datetime.now(timezone.utc).isoformat(),
    }

    # Save
    key  = f"{abbr}_{symbol}_{horizon}"
    path = RESULTS_DIR / f"{key}.pkl"
    joblib.dump(result, path)
    return result


# ── Multi-symbol backtest ─────────────────────────────────────────────────────
def run_multi_backtest(abbr: str, symbols: list, horizon: str,
                       initial_capital: float = 10_000.0) -> dict:
    """Run backtest for one agent across many symbols, return summary table."""
    from services.market import get_ohlcv
    rows = []
    for sym in symbols:
        try:
            df = get_ohlcv(sym, horizon)
            if df is None or len(df) < 60:
                rows.append({"symbol": sym, "error": "no_data"})
                continue
            r = run_backtest(abbr, sym, horizon, df, initial_capital)
            rows.append({
                "symbol":           sym,
                "total_return":     r.get("total_return"),
                "benchmark_return": r.get("benchmark_return"),
                "alpha":            r.get("alpha"),
                "sharpe":           r.get("sharpe"),
                "max_drawdown":     r.get("max_drawdown"),
                "win_rate":         r.get("win_rate"),
                "total_trades":     r.get("total_trades"),
                "profit_factor":    r.get("profit_factor"),
            })
        except Exception as e:
            rows.append({"symbol": sym, "error": str(e)[:80]})

    good  = [r for r in rows if "error" not in r]
    total = len(good)
    summary = {
        "abbr":             abbr,
        "horizon":          horizon,
        "symbols_tested":   len(rows),
        "symbols_ok":       total,
        "avg_return":       round(float(np.mean([r["total_return"] for r in good])), 2) if good else 0,
        "avg_alpha":        round(float(np.mean([r["alpha"]        for r in good])), 2) if good else 0,
        "avg_sharpe":       round(float(np.mean([r["sharpe"]       for r in good])), 3) if good else 0,
        "avg_drawdown":     round(float(np.mean([r["max_drawdown"] for r in good])), 2) if good else 0,
        "best_symbol":      max(good, key=lambda r: r["sharpe"])["symbol"] if good else None,
        "worst_symbol":     min(good, key=lambda r: r["sharpe"])["symbol"] if good else None,
        "rows":             rows,
        "backtest_at":      datetime.now(timezone.utc).isoformat(),
    }
    return summary


# ── List saved backtest results ───────────────────────────────────────────────
def list_results() -> list:
    rows = []
    for p in sorted(RESULTS_DIR.glob("*.pkl"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            r = joblib.load(p)
            rows.append({
                "abbr":         r.get("abbr"),
                "symbol":       r.get("symbol"),
                "horizon":      r.get("horizon"),
                "total_return": r.get("total_return"),
                "alpha":        r.get("alpha"),
                "sharpe":       r.get("sharpe"),
                "max_drawdown": r.get("max_drawdown"),
                "win_rate":     r.get("win_rate"),
                "total_trades": r.get("total_trades"),
                "backtest_at":  r.get("backtest_at"),
            })
        except Exception:
            pass
    return rows

def get_result(abbr: str, symbol: str, horizon: str) -> dict | None:
    p = RESULTS_DIR / f"{abbr}_{symbol}_{horizon}.pkl"
    return joblib.load(p) if p.exists() else None
