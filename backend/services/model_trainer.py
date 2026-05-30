"""ML Model Trainer — scikit-learn models per agent per horizon."""
import logging
from pathlib import Path
import numpy as np
import pandas as pd
import joblib

logger = logging.getLogger(__name__)
MODEL_DIR = Path(__file__).parent.parent / "models_cache"
MODEL_DIR.mkdir(exist_ok=True)

FEATURE_COLS = ["rsi","macd","macd_hist","bb_pct","bb_width","roc_5","roc_10",
                "roc_20","momentum","atr","vol_ratio","ret_1","ret_5",
                "above_sma50","trend_slope","signal"]
LOOKAHEAD = {"scalping":3,"day":5,"swing":10,"position":20}
REGRESSION_AGENTS = {"PPO","VOL","OPT"}

def _mpath(abbr,sym,h): return MODEL_DIR/f"{abbr}_{sym}_{h}.pkl"
def _metapath(abbr,sym,h): return MODEL_DIR/f"{abbr}_{sym}_{h}_meta.pkl"

def _features(df):
    avail = [c for c in FEATURE_COLS if c in df.columns]
    X = df[avail].copy().replace([np.inf,-np.inf],np.nan).ffill().fillna(0)
    return X, avail

def train_agent_model(abbr, symbol, horizon, df, force=False):
    mp = _mpath(abbr,symbol,horizon)
    if mp.exists() and not force:
        meta = joblib.load(_metapath(abbr,symbol,horizon)) if _metapath(abbr,symbol,horizon).exists() else {}
        return {**meta,"trained":False,"cached":True}
    X, feats = _features(df)
    lookahead = LOOKAHEAD.get(horizon,5)
    close = df["close"].loc[X.index]
    if len(X) < 80:
        return {"trained":False,"error":"insufficient_data","samples":len(X)}
    if abbr in REGRESSION_AGENTS:
        y = close.shift(-lookahead)/close - 1
    else:
        thresh = 0.002 if horizon=="scalping" else 0.005
        fwd = close.shift(-lookahead)/close - 1
        y = (fwd > thresh).astype(int)
    Xa = X.iloc[:-lookahead]; ya = y.iloc[:-lookahead].dropna()
    Xa = Xa.loc[ya.index]
    if len(Xa) < 80:
        return {"trained":False,"error":"not_enough_aligned","samples":len(Xa)}
    try:
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler
        if abbr in REGRESSION_AGENTS:
            from sklearn.ensemble import GradientBoostingRegressor
            model = Pipeline([("sc",StandardScaler()),("m",GradientBoostingRegressor(n_estimators=60,max_depth=3,random_state=42))])
            model.fit(Xa.values, ya.values)
            from sklearn.metrics import r2_score
            acc = float(np.clip(r2_score(ya.values, model.predict(Xa.values)),0,1))
        else:
            from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
            from sklearn.linear_model import LogisticRegression
            clf_map = {"MOM":GradientBoostingClassifier(n_estimators=60,max_depth=4,random_state=42),
                       "DQN":RandomForestClassifier(n_estimators=80,random_state=42),
                       "MAC":RandomForestClassifier(n_estimators=80,random_state=42),
                       "MRV":LogisticRegression(C=0.5,max_iter=300,random_state=42),
                       "SEN":LogisticRegression(C=1.0,max_iter=300,random_state=42),
                       "REG":GradientBoostingClassifier(n_estimators=50,max_depth=3,random_state=42)}
            clf = clf_map.get(abbr, GradientBoostingClassifier(n_estimators=50,max_depth=3,random_state=42))
            model = Pipeline([("sc",StandardScaler()),("m",clf)])
            model.fit(Xa.values, ya.values)
            from sklearn.metrics import accuracy_score
            acc = float(accuracy_score(ya.values, model.predict(Xa.values)))
        fi = {}
        try:
            m = model.steps[-1][1]
            imps = getattr(m,"feature_importances_",None) or (np.abs(getattr(m,"coef_",np.ones(len(feats)))[0] if hasattr(getattr(m,"coef_",None),"__len__") and getattr(m,"coef_").ndim>1 else np.abs(getattr(m,"coef_",np.ones(len(feats))))))
            imps = imps/imps.sum()
            fi = {feats[i]:round(float(v),4) for i,v in enumerate(imps) if i<len(feats)}
        except: pass
        joblib.dump(model, mp)
        import pandas as _pd
        meta = {"trained":True,"cached":False,"samples":len(Xa),"accuracy":round(acc,4),
                "feature_cols":feats,"feature_importance":dict(sorted(fi.items(),key=lambda x:-x[1])[:8]),
                "trained_at":_pd.Timestamp.now(tz="UTC").isoformat()}
        joblib.dump(meta, _metapath(abbr,symbol,horizon))
        return meta
    except Exception as e:
        return {"trained":False,"error":str(e)}

def predict(abbr, symbol, horizon, df):
    mp = _mpath(abbr,symbol,horizon)
    if not mp.exists():
        return {"action":"HOLD","confidence":0.5,"source":"no_model"}
    try:
        model = joblib.load(mp)
        X, _ = _features(df)
        if X.empty: return {"action":"HOLD","confidence":0.5,"source":"no_data"}
        Xl = X.iloc[[-1]].values
        if abbr in REGRESSION_AGENTS:
            pred = float(model.predict(Xl)[0])
            if pred > 0.005: action,conf = "BUY",  min(0.95,0.5+abs(pred)*8)
            elif pred < -0.005: action,conf = "SELL",min(0.95,0.5+abs(pred)*8)
            else: action,conf = "HOLD",0.5
        else:
            proba = model.predict_proba(Xl)[0] if hasattr(model,"predict_proba") else None
            pred_cls = model.predict(Xl)[0]
            conf = float(max(proba)) if proba is not None else 0.65
            action = "BUY" if pred_cls==1 else "SELL"
            if conf < 0.55: action="HOLD"
        return {"action":action,"confidence":round(conf,3),"source":"model"}
    except Exception as e:
        return {"action":"HOLD","confidence":0.5,"source":"error","error":str(e)}

def get_model_info(abbr, symbol, horizon):
    p = _metapath(abbr,symbol,horizon)
    return joblib.load(p) if p.exists() else {"trained":False}
