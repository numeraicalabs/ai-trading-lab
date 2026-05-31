"""
LLM Router — multi-provider, free-tier first.

Priority order (first available wins):
  1. Ollama        — local, free, best quality (available on dev machines)
  2. Groq          — cloud, free tier 6k req/day, very fast (llama3-70b)
  3. HuggingFace   — free inference API (mistral-7b, zephyr)
  4. OpenRouter    — free models (mistral, qwen, gemma)
  5. Local fallback — rule-based text generation (always works, no LLM)

Each agent gets a personalised system prompt reflecting its strategy.
Used for:
  - Commentary after training (interpret OOS metrics, suggest improvements)
  - Signal thesis generation (why BUY/SELL this symbol now)
  - Backtest post-mortem (what worked, what failed, parameter suggestions)
  - Document intelligence (extract features from uploaded PDFs/CSVs)
"""
import os, json, logging, asyncio, re
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── Provider config ────────────────────────────────────────────────────────────
OLLAMA_URL   = os.getenv("OLLAMA_BASE_URL",      "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL",          "llama3")
GROQ_KEY     = os.getenv("GROQ_API_KEY",          "")
GROQ_MODEL   = os.getenv("GROQ_MODEL",            "llama3-70b-8192")
HF_KEY       = os.getenv("HUGGINGFACE_API_KEY",   "")
HF_MODEL     = os.getenv("HF_MODEL",              "mistralai/Mistral-7B-Instruct-v0.3")
OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY",  "")
OR_MODEL     = os.getenv("OPENROUTER_MODEL",      "mistralai/mistral-7b-instruct:free")
TIMEOUT      = int(os.getenv("LLM_TIMEOUT",       "30"))

# Track which providers are working
_provider_status: dict = {
    "ollama":      None,   # None=unknown, True=ok, False=failed
    "groq":        None,
    "huggingface": None,
    "openrouter":  None,
}


# ── Per-agent system prompts ───────────────────────────────────────────────────
AGENT_PERSONAS = {
    "MOM": ("You are a momentum trader with 15 years on equity desks. "
            "You think in terms of trend strength, breakout quality, and volume confirmation. "
            "Be direct, data-driven, concise. Use trading desk language."),
    "MRV": ("You are a statistical arbitrage quant. You think about mean reversion, "
            "z-scores, half-life of price deviations, and pairs trading. "
            "Cite specific numbers. Be skeptical of trends."),
    "PPO": ("You are an RL researcher specialising in policy gradient methods. "
            "You think about reward shaping, exploration-exploitation, and policy stability. "
            "Technical and precise."),
    "DQN": ("You are a deep learning engineer who models markets as MDPs. "
            "You think about Q-value approximation, replay buffers, and epsilon-greedy. "
            "Practical and implementation-focused."),
    "MAC": ("You are a macro hedge fund analyst. You think about central banks, "
            "cross-asset correlations, risk-on/risk-off regimes, and inflation cycles. "
            "Think big picture, multi-asset."),
    "SEN": ("You are an NLP/sentiment specialist who reads earnings calls, "
            "news flow, and social sentiment. You think about information events, "
            "narrative shifts, and crowd psychology."),
    "VOL": ("You are a volatility trader who lives in VIX, realized vol, "
            "and options term structure. You think about vol regimes, "
            "mean reversion of volatility, and tail risk."),
    "REG": ("You are a market microstructure researcher who specialises in "
            "regime detection. You think about hidden Markov models, "
            "structural breaks, and regime persistence."),
    "OPT": ("You are a portfolio optimizer who thinks in terms of "
            "Sharpe maximisation, efficient frontiers, and risk budgeting. "
            "Always consider correlations and position sizing."),
    "SCOUT": ("You are a senior portfolio manager who has seen every market cycle. "
              "You combine top-down macro with bottom-up stock analysis. "
              "Opinionated, direct, gives actionable conviction calls."),
    "RMG":  ("You are a chief risk officer. You think about drawdowns, "
              "tail risk, concentration, and portfolio protection. "
              "Conservative, precise, focused on downside scenarios."),
}

BASE_SYS = ("You are an AI trading agent analyst. Be concise, use numbers, "
            "avoid generic statements. Format key figures in bold.")


