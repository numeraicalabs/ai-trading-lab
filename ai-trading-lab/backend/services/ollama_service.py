"""
Ollama Service
Provides two features:
  1. parse_order_from_text() — parses natural-language trade instructions
  2. agent_commentary()      — AI commentary on agent performance / market
  3. chat()                  — general chat with market context

Ollama docs: https://ollama.ai
Supported models: llama3, mistral, phi3, gemma2, qwen2, etc.

Set OLLAMA_BASE_URL in .env  (default: http://localhost:11434)
Set OLLAMA_MODEL            (default: llama3)
"""

import os
import json
import logging
import asyncio
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

OLLAMA_BASE  = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

# ── Availability check ────────────────────────────────────────────────────────
async def is_available() -> bool:
    """Check if Ollama is running."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{OLLAMA_BASE}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False

async def list_models() -> list[str]:
    """List available Ollama models."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_BASE}/api/tags")
            data = resp.json()
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []

# ── Core completion ───────────────────────────────────────────────────────────
async def _complete(
    prompt: str,
    system: str = "",
    temperature: float = 0.3,
    max_tokens: int = 512,
    stream: bool = False,
) -> str:
    """Send a prompt to Ollama and return the full response text."""
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "system": system,
        "stream": stream,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{OLLAMA_BASE}/api/generate", json=payload)
            resp.raise_for_status()
            if stream:
                # Collect streamed chunks
                text = ""
                for line in resp.text.splitlines():
                    try:
                        chunk = json.loads(line)
                        text += chunk.get("response", "")
                        if chunk.get("done"):
                            break
                    except Exception:
                        pass
                return text.strip()
            else:
                data = resp.json()
                return data.get("response", "").strip()
    except httpx.TimeoutException:
        return "[Ollama timeout — model may be loading, retry in a few seconds]"
    except httpx.ConnectError:
        return "[Ollama not available — run: ollama serve]"
    except Exception as e:
        logger.error(f"Ollama error: {e}")
        return f"[Ollama error: {str(e)[:80]}]"

# ── 1. Parse natural-language order ──────────────────────────────────────────
ORDER_SYSTEM = """You are a trading assistant that extracts structured order parameters from natural language.
Always respond ONLY with valid JSON — no explanation, no markdown.
JSON schema:
{
  "action": "BUY|SELL|HOLD",
  "symbol": "TICKER",
  "quantity": number_or_null,
  "order_type": "MARKET|LIMIT|STOP",
  "limit_price": number_or_null,
  "agent_abbr": "MOM|MRV|PPO|DQN|MAC|SEN|VOL|REG|OPT|null",
  "horizon": "scalping|day|swing|position",
  "confidence": 0.0_to_1.0,
  "reasoning": "brief explanation"
}
Rules:
- Default quantity: 1
- Default order_type: MARKET
- Default horizon: swing
- If symbol not mentioned, use "SPY"
- agent_abbr: pick the most appropriate agent or null
  MOM=momentum/trend, MRV=mean reversion, PPO=RL/adaptive, MAC=macro,
  SEN=news-driven, VOL=volatility, REG=regime, OPT=portfolio balance
"""

async def parse_order_from_text(text: str, context: dict = None) -> dict:
    """
    Parse a natural language trade instruction into a structured order.
    Examples:
      "Buy 10 shares of Apple"  →  {action:"BUY", symbol:"AAPL", quantity:10, ...}
      "Sell Tesla with momentum strategy"  →  {action:"SELL", symbol:"TSLA", agent_abbr:"MOM", ...}
      "Go long SPY for a swing trade"  →  {action:"BUY", symbol:"SPY", horizon:"swing", ...}
    """
    ctx_str = ""
    if context:
        ctx_str = f"\nCurrent market context: {json.dumps(context, default=str)}"

    prompt = f'Parse this trade instruction into JSON:{ctx_str}\n\nInstruction: "{text}"'
    response = await _complete(prompt, system=ORDER_SYSTEM, temperature=0.1, max_tokens=300)

    # Try to extract JSON from response
    try:
        # Clean up possible markdown fences
        clean = response.replace("```json", "").replace("```", "").strip()
        # Find JSON object
        start = clean.find("{")
        end   = clean.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(clean[start:end])
    except Exception as e:
        logger.warning(f"Order parse JSON error: {e} — raw: {response[:200]}")

    # Fallback: simple keyword parsing
    return _fallback_parse_order(text)

