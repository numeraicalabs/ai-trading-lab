"""
ML Trainer v2 — scikit-learn models with proper time-series validation.

Key improvements over v1:
  - Walk-forward cross-validation (no data leakage)
  - Out-of-sample accuracy on held-out test window
  - Calibration metrics: Brier score, log-loss, precision/recall
  - Multi-symbol training: pool data from multiple stocks
  - Model file verification + metadata schema
"""
import logging, hashlib
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import joblib

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent.parent / "models_cache"
CACHE_DIR.mkdir(exist_ok=True)

# ── Feature columns (also computed in market.add_indicators) ─────────────────
FEATURES = [
    "rsi", "macd", "macd_hist", "bb_pct", "bb_width",
    "roc_5", "roc_10", "roc_20", "momentum", "atr",
    "vol_ratio", "ret_1", "ret_5", "above_sma50", "trend_slope", "signal",
    "z_score_20", "vol_expansion", "gap", "hl_range",
]

LOOKAHEAD  = {"scalping": 3, "day": 5, "swing": 10, "position": 20}
REGRESSORS = {"PPO", "VOL", "OPT"}
TEST_RATIO = 0.20   # last 20% of data = out-of-sample test set

def _model_path(abbr, sym, h): return CACHE_DIR / f"{abbr}_{sym}_{h}.pkl"
def _meta_path (abbr, sym, h): return CACHE_DIR / f"{abbr}_{sym}_{h}_meta.pkl"

def _build_features(df: pd.DataFrame):
    cols = [c for c in FEATURES if c in df.columns]
    X    = df[cols].replace([np.inf, -np.inf], np.nan).ffill().fillna(0)
    return X, cols

