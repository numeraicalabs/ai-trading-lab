"""
Backtest engine v2 — IS/OOS/Walk-Forward/Monte Carlo on many tickers.

Modes:
  IS_OOS       — split data: 70% in-sample train, 30% out-of-sample test
  WALK_FORWARD — rolling window: retrain every N bars, test on next N
  MONTE_CARLO  — bootstrap permutation of signals → distribution of outcomes
  MULTI_TICKER — same agent on a list of symbols, return summary table

Metrics: Sharpe, Sortino, Calmar, MaxDD, WinRate, ProfitFactor, Alpha, IC
"""
import logging, asyncio
from datetime import datetime, timezone
from pathlib import Path as FilePath
import numpy as np
import pandas as pd
import joblib

logger = logging.getLogger(__name__)

RESULTS_DIR = FilePath(__file__).parent.parent / "backtest_results"
RESULTS_DIR.mkdir(exist_ok=True)

FEE  = 0.001
SLIP = 0.0005

IS_RATIO  = 0.70   # 70% in-sample for IS_OOS mode
WF_WINDOW = 40     # walk-forward: train on N bars, test on next N


# ── Metrics helpers ────────────────────────────────────────────────────────────
def _freq(horizon):
    return {"scalping":1440,"day":252*6,"swing":252,"position":52}.get(horizon,252)

def _sharpe(r, freq=252):
    if len(r)<5 or r.std()==0: return 0.0
    return float(np.sqrt(freq)*r.mean()/(r.std()+1e-9))

def _sortino(r, freq=252):
    neg = r[r<0]
    if len(neg)<3 or neg.std()==0: return 0.0
    return float(np.sqrt(freq)*r.mean()/(neg.std()+1e-9))

def _max_drawdown(eq):
    peak = np.maximum.accumulate(eq)
    return float(((eq-peak)/(peak+1e-9)).min())

def _calmar(ret, dd):
    return round(ret/abs(dd+1e-9),3) if dd<0 else 0.0

def _win_stats(trades):
    if not trades:
        return {"win_rate":0,"profit_factor":1,"avg_win":0,"avg_loss":0,
                "total_trades":0,"winning_trades":0,"losing_trades":0}
    wins  = [t["pnl"] for t in trades if t["pnl"]>0]
    loses = [t["pnl"] for t in trades if t["pnl"]<=0]
    gw = sum(wins)  or 0
    gl = abs(sum(loses)) or 1e-9
    return {
        "win_rate":      round(len(wins)/max(len(trades),1)*100,1),
        "profit_factor": round(gw/gl,3),
        "avg_win":       round(float(np.mean(wins))  if wins  else 0,4),
        "avg_loss":      round(float(np.mean(loses)) if loses else 0,4),
        "total_trades":  len(trades),
        "winning_trades":len(wins),
        "losing_trades": len(loses),
    }

def _information_coefficient(signals, returns, lookahead=5):
    """Rank correlation between signal scores and future returns."""
    try:
        fwd = returns.shift(-lookahead)
        sig_num = signals.map({"BUY":1,"SELL":-1,"HOLD":0}).astype(float)
        valid = (~sig_num.isna()) & (~fwd.isna())
        if valid.sum() < 20:
            return 0.0
        from scipy.stats import spearmanr
        ic, _ = spearmanr(sig_num[valid], fwd[valid])
        return round(float(ic), 4) if not np.isnan(ic) else 0.0
    except Exception:
        return 0.0


# ── Signal generation ──────────────────────────────────────────────────────────
def _gen_signals(abbr, symbol, horizon, df):
    from services.market import add_indicators
    from services.trainer import _build_features, REGRESSORS, _model_path

    mp = _model_path(abbr, symbol, horizon)
    if not mp.exists():
        logger.debug(f"No model {abbr}/{symbol}/{horizon}")
        return pd.Series("HOLD", index=df.index)

    model = joblib.load(mp)
    X, _  = _build_features(df)
    if X.empty:
        return pd.Series("HOLD", index=df.index)

    if abbr in REGRESSORS:
        preds = model.predict(X.values)
        acts  = np.where(preds>0.005,"BUY",np.where(preds<-0.005,"SELL","HOLD"))
    else:
        proba = model.predict_proba(X.values) if hasattr(model,"predict_proba") else None
        preds = model.predict(X.values)
        if proba is not None:
            acts = np.where(proba.max(axis=1)<0.55,"HOLD",
                   np.where(preds==1,"BUY","SELL"))
        else:
            acts = np.where(preds==1,"BUY","SELL")
    return pd.Series(acts, index=X.index)