def _agent_sys(abbr: str) -> str:
    return AGENT_PERSONAS.get(abbr.upper(), BASE_SYS)


# ── Provider calls ─────────────────────────────────────────────────────────────
async def _call_ollama(prompt: str, system: str, max_tokens: int) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(f"{OLLAMA_URL}/api/generate", json={
                "model":  OLLAMA_MODEL,
                "prompt": prompt,
                "system": system,
                "stream": False,
                "options": {"temperature": 0.35, "num_predict": max_tokens},
            })
            if r.status_code == 200:
                _provider_status["ollama"] = True
                return r.json().get("response", "").strip()
    except Exception as e:
        _provider_status["ollama"] = False
        logger.debug(f"Ollama: {e}")
    return None


async def _call_groq(prompt: str, system: str, max_tokens: int) -> Optional[str]:
    if not GROQ_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post("https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_KEY}",
                         "Content-Type": "application/json"},
                json={
                    "model": GROQ_MODEL,
                    "messages": [
                        {"role": "system",  "content": system},
                        {"role": "user",    "content": prompt},
                    ],
                    "max_tokens": max_tokens,
                    "temperature": 0.35,
                })
            if r.status_code == 200:
                _provider_status["groq"] = True
                return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        _provider_status["groq"] = False
        logger.debug(f"Groq: {e}")
    return None


async def _call_huggingface(prompt: str, system: str, max_tokens: int) -> Optional[str]:
    if not HF_KEY:
        return None
    full = f"[INST] {system}\n\n{prompt} [/INST]"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(
                f"https://api-inference.huggingface.co/models/{HF_MODEL}",
                headers={"Authorization": f"Bearer {HF_KEY}"},
                json={"inputs": full,
                      "parameters": {"max_new_tokens": max_tokens, "temperature": 0.4,
                                     "return_full_text": False}},
            )
            if r.status_code == 200:
                data = r.json()
                if isinstance(data, list) and data:
                    _provider_status["huggingface"] = True
                    return data[0].get("generated_text", "").strip()
    except Exception as e:
        _provider_status["huggingface"] = False
        logger.debug(f"HuggingFace: {e}")
    return None


async def _call_openrouter(prompt: str, system: str, max_tokens: int) -> Optional[str]:
    if not OPENROUTER_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post("https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_KEY}",
                         "Content-Type": "application/json",
                         "HTTP-Referer": "https://ai-trading-lab.onrender.com",
                         "X-Title": "AI Trading Lab"},
                json={
                    "model": OR_MODEL,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user",   "content": prompt},
                    ],
                    "max_tokens": max_tokens,
                })
            if r.status_code == 200:
                _provider_status["openrouter"] = True
                return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        _provider_status["openrouter"] = False
        logger.debug(f"OpenRouter: {e}")
    return None


# ── Local fallback (rule-based, no LLM needed) ───────────────────────────────
def _local_fallback(abbr: str, task: str, context: dict) -> str:
    """
    Rule-based text generation when all LLM providers are unavailable.
    Produces structured but deterministic responses from context data.
    """
    acc     = context.get("accuracy", 0)
    cv      = context.get("cv_mean",  0)
    overfit = context.get("overfit",  0)
    symbol  = context.get("symbol",   "SPY")
    horizon = context.get("horizon",  "swing")

    if task == "training_commentary":
        quality = "excellent" if acc > 0.65 else "acceptable" if acc > 0.55 else "needs improvement"
        trend   = "generalizes well" if overfit < 0.05 else "shows overfitting" if overfit > 0.15 else "stable"
        return (f"{abbr} model for {symbol}/{horizon}: OOS accuracy {acc*100:.1f}% ({quality}). "
                f"CV consistency {cv*100:.1f}%. Model {trend} "
                f"(train-OOS gap {overfit*100:.1f}%). "
                f"{'Recommend increasing training data or adding regularization.' if overfit > 0.15 else 'Ready for live trading.'}")

    if task == "signal_thesis":
        action    = context.get("action",     "BUY")
        conf      = context.get("confidence", 0.6)
        regime    = context.get("regime",     "neutral")
        top_feat  = context.get("top_feature","momentum")
        return (f"{abbr} signals {action} on {symbol} ({conf*100:.0f}% conf). "
                f"Primary driver: {top_feat}. Market regime: {regime}. "
                f"{'Regime-aligned — elevated conviction.' if action in ('BUY','SELL') else 'Counter-trend — use smaller size.'}")

    if task == "backtest_postmortem":
        ret     = context.get("total_return", 0)
        sharpe  = context.get("sharpe",       0)
        wr      = context.get("win_rate",     50)
        alpha   = context.get("alpha",        0)
        return (f"{abbr} backtest on {symbol}: {ret:+.1f}% total return, "
                f"Sharpe {sharpe:.2f}, win rate {wr:.0f}%. "
                f"Alpha vs benchmark: {alpha:+.1f}%. "
                f"{'Strong performance — strategy edge confirmed.' if sharpe > 1.5 else 'Marginal performance — review entry/exit rules.' if sharpe > 0.5 else 'Poor performance — strategy needs rework.'}")

    return f"{abbr}: analysis complete for {symbol}/{horizon}."