def _make_estimator(abbr: str, n_samples: int):
    from sklearn.ensemble import (GradientBoostingClassifier, GradientBoostingRegressor,
                                   RandomForestClassifier)
    from sklearn.linear_model import LogisticRegression, Ridge

    # Scale trees with data size (more data = more estimators, up to cap)
    n_est = min(150, max(50, n_samples // 25))

    if abbr in REGRESSORS:
        return {
            "PPO": GradientBoostingRegressor(n_estimators=n_est, max_depth=3,
                                              learning_rate=0.05, random_state=42),
            "VOL": GradientBoostingRegressor(n_estimators=n_est, max_depth=3,
                                              subsample=0.8, random_state=42),
            "OPT": Ridge(alpha=0.5),
        }.get(abbr, GradientBoostingRegressor(n_estimators=n_est, random_state=42))
    else:
        return {
            "MOM": GradientBoostingClassifier(n_estimators=n_est, max_depth=4,
                                               learning_rate=0.05, subsample=0.8, random_state=42),
            "DQN": RandomForestClassifier(n_estimators=n_est, max_depth=6,
                                           min_samples_leaf=5, random_state=42),
            "MAC": RandomForestClassifier(n_estimators=n_est, max_depth=5, random_state=42),
            "MRV": LogisticRegression(C=0.5, max_iter=500, random_state=42),
            "SEN": LogisticRegression(C=1.0, max_iter=500, random_state=42),
            "REG": GradientBoostingClassifier(n_estimators=n_est, max_depth=3,
                                               learning_rate=0.05, random_state=42),
        }.get(abbr, GradientBoostingClassifier(n_estimators=n_est, random_state=42))


# ── Core train function ───────────────────────────────────────────────────────
def train(abbr: str, symbol: str, horizon: str,
          df: pd.DataFrame, force: bool = False,
          extra_symbols: list = None) -> dict:
    """
    Train a model for (abbr, symbol, horizon).

    extra_symbols: additional symbols whose data is pooled to enrich training.
    Returns a metadata dict that is also saved as _meta.pkl.
    """
    mp = _model_path(abbr, symbol, horizon)
    if mp.exists() and not force:
        cached_meta = joblib.load(_meta_path(abbr, symbol, horizon)) \
            if _meta_path(abbr, symbol, horizon).exists() else {}
        return {**cached_meta, "trained": False, "cached": True}

    # ── Optionally enrich with pooled symbols ─────────────────────────────
    if extra_symbols:
        from services.market import get_ohlcv, add_indicators
        frames = [df]
        for sym2 in extra_symbols[:8]:  # cap at 8 extra to control training time
            try:
                df2 = get_ohlcv(sym2, horizon)
                if df2 is not None and len(df2) > 100:
                    frames.append(add_indicators(df2))
            except Exception:
                pass
        df_train_src = pd.concat(frames, ignore_index=True) if len(frames) > 1 else df
    else:
        df_train_src = df

    X_all, cols = _build_features(df_train_src)
    la          = LOOKAHEAD.get(horizon, 5)
    close_all   = df_train_src["close"].loc[X_all.index]

    if len(X_all) < 100:
        return {"trained": False, "error": "insufficient_data", "samples": len(X_all)}

    # ── Labels ────────────────────────────────────────────────────────────
    if abbr in REGRESSORS:
        y_all = close_all.shift(-la) / close_all - 1
    else:
        thresh = 0.002 if horizon == "scalping" else 0.005
        y_all  = (close_all.shift(-la) / close_all - 1 > thresh).astype(int)

    X_all = X_all.iloc[:-la]
    y_all = y_all.iloc[:-la].dropna()
    X_all = X_all.loc[y_all.index]

    if len(X_all) < 100:
        return {"trained": False, "error": "alignment_failed", "samples": len(X_all)}

    # ── Temporal train/test split (NO shuffle — preserves time order) ─────
    n_test  = max(20, int(len(X_all) * TEST_RATIO))
    n_train = len(X_all) - n_test

    X_train, X_test = X_all.values[:n_train], X_all.values[n_train:]
    y_train, y_test = y_all.values[:n_train], y_all.values[n_train:]

    # ── Walk-forward cross-validation (3 folds) ───────────────────────────
    wf_scores = []
    fold_size = n_train // 4
    for fold in range(1, 4):
        wf_end   = fold * fold_size
        wf_val_s = wf_end
        wf_val_e = min(wf_end + fold_size, n_train)
        if wf_val_e - wf_val_s < 20:
            continue
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler
        est_wf = _make_estimator(abbr, wf_end)
        m_wf   = Pipeline([("sc", StandardScaler()), ("m", est_wf)])
        try:
            m_wf.fit(X_train[:wf_end], y_train[:wf_end])
            if abbr in REGRESSORS:
                from sklearn.metrics import r2_score
                s = float(np.clip(r2_score(y_train[wf_val_s:wf_val_e],
                                           m_wf.predict(X_train[wf_val_s:wf_val_e])), 0, 1))
            else:
                from sklearn.metrics import accuracy_score
                s = float(accuracy_score(y_train[wf_val_s:wf_val_e],
                                         m_wf.predict(X_train[wf_val_s:wf_val_e])))
            wf_scores.append(s)
        except Exception:
            pass

    cv_mean = round(float(np.mean(wf_scores)), 4) if wf_scores else 0.0
    cv_std  = round(float(np.std(wf_scores)),  4) if wf_scores else 0.0

    # ── Final model on full train set ─────────────────────────────────────
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    est   = _make_estimator(abbr, n_train)
    model = Pipeline([("sc", StandardScaler()), ("m", est)])
    try:
        model.fit(X_train, y_train)
    except Exception as e:
        return {"trained": False, "error": str(e)}

    # ── Out-of-sample test set metrics ────────────────────────────────────
    oos_metrics: dict = {}
    if abbr in REGRESSORS:
        from sklearn.metrics import r2_score, mean_absolute_error
        y_pred_oos = model.predict(X_test)
        oos_acc    = float(np.clip(r2_score(y_test, y_pred_oos), 0, 1))
        oos_metrics["r2"]  = round(oos_acc, 4)
        oos_metrics["mae"] = round(float(mean_absolute_error(y_test, y_pred_oos)), 6)
        # Direction accuracy
        dir_acc = float(np.mean(np.sign(y_pred_oos) == np.sign(y_test)))
        oos_metrics["direction_accuracy"] = round(dir_acc, 4)
        train_acc = float(np.clip(r2_score(y_train, model.predict(X_train)), 0, 1))
    else:
        from sklearn.metrics import (accuracy_score, precision_score, recall_score,
                                      f1_score, log_loss, brier_score_loss, confusion_matrix)
        y_pred_oos  = model.predict(X_test)
        y_proba_oos = model.predict_proba(X_test)[:, 1] if hasattr(model, "predict_proba") else None

        oos_acc = float(accuracy_score(y_test, y_pred_oos))
        oos_metrics["accuracy"]  = round(oos_acc, 4)
        oos_metrics["precision"] = round(float(precision_score(y_test, y_pred_oos, zero_division=0)), 4)
        oos_metrics["recall"]    = round(float(recall_score(y_test, y_pred_oos,    zero_division=0)), 4)
        oos_metrics["f1"]        = round(float(f1_score(y_test, y_pred_oos,        zero_division=0)), 4)
        if y_proba_oos is not None and len(np.unique(y_test)) > 1:
            try:
                oos_metrics["log_loss"]    = round(float(log_loss(y_test, y_proba_oos)), 4)
                oos_metrics["brier_score"] = round(float(brier_score_loss(y_test, y_proba_oos)), 4)
            except Exception:
                pass
        cm = confusion_matrix(y_test, y_pred_oos).tolist()
        oos_metrics["confusion_matrix"] = cm
        train_acc = float(accuracy_score(y_train, model.predict(X_train)))

    overfit_gap = round(train_acc - oos_acc, 4)

    # ── Feature importance ────────────────────────────────────────────────
    fi: dict = {}
    try:
        m_est = model.steps[-1][1]
        imps  = getattr(m_est, "feature_importances_", None)
        if imps is None:
            coef = getattr(m_est, "coef_", None)
            if coef is not None:
                imps = np.abs(coef[0] if coef.ndim > 1 else coef)
        if imps is not None:
            imps = imps / (imps.sum() + 1e-9)
            fi   = {cols[i]: round(float(v), 4) for i, v in enumerate(imps) if i < len(cols)}
            fi   = dict(sorted(fi.items(), key=lambda x: -x[1])[:10])
    except Exception:
        pass

    # ── Save model + metadata ─────────────────────────────────────────────
    joblib.dump(model, mp)
    file_size_kb = round(mp.stat().st_size / 1024, 1)

    meta = {
        # Identity
        "abbr":             abbr,
        "symbol":           symbol,
        "horizon":          horizon,
        # Training quality
        "trained":          True,
        "cached":           False,
        "samples_total":    len(X_all),
        "samples_train":    n_train,
        "samples_test":     n_test,
        "train_accuracy":   round(train_acc, 4),
        "accuracy":         oos_acc,         # OOS — this is the real accuracy
        # Cross-validation
        "cv_mean":          cv_mean,
        "cv_std":           cv_std,
        "cv_folds":         len(wf_scores),
        # Overfit indicator
        "overfit_gap":      overfit_gap,
        "overfit_flag":     overfit_gap > 0.15,
        # Detailed OOS metrics
        "oos_metrics":      oos_metrics,
        # Features
        "feature_cols":     cols,
        "feature_importance": fi,
        # File
        "model_path":       str(mp),
        "file_size_kb":     file_size_kb,
        "extra_symbols":    extra_symbols or [],
        # Timestamp
        "trained_at":       datetime.now(timezone.utc).isoformat(),
    }
    joblib.dump(meta, _meta_path(abbr, symbol, horizon))
    logger.info(f"Trained {abbr}/{symbol}/{horizon}: OOS={oos_acc:.3f} CV={cv_mean:.3f}±{cv_std:.3f}")
    # Persist to Supabase
    try:
        from services.db import save_model_version
        save_model_version(meta)
    except Exception:
        pass
    return meta


# ── Predict ───────────────────────────────────────────────────────────────────
def predict(abbr: str, symbol: str, horizon: str, df: pd.DataFrame) -> dict:
    mp = _model_path(abbr, symbol, horizon)
    if not mp.exists():
        return {"action": "HOLD", "confidence": 0.5, "source": "no_model"}
    try:
        model = joblib.load(mp)
        X, _  = _build_features(df)
        if X.empty:
            return {"action": "HOLD", "confidence": 0.5, "source": "no_data"}
        Xl = X.iloc[[-1]].values
        if abbr in REGRESSORS:
            val = float(model.predict(Xl)[0])
            if   val >  0.005: action, conf = "BUY",  min(0.95, 0.5 + abs(val) * 8)
            elif val < -0.005: action, conf = "SELL", min(0.95, 0.5 + abs(val) * 8)
            else:              action, conf = "HOLD", 0.5
        else:
            proba  = model.predict_proba(Xl)[0] if hasattr(model, "predict_proba") else None
            pred   = model.predict(Xl)[0]
            conf   = float(max(proba)) if proba is not None else 0.65
            action = "BUY" if pred == 1 else "SELL"
            if conf < 0.55: action = "HOLD"
        return {"action": action, "confidence": round(conf, 3), "source": "model"}
    except Exception as e:
        return {"action": "HOLD", "confidence": 0.5, "source": "error", "error": str(e)}


# ── Model registry ────────────────────────────────────────────────────────────
def list_models() -> list:
    """List all saved models with their metadata."""
    rows = []
    for mp in sorted(CACHE_DIR.glob("*_meta.pkl")):
        try:
            meta = joblib.load(mp)
            model_file = Path(meta.get("model_path", ""))
            rows.append({
                "abbr":           meta.get("abbr"),
                "symbol":         meta.get("symbol"),
                "horizon":        meta.get("horizon"),
                "accuracy_oos":   round(meta.get("accuracy", 0) * 100, 1),
                "accuracy_train": round(meta.get("train_accuracy", 0) * 100, 1),
                "cv_mean":        round(meta.get("cv_mean", 0) * 100, 1),
                "overfit_gap":    round(meta.get("overfit_gap", 0) * 100, 1),
                "overfit_flag":   meta.get("overfit_flag", False),
                "samples_total":  meta.get("samples_total", 0),
                "samples_train":  meta.get("samples_train", 0),
                "samples_test":   meta.get("samples_test", 0),
                "feature_importance": meta.get("feature_importance", {}),
                "oos_metrics":    meta.get("oos_metrics", {}),
                "extra_symbols":  meta.get("extra_symbols", []),
                "file_size_kb":   meta.get("file_size_kb", 0),
                "model_exists":   model_file.exists() if model_file.name else False,
                "trained_at":     meta.get("trained_at"),
            })
        except Exception:
            pass
    return rows

def get_meta(abbr: str, symbol: str, horizon: str) -> dict:
    p = _meta_path(abbr, symbol, horizon)
    return joblib.load(p) if p.exists() else {"trained": False}

def verify_models(agents: list, horizons: list = None) -> dict:
    """Check which expected models exist vs are missing."""
    horizons = horizons or ["swing"]
    from services.agents import CATALOGUE
    results = {"present": [], "missing": [], "summary": {}}
    for abbr in (agents or list(CATALOGUE.keys())):
        cfg = CATALOGUE.get(abbr, {})
        sym = cfg.get("assets", ["SPY"])[0]
        for h in horizons:
            mp   = _model_path(abbr, sym, h)
            meta = joblib.load(_meta_path(abbr, sym, h)) if _meta_path(abbr, sym, h).exists() else {}
            entry = {"abbr": abbr, "symbol": sym, "horizon": h,
                     "file_exists": mp.exists(),
                     "accuracy_oos": round(meta.get("accuracy", 0) * 100, 1),
                     "trained_at":   meta.get("trained_at"),
                     "overfit_flag": meta.get("overfit_flag", False)}
            (results["present"] if mp.exists() else results["missing"]).append(entry)
    results["summary"] = {
        "total":    len(results["present"]) + len(results["missing"]),
        "present":  len(results["present"]),
        "missing":  len(results["missing"]),
        "coverage": round(len(results["present"]) / max(1, len(results["present"]) + len(results["missing"])) * 100, 1),
    }
    return results