# ── Core simulation engine ─────────────────────────────────────────────────────
def _simulate(closes, signals_series, df_index, capital, label=""):
    n       = len(closes)
    equity  = np.zeros(n)
    equity[0] = capital
    cash    = capital
    pos     = 0.0
    entry   = 0.0
    trades  = []
    signals = signals_series.reindex(df_index).fillna("HOLD")

    for i in range(1, n):
        price = closes[i]
        sig   = signals.iloc[i] if i < len(signals) else "HOLD"

        if sig == "BUY" and pos == 0 and cash > price:
            qty  = (cash*0.95) / (price*(1+SLIP))
            cost = qty*price*(1+SLIP)*(1+FEE)
            if cost <= cash:
                cash -= cost; pos = qty; entry = price

        elif sig == "SELL" and pos > 0:
            proc = pos*price*(1-SLIP)*(1-FEE)
            pnl  = proc - pos*entry*(1+SLIP+FEE)
            trades.append({"ts":str(df_index[i]),"side":"SELL",
                           "price":round(float(price),4),
                           "entry":round(float(entry),4),
                           "pnl":round(float(pnl),4),
                           "pnl_pct":round(float(pnl/(pos*entry+1e-9)),4)})
            cash += proc; pos = 0.0; entry = 0.0

        equity[i] = cash + pos*price

    if pos > 0:
        p   = closes[-1]
        proc = pos*p*(1-SLIP)*(1-FEE)
        pnl  = proc - pos*entry*(1+SLIP+FEE)
        trades.append({"ts":str(df_index[-1]),"side":"CLOSE",
                       "price":round(float(p),4),"entry":round(float(entry),4),
                       "pnl":round(float(pnl),4),
                       "pnl_pct":round(float(pnl/(pos*entry+1e-9)),4)})
        equity[-1] = cash + proc

    return equity, trades