# ── Public API ────────────────────────────────────────────────────────────────
async def complete(prompt: str, system: str = "", max_tokens: int = 350,
                   agent_abbr: str = "") -> dict:
    """
    Call LLMs in priority order. Returns {text, provider, used_fallback}.
    """
    sys_prompt = system or _agent_sys(agent_abbr)

    # Try each provider in order
    for name, fn in [
        ("ollama",      lambda: _call_ollama(prompt, sys_prompt, max_tokens)),
        ("groq",        lambda: _call_groq(prompt, sys_prompt, max_tokens)),
        ("huggingface", lambda: _call_huggingface(prompt, sys_prompt, max_tokens)),
        ("openrouter",  lambda: _call_openrouter(prompt, sys_prompt, max_tokens)),
    ]:
        if _provider_status.get(name) is False:
            continue    # skip known-dead providers
        try:
            text = await fn()
            if text and len(text.strip()) > 10:
                logger.debug(f"LLM via {name} ({len(text)} chars)")
                return {"text": text, "provider": name, "used_fallback": False}
        except Exception:
            pass

    return {"text": "", "provider": "none", "used_fallback": True}


async def complete_json(prompt: str, schema_hint: str, system: str = "",
                        agent_abbr: str = "", max_tokens: int = 500) -> dict:
    """
    Request JSON output. Falls back to empty dict if parse fails.
    schema_hint: describe the expected JSON shape in the prompt.
    """
    json_prompt = (f"{prompt}\n\n"
                   f"Respond ONLY with valid JSON matching: {schema_hint}\n"
                   f"No markdown, no explanation, just the JSON object.")
    result = await complete(json_prompt, system=system,
                            max_tokens=max_tokens, agent_abbr=agent_abbr)
    text = result.get("text", "")
    try:
        clean = text.replace("```json","").replace("```","").strip()
        s, e  = clean.find("{"), clean.rfind("}") + 1
        if s >= 0 and e > s:
            parsed = json.loads(clean[s:e])
            return {**result, "json": parsed}
    except Exception:
        pass
    return {**result, "json": {}}


async def get_provider_status() -> dict:
    statuses = {}
    for name, fn in [
        ("ollama",      lambda: _call_ollama("ping", "pong", 5)),
        ("groq",        lambda: _call_groq("ping", "pong", 5)),
        ("huggingface", lambda: _call_huggingface("ping", "pong", 5)),
        ("openrouter",  lambda: _call_openrouter("ping", "pong", 5)),
    ]:
        try:
            text = await asyncio.wait_for(fn(), timeout=8)
            statuses[name] = {"ok": bool(text), "status": "available" if text else "no_response"}
        except Exception as e:
            statuses[name] = {"ok": False, "status": str(e)[:50]}
        _provider_status[name] = statuses[name]["ok"]
    return statuses