def _fallback_parse_order(text: str) -> dict:
    """Rule-based fallback if Ollama is unavailable."""
    text_lower = text.lower()
    action = "HOLD"
    if any(w in text_lower for w in ["buy","long","call","bullish","purchase","enter"]):
        action = "BUY"
    elif any(w in text_lower for w in ["sell","short","put","bearish","exit","close"]):
        action = "SELL"

    # Symbol detection
    common = {"apple":"AAPL","microsoft":"MSFT","tesla":"TSLA","nvidia":"NVDA",
              "amazon":"AMZN","meta":"META","bitcoin":"BTC-USD","ethereum":"ETH-USD",
              "spy":"SPY","qqq":"QQQ","gold":"GLD","nasdaq":"QQQ","s&p":"SPY"}
    symbol = "SPY"
    for word, ticker in common.items():
        if word in text_lower:
            symbol = ticker
            break
    # Try raw ticker (2-5 uppercase letters)
    import re
    tickers = re.findall(r'\b([A-Z]{2,5})\b', text)
    if tickers:
        symbol = tickers[0]

    # Quantity
    nums = re.findall(r'\b(\d+)\b', text)
    quantity = int(nums[0]) if nums else 1

    # Horizon
    horizon = "swing"
    if any(w in text_lower for w in ["scalp","intraday","5min","1min"]): horizon = "scalping"
    elif any(w in text_lower for w in ["day trade","daytrading","hourly"]): horizon = "day"
    elif any(w in text_lower for w in ["position","longterm","long-term","weekly","monthly"]): horizon = "position"

    # Agent
    agent_abbr = None
    if any(w in text_lower for w in ["momentum","trend","following"]): agent_abbr = "MOM"
    elif any(w in text_lower for w in ["reversion","oversold","overbought"]): agent_abbr = "MRV"
    elif any(w in text_lower for w in ["sentiment","news","social"]): agent_abbr = "SEN"
    elif any(w in text_lower for w in ["volatility","vol","vix"]): agent_abbr = "VOL"
    elif any(w in text_lower for w in ["macro","economic","fed","rate"]): agent_abbr = "MAC"
    elif any(w in text_lower for w in ["rl","reinforcement","ppo","adaptive"]): agent_abbr = "PPO"

    return {
        "action": action, "symbol": symbol, "quantity": quantity,
        "order_type": "MARKET", "limit_price": None,
        "agent_abbr": agent_abbr, "horizon": horizon,
        "confidence": 0.6, "reasoning": "fallback parser (Ollama unavailable)",
    }

# ── 2. Agent commentary ───────────────────────────────────────────────────────
COMMENTARY_SYSTEM = """You are a quant analyst providing concise commentary on an AI trading agent's performance.
Be direct, professional, and insightful. Max 3 sentences. Focus on what matters most."""

async def agent_commentary(agent_data: dict, market_context: dict = None) -> str:
    """Generate AI commentary for an agent's current state."""
    prompt = f"""Agent: {agent_data.get('name')}
Strategy: {agent_data.get('strategy')}
Performance: {agent_data.get('perf',0):.1f}% | Sharpe: {agent_data.get('sharpe',0):.2f} | Win rate: {agent_data.get('winRate',agent_data.get('win_rate',0))}%
Status: {agent_data.get('state')} | Last trade: {agent_data.get('last_trade',agent_data.get('lastTrade','—'))}
Market context: {json.dumps(market_context or {}, default=str)}

Provide a brief professional commentary on this agent's performance and outlook."""
    return await _complete(prompt, system=COMMENTARY_SYSTEM, temperature=0.5, max_tokens=150)

# ── 3. General market chat ────────────────────────────────────────────────────
CHAT_SYSTEM = """You are an expert quantitative analyst and AI trading assistant for the AI Trading Lab platform.
You have access to 9 AI agents: Momentum (MOM), Mean Reversion (MRV), RL PPO (PPO), DQN,
Macro (MAC), Sentiment (SEN), Volatility (VOL), Market Regime (REG), Portfolio Optimizer (OPT).

Help users:
- Understand agent performance and signals
- Execute paper trades (you can suggest parameters)
- Explain trading strategies and concepts
- Analyze market conditions

Be concise, accurate, and actionable. When suggesting trades, always specify:
action (BUY/SELL/HOLD), symbol, quantity, time horizon, and which agent to use."""

async def chat(
    message: str,
    conversation_history: list[dict] = None,
    portfolio_context: dict = None,
    agent_context: list[dict] = None,
) -> dict:
    """
    Full chat interaction with context.
    Returns: {response: str, suggested_order: dict|None, model: str}
    """
    # Build context
    ctx_parts = []
    if portfolio_context:
        ctx_parts.append(f"Portfolio: equity=${portfolio_context.get('equity',0):,.0f}, return={portfolio_context.get('total_return',0):.1f}%, sharpe={portfolio_context.get('sharpe',0):.2f}")
    if agent_context:
        top = sorted(agent_context, key=lambda x: x.get("perf",0), reverse=True)[:3]
        ctx_parts.append("Top agents: " + ", ".join(f"{a['abbr']}({a.get('perf',0):.1f}%)" for a in top))

    ctx_str = "\n".join(ctx_parts)
    full_prompt = f"{ctx_str}\n\nUser: {message}" if ctx_str else message

    # Check if message looks like a trade order
    order_keywords = ["buy","sell","trade","purchase","short","long","order","execute","position"]
    is_order = any(w in message.lower() for w in order_keywords)

    response = await _complete(full_prompt, system=CHAT_SYSTEM, temperature=0.4, max_tokens=400)

    # If order-like, also parse it
    suggested_order = None
    if is_order:
        market_ctx = {"portfolio": portfolio_context} if portfolio_context else {}
        suggested_order = await parse_order_from_text(message, market_ctx)

    return {
        "response": response,
        "suggested_order": suggested_order,
        "model": OLLAMA_MODEL,
        "ollama_available": True,
    }
