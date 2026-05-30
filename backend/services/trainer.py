"""ML trainer — scikit-learn models per agent per horizon, cached as .pkl files."""
import logging
from pathlib import Path
import numpy as np
import pandas as pd
import joblib

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent.parent / "models_cache"
CACHE_DIR.mkdir(exist_ok=True)

FEATURES = ["rsi", "macd", "macd_hist", "bb_pct", "bb_width",
            "roc_5", "roc_10", "roc_20", "momentum", "atr",
            "vol_ratio", "ret_1", "ret_5", "above_sma50", "trend_slope", "signal"]

LOOKAHEAD   = {"scalping": 3, "day": 5, "swing": 10, "position": 20}
REGRESSORS  = {"PPO", "VOL", "OPT"}  # predict return value; others predict direction

def _model_path(abbr, sym, h): return CACHE_DIR / f"{abbr}_{sym}_{h}.pkl"
def _meta_path (abbr, sym, h): return CACHE_DIR / f"{abbr}_{sym}_{h}_meta.pkl"

def _build_features(df: pd.DataFrame):
    cols  = [c for c in FEATURES if c in df.columns]
    X = df[cols].replace([np.inf, -np.inf], np.nan).ffill().fillna(0)
    return X, cols

def train(abbr: str, symbol: str, horizon: str, df: pd.DataFrame, force: bool = False) -> dict:
    mp = _model_path(abbr, symbol, horizon)
    if mp.exists() and not force:
        meta = joblib.load(_meta_path(abbr, symbol, horizon)) if _meta_path(abbr, symbol, horizon).exists() else {}
        return {**meta, "trained": False, "cached": True}

    X, cols = _build_features(df)
    la      = LOOKAHEAD.get(horizon, 5)
    close   = df["close"].loc[X.index]

    if len(X) < 80:
        return {"trained": False, "error": "insufficient_data", "samples": len(X)}

    if abbr in REGRESSORS:
        y = close.shift(-la) / close - 1
    else:
        thresh = 0.002 if horizon == "scalping" else 0.005
        y = (close.shift(-la) / close - 1 > thresh).astype(int)

    Xa = X.iloc[:-la]
    ya = y.iloc[:-la].dropna()
    Xa = Xa.loc[ya.index]

    if len(Xa) < 80:
        return {"trained": False, "error": "alignment_failed", "samples": len(Xa)}

    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression, Ridge

    if abbr in REGRESSORS:
        est = {"PPO": GradientBoostingRegressor(n_estimators=60, max_depth=3, random_state=42),
               "VOL": GradientBoostingRegressor(n_estimators=60, max_depth=3, random_state=42),
               "OPT": Ridge()}.get(abbr, GradientBoostingRegressor(n_estimators=50, random_state=42))
    else:
        est = {"MOM": GradientBoostingClassifier(n_estimators=60, max_depth=4, random_state=42),
               "DQN": RandomForestClassifier(n_estimators=80, random_state=42),
               "MAC": RandomForestClassifier(n_estimators=80, random_state=42),
               "MRV": LogisticRegression(C=0.5, max_iter=300, random_state=42),
               "SEN": LogisticRegression(C=1.0, max_iter=300, random_state=42),
               "REG": GradientBoostingClassifier(n_estimators=50, max_depth=3, random_state=42),
               }.get(abbr, GradientBoostingClassifier(n_estimators=50, random_state=42))

    model = Pipeline([("sc", StandardScaler()), ("m", est)])

    try:
        model.fit(Xa.values, ya.values)
    except Exception as e:
        return {"trained": False, "error": str(e)}

    if abbr in REGRESSORS:
        from sklearn.metrics import r2_score
        acc = float(np.clip(r2_score(ya.values, model.predict(Xa.values)), 0, 1))
    else:
        from sklearn.metrics import accuracy_score
        acc = float(accuracy_score(ya.values, model.predict(Xa.values)))

    # Feature importance
    fi = {}
    try:
        m = model.steps[-1][1]
        imps = getattr(m, "feature_importances_", None)
        if imps is None:
            coef = getattr(m, "coef_", None)
            if coef is not None:
                imps = np.abs(coef[0] if coef.ndim > 1 else coef)
        if imps is not None:
            imps = imps / (imps.sum() + 1e-9)
            fi = {cols[i]: round(float(v), 4) for i, v in enumerate(imps) if i < len(cols)}
            fi = dict(sorted(fi.items(), key=lambda x: -x[1])[:8])
    except Exception:
        pass

    joblib.dump(model, mp)
    meta = {
        "trained": True, "cached": False,
        "samples": len(Xa), "accuracy": round(acc, 4),
        "feature_cols": cols, "feature_importance": fi,
        "trained_at": pd.Timestamp.now(tz="UTC").isoformat(),
    }
    joblib.dump(meta, _meta_path(abbr, symbol, horizon))
    return meta

def predict(abbr: str, symbol: str, horizon: str, df: pd.DataFrame) -> dict:
    mp = _model_path(abbr, symbol, horizon)
    if not mp.exists():
        return {"action": "HOLD", "confidence": 0.5, "source": "no_model"}
    try:
        model   = joblib.load(mp)
        X, _    = _build_features(df)
        if X.empty:
            return {"action": "HOLD", "confidence": 0.5, "source": "no_data"}
        Xl      = X.iloc[[-1]].values
        if abbr in REGRESSORS:
            val = float(model.predict(Xl)[0])
            if val > 0.005:
                action, conf = "BUY",  min(0.95, 0.5 + abs(val) * 8)
            elif val < -0.005:
                action, conf = "SELL", min(0.95, 0.5 + abs(val) * 8)
            else:
                action, conf = "HOLD", 0.5
        else:
            proba   = model.predict_proba(Xl)[0] if hasattr(model, "predict_proba") else None
            pred    = model.predict(Xl)[0]
            conf    = float(max(proba)) if proba is not None else 0.65
            action  = "BUY" if pred == 1 else "SELL"
            if conf < 0.55:
                action = "HOLD"
        return {"action": action, "confidence": round(conf, 3), "source": "model"}
    except Exception as e:
        return {"action": "HOLD", "confidence": 0.5, "source": "error", "error": str(e)}

def get_meta(abbr: str, symbol: str, horizon: str) -> dict:
    p = _meta_path(abbr, symbol, horizon)
    return joblib.load(p) if p.exists() else {"trained": False}