# ── Agent-specific helpers ────────────────────────────────────────────────────
async def training_commentary(abbr: str, meta: dict) -> str:
    """Called after every training job — interpret OOS metrics."""
    acc     = meta.get("accuracy", 0)
    cv      = meta.get("cv_mean",  0)
    overfit = meta.get("overfit_gap", 0)
    f1      = meta.get("oos_metrics", {}).get("f1", 0)
    symbol  = meta.get("symbol", "?")
    horizon = meta.get("horizon", "swing")
    samples = meta.get("samples_total", 0)
    fi      = meta.get("feature_importance", {})
    top_feat= list(fi.keys())[:3] if fi else []

    prompt = (
        f"Agent: {abbr} | Symbol: {symbol} | Horizon: {horizon}\n"
        f"OOS Accuracy: {acc*100:.1f}% | CV Mean: {cv*100:.1f}% | "
        f"Overfit Gap: {overfit*100:.1f}%\n"
        f"F1: {f1:.3f} | Samples: {samples}\n"
        f"Top features: {', '.join(top_feat)}\n\n"
        f"In 2-3 sentences: interpret these training results, identify the main strength or weakness, "
        f"and give one concrete improvement suggestion."
    )
    result = await complete(prompt, agent_abbr=abbr, max_tokens=200)
    if result["used_fallback"] or not result["text"]:
        return _local_fallback(abbr, "training_commentary",
                               {"accuracy": acc, "cv_mean": cv, "overfit": overfit,
                                "symbol": symbol, "horizon": horizon})
    return result["text"]


async def signal_thesis(abbr: str, signal: dict, symbol: str,
                        regime: str, top_feature: str) -> str:
    """Generate a 1-sentence trade thesis for a signal."""
    action = signal.get("action", "HOLD")
    conf   = signal.get("confidence", 0.5)
    prompt = (
        f"Agent {abbr} signals {action} on {symbol} "
        f"(confidence {conf*100:.0f}%, top feature: {top_feature}, regime: {regime}). "
        f"Write ONE sentence trade thesis. Be specific, cite the feature and regime."
    )
    result = await complete(prompt, agent_abbr=abbr, max_tokens=100)
    if result["used_fallback"] or not result["text"]:
        return _local_fallback(abbr, "signal_thesis",
                               {"action": action, "confidence": conf,
                                "symbol": symbol, "regime": regime,
                                "top_feature": top_feature})
    return result["text"].split('\n')[0][:200]


async def backtest_postmortem(abbr: str, result: dict) -> str:
    """Analyse a backtest result and suggest improvements."""
    ret    = result.get("total_return", 0)
    alpha  = result.get("alpha", 0)
    sharpe = result.get("sharpe", 0)
    dd     = result.get("max_drawdown", 0)
    wr     = result.get("win_rate", 50)
    sym    = result.get("symbol", "SPY")
    hor    = result.get("horizon", "swing")
    trades = result.get("total_trades", 0)

    prompt = (
        f"Backtest: {abbr} on {sym}/{hor}\n"
        f"Return: {ret:+.1f}% | Alpha: {alpha:+.1f}% | Sharpe: {sharpe:.2f}\n"
        f"Max DD: {dd:.1f}% | Win rate: {wr:.0f}% | Trades: {trades}\n\n"
        f"In 3 sentences: assess strategy quality, identify the main weakness "
        f"(drawdown, win rate, alpha), and suggest one specific parameter change."
    )
    result_llm = await complete(prompt, agent_abbr=abbr, max_tokens=220)
    if result_llm["used_fallback"] or not result_llm["text"]:
        return _local_fallback(abbr, "backtest_postmortem",
                               {"total_return": ret, "sharpe": sharpe,
                                "win_rate": wr, "alpha": alpha,
                                "symbol": sym, "horizon": hor})
    return result_llm["text"]


async def strategy_comparison(results: list) -> str:
    """Compare multiple backtest results and rank strategies."""
    if not results:
        return "No results to compare."
    top3 = sorted(results, key=lambda r: r.get("sharpe", 0), reverse=True)[:3]
    summary = "\n".join(
        f"- {r['abbr']} on {r['symbol']}: Sharpe {r.get('sharpe',0):.2f}, "
        f"alpha {r.get('alpha',0):+.1f}%, DD {r.get('max_drawdown',0):.1f}%"
        for r in top3
    )
    prompt = (
        f"Compare these trading strategies:\n{summary}\n\n"
        f"In 2-3 sentences: rank them, explain why the top performer is best, "
        f"and identify the riskiest."
    )
    result = await complete(prompt, max_tokens=200)
    return result.get("text") or f"Top strategy: {top3[0]['abbr']} on {top3[0]['symbol']} (Sharpe {top3[0].get('sharpe',0):.2f})"