def _metrics(equity, trades, bh_closes, capital, horizon, label, start_i, end_i):
    freq = _freq(horizon)
    rets = np.diff(equity)/(equity[:-1]+1e-9)
    tr   = (equity[-1]-capital)/capital

    bh_ret   = (bh_closes[end_i]-bh_closes[start_i])/bh_closes[start_i]
    bh_eq    = capital*(1+np.linspace(0,bh_ret,end_i-start_i+1))
    bh_rets  = np.diff(bh_eq)/(bh_eq[:-1]+1e-9)

    dd  = _max_drawdown(equity)
    ws  = _win_stats(trades)
    return {
        "label":            label,
        "bars":             len(equity),
        "total_return":     round(tr*100,2),
        "benchmark_return": round(bh_ret*100,2),
        "alpha":            round((tr-bh_ret)*100,2),
        "sharpe":           round(_sharpe(rets,freq),3),
        "sortino":          round(_sortino(rets,freq),3),
        "bh_sharpe":        round(_sharpe(bh_rets,freq),3),
        "max_drawdown":     round(dd*100,2),
        "calmar":           _calmar(tr,dd),
        "final_equity":     round(float(equity[-1]),2),
        **ws,
        "equity_curve": [{"i":i,"v":round(float(equity[i]),2),
                          "bh":round(float(bh_eq[i] if i<len(bh_eq) else bh_eq[-1]),2)}
                         for i in range(0,len(equity),max(1,len(equity)//150))],
        "trades": trades[-30:],
    }


# ── IS / OOS split backtest ────────────────────────────────────────────────────
def run_is_oos(abbr, symbol, horizon, df, capital=10_000.0):
    """
    Splits data 70/30:
      - in-sample  (0 → 70%): where the model was (approximately) trained
      - out-of-sample (70% → 100%): unseen data, true generalization
    Returns both periods separately + combined.
    """
    from services.market import add_indicators
    df = add_indicators(df)
    if len(df) < 80:
        return {"error": "insufficient_data"}

    closes  = df["close"].values
    n       = len(closes)
    n_is    = int(n * IS_RATIO)

    signals = _gen_signals(abbr, symbol, horizon, df)
    common  = df.index.intersection(signals.index)
    df      = df.loc[common]
    signals = signals.reindex(common).fillna("HOLD")
    closes  = df["close"].values
    n       = len(closes)
    n_is    = int(n * IS_RATIO)

    # In-sample
    eq_is, tr_is = _simulate(closes[:n_is], signals.iloc[:n_is], df.index[:n_is], capital)
    m_is = _metrics(eq_is, tr_is, closes, capital, horizon, "in_sample", 0, n_is-1)

    # Out-of-sample
    eq_oos, tr_oos = _simulate(closes[n_is:], signals.iloc[n_is:], df.index[n_is:], capital)
    m_oos = _metrics(eq_oos, tr_oos, closes, capital, horizon, "out_of_sample", n_is, n-1)

    # Full
    eq_full, tr_full = _simulate(closes, signals, df.index, capital)
    m_full = _metrics(eq_full, tr_full, closes, capital, horizon, "full", 0, n-1)

    ic = _information_coefficient(signals, df["close"].pct_change())

    result = {
        "mode":         "is_oos",
        "abbr":         abbr,
        "symbol":       symbol,
        "horizon":      horizon,
        "is_ratio":     IS_RATIO,
        "is_bars":      n_is,
        "oos_bars":     n - n_is,
        "is":           m_is,
        "oos":          m_oos,
        "full":         m_full,
        "ic":           ic,
        "generalization_score": round(m_oos["sharpe"] / max(m_is["sharpe"], 0.01), 3),
        "start":        str(df.index[0]),
        "end":          str(df.index[-1]),
        "backtest_at":  datetime.now(timezone.utc).isoformat(),
    }
    joblib.dump(result, RESULTS_DIR / f"{abbr}_{symbol}_{horizon}_isoos.pkl")
    return result


# ── Walk-forward backtest ─────────────────────────────────────────────────────
def run_walk_forward(abbr, symbol, horizon, df, capital=10_000.0, n_folds=5):
    """
    Rolling window: divide data into n_folds pairs of (train_window, test_window).
    Each fold retrains the model on the train window, tests on the next.
    Returns per-fold metrics + aggregate.
    """
    from services.market import add_indicators
    from services.trainer import train as retrain

    df = add_indicators(df)
    if len(df) < n_folds * 60:
        return {"error": "insufficient_data_for_walk_forward"}

    closes  = df["close"].values
    n       = len(closes)
    fold_sz = n // (n_folds + 1)
    folds   = []
    capital_remaining = capital

    for k in range(n_folds):
        train_end  = (k+1) * fold_sz
        test_start = train_end
        test_end   = min(test_start + fold_sz, n)
        if test_end - test_start < 20:
            continue

        # Retrain on train window
        df_train = df.iloc[:train_end]
        meta = retrain(abbr, symbol, horizon, df_train, force=True)

        # Test on next window
        df_test = df.iloc[test_start:test_end]
        signals = _gen_signals(abbr, symbol, horizon, df_test)
        common  = df_test.index.intersection(signals.index)
        if len(common) < 10:
            continue
        df_t    = df_test.loc[common]
        sig_t   = signals.reindex(common).fillna("HOLD")

        eq, trs  = _simulate(df_t["close"].values, sig_t, df_t.index, capital)
        m        = _metrics(eq, trs, closes, capital, horizon,
                            f"fold_{k+1}", test_start, test_end-1)
        m["train_bars"]  = train_end
        m["oos_accuracy"]= round(meta.get("accuracy",0)*100,1)
        folds.append(m)
        capital_remaining = eq[-1]   # carry capital forward

    if not folds:
        return {"error": "no_valid_folds"}

    agg = {
        "mode":          "walk_forward",
        "abbr":          abbr,
        "symbol":        symbol,
        "horizon":       horizon,
        "n_folds":       len(folds),
        "avg_return":    round(float(np.mean([f["total_return"] for f in folds])),2),
        "avg_alpha":     round(float(np.mean([f["alpha"]        for f in folds])),2),
        "avg_sharpe":    round(float(np.mean([f["sharpe"]       for f in folds])),3),
        "avg_drawdown":  round(float(np.mean([f["max_drawdown"] for f in folds])),2),
        "positive_folds":sum(1 for f in folds if f["total_return"]>0),
        "sharpe_std":    round(float(np.std([f["sharpe"] for f in folds])),3),
        "folds":         folds,
        "backtest_at":   datetime.now(timezone.utc).isoformat(),
    }
    joblib.dump(agg, RESULTS_DIR / f"{abbr}_{symbol}_{horizon}_wf.pkl")
    return agg


# ── Monte Carlo simulation ────────────────────────────────────────────────────
def run_monte_carlo(abbr, symbol, horizon, df,
                    capital=10_000.0, n_sims=500, confidence=0.95):
    """
    Bootstrap the trade sequence n_sims times.
    Returns distribution of total_return, max_drawdown, Sharpe.
    """
    from services.market import add_indicators
    df = add_indicators(df)

    signals = _gen_signals(abbr, symbol, horizon, df)
    common  = df.index.intersection(signals.index)
    df      = df.loc[common]
    signals = signals.reindex(common).fillna("HOLD")
    closes  = df["close"].values

    eq_base, trades_base = _simulate(closes, signals, df.index, capital)
    if not trades_base:
        return {"error": "no_trades_to_simulate"}

    pnls  = np.array([t["pnl"] for t in trades_base])
    n_tr  = len(pnls)

    sim_returns = []
    sim_dds     = []
    sim_sharpes = []

    rng = np.random.default_rng(42)
    for _ in range(n_sims):
        shuffled = rng.choice(pnls, size=n_tr, replace=True)
        eq_sim   = capital + np.cumsum(shuffled)
        eq_sim   = np.insert(eq_sim, 0, capital)
        rets     = np.diff(eq_sim)/(eq_sim[:-1]+1e-9)
        sim_returns.append((eq_sim[-1]-capital)/capital*100)
        sim_dds.append(_max_drawdown(eq_sim)*100)
        sim_sharpes.append(_sharpe(rets, _freq(horizon)))

    sim_returns = np.array(sim_returns)
    sim_dds     = np.array(sim_dds)
    sim_sharpes = np.array(sim_sharpes)
    alpha       = 1 - confidence

    result = {
        "mode":           "monte_carlo",
        "abbr":           abbr,
        "symbol":         symbol,
        "horizon":        horizon,
        "n_sims":         n_sims,
        "n_trades":       n_tr,
        "base_return":    round(float((eq_base[-1]-capital)/capital*100),2),
        "base_sharpe":    round(_sharpe(np.diff(eq_base)/(eq_base[:-1]+1e-9),_freq(horizon)),3),
        "base_drawdown":  round(_max_drawdown(eq_base)*100,2),
        "return_median":  round(float(np.median(sim_returns)),2),
        "return_var":     round(float(np.percentile(sim_returns,alpha*100)),2),
        "return_cvar":    round(float(sim_returns[sim_returns<=np.percentile(sim_returns,alpha*100)].mean()),2),
        "drawdown_p95":   round(float(np.percentile(sim_dds,95)),2),
        "sharpe_p10":     round(float(np.percentile(sim_sharpes,10)),3),
        "prob_positive":  round(float((sim_returns>0).mean()*100),1),
        "prob_sharpe_1":  round(float((sim_sharpes>1).mean()*100),1),
        "distribution": {
            "return_hist":   np.histogram(sim_returns,bins=30)[0].tolist(),
            "return_edges":  [round(x,2) for x in np.histogram(sim_returns,bins=30)[1].tolist()],
            "sharpe_hist":   np.histogram(sim_sharpes,bins=20)[0].tolist(),
            "sharpe_edges":  [round(x,3) for x in np.histogram(sim_sharpes,bins=20)[1].tolist()],
        },
        "backtest_at": datetime.now(timezone.utc).isoformat(),
    }
    joblib.dump(result, RESULTS_DIR / f"{abbr}_{symbol}_{horizon}_mc.pkl")
    return result


# ── Multi-ticker backtest ─────────────────────────────────────────────────────
async def run_multi_ticker(abbr, symbols, horizon, capital=10_000.0,
                           mode="is_oos", max_workers=6):
    """
    Run is_oos or walk_forward for one agent across many symbols.
    Uses asyncio executor for parallelism.
    Returns summary table + per-symbol detail.
    """
    from services.market import get_ohlcv
    import functools

    rows    = []
    loop    = asyncio.get_event_loop()
    sem     = asyncio.Semaphore(max_workers)

    async def _one(sym):
        async with sem:
            try:
                df = await loop.run_in_executor(None, get_ohlcv, sym, horizon)
                if df is None or len(df) < 80:
                    return {"symbol": sym, "error": "no_data"}
                if mode == "walk_forward":
                    fn = functools.partial(run_walk_forward, abbr, sym, horizon, df, capital)
                else:
                    fn = functools.partial(run_is_oos, abbr, sym, horizon, df, capital)
                result = await loop.run_in_executor(None, fn)
                return result
            except Exception as e:
                return {"symbol": sym, "error": str(e)[:80]}

    results = await asyncio.gather(*[_one(sym) for sym in symbols[:30]])

    # Summary table
    for r in results:
        if "error" in r:
            rows.append({"symbol": r.get("symbol","?"), "error": r["error"]})
            continue
        if mode == "walk_forward":
            rows.append({
                "symbol":     r["symbol"],
                "avg_return": r.get("avg_return"),
                "avg_alpha":  r.get("avg_alpha"),
                "avg_sharpe": r.get("avg_sharpe"),
                "pos_folds":  r.get("positive_folds"),
                "n_folds":    r.get("n_folds"),
            })
        else:
            oos = r.get("oos", {})
            rows.append({
                "symbol":         r["symbol"],
                "oos_return":     oos.get("total_return"),
                "oos_alpha":      oos.get("alpha"),
                "oos_sharpe":     oos.get("sharpe"),
                "oos_drawdown":   oos.get("max_drawdown"),
                "oos_win_rate":   oos.get("win_rate"),
                "generalization": r.get("generalization_score"),
                "ic":             r.get("ic"),
            })

    good = [r for r in rows if "error" not in r]
    key  = "oos_sharpe" if mode == "is_oos" else "avg_sharpe"
    good.sort(key=lambda x: -(x.get(key) or 0))

    return {
        "abbr":            abbr,
        "horizon":         horizon,
        "mode":            mode,
        "symbols_tested":  len(results),
        "symbols_ok":      len(good),
        "avg_oos_sharpe":  round(float(np.mean([r.get(key,0) for r in good])),3) if good else 0,
        "best_symbol":     good[0]["symbol"] if good else None,
        "worst_symbol":    good[-1]["symbol"] if good else None,
        "rows":            rows,
        "backtest_at":     datetime.now(timezone.utc).isoformat(),
    }


# ── List / get results ─────────────────────────────────────────────────────────
def list_results(mode=None):
    rows = []
    for p in sorted(RESULTS_DIR.glob("*.pkl"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            r = joblib.load(p)
            m = r.get("mode","")
            if mode and m != mode:
                continue
            rows.append({
                "abbr":        r.get("abbr"),
                "symbol":      r.get("symbol"),
                "horizon":     r.get("horizon"),
                "mode":        m,
                "total_return":r.get("full",{}).get("total_return") or r.get("avg_return") or r.get("base_return"),
                "sharpe":      r.get("full",{}).get("sharpe")      or r.get("avg_sharpe") or r.get("base_sharpe"),
                "alpha":       r.get("full",{}).get("alpha")        or r.get("avg_alpha"),
                "backtest_at": r.get("backtest_at"),
                "file":        p.stem,
            })
        except Exception:
            pass
    return rows

def get_result(file_stem):
    p = RESULTS_DIR / f"{file_stem}.pkl"
    return joblib.load(p) if p.exists() else None

def get_result_by_key(abbr, symbol, horizon, mode="is_oos"):
    suffix = {"is_oos":"isoos","walk_forward":"wf","monte_carlo":"mc"}.get(mode,"isoos")
    p = RESULTS_DIR / f"{abbr}_{symbol}_{horizon}_{suffix}.pkl"
    return joblib.load(p) if p.exists() else None
