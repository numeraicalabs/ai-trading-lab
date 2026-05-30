"""Ollama service — chat, order parsing, agent commentary, page summarizer."""
import os, json, re, logging
import httpx

logger = logging.getLogger(__name__)

BASE  = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
MODEL = os.getenv("OLLAMA_MODEL", "llama3")

# ── Core completion ────────────────────────────────────────────────────────────
async def _complete(prompt: str, system: str = "", temperature: float = 0.3, max_tokens: int = 512) -> str:
    payload = {"model": MODEL, "prompt": prompt, "system": system, "stream": False,
               "options": {"temperature": temperature, "num_predict": max_tokens}}
    try:
        async with httpx.AsyncClient(timeout=60.0) as c:
            r = await c.post(f"{BASE}/api/generate", json=payload)
            r.raise_for_status()
            return r.json().get("response", "").strip()
    except httpx.TimeoutException:
        return "[Ollama timeout — model loading, retry shortly]"
    except httpx.ConnectError:
        return "[Ollama not running — run: ollama serve]"
    except Exception as e:
        return f"[Ollama error: {str(e)[:60]}]"

# ── Status ─────────────────────────────────────────────────────────────────────
async def status() -> dict:
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get(f"{BASE}/api/tags")
            models = [m["name"] for m in r.json().get("models", [])]
            return {"available": r.status_code == 200, "model": MODEL, "models": models}
    except Exception:
        return {"available": False, "model": MODEL, "models": []}

# ── Chat ───────────────────────────────────────────────────────────────────────
_CHAT_SYS = """You are an expert quant analyst for AI Trading Lab — a paper trading platform
with 9 AI agents (MOM, MRV, PPO, DQN, MAC, SEN, VOL, REG, OPT). Be concise and actionable.
For trade suggestions specify: action, symbol, quantity, horizon, agent."""

async def chat(message: str, history: list = [], portfolio=None, agents=None) -> dict:
    ctx = []
    if portfolio:
        ctx.append(f"Portfolio: ${portfolio.get('equity',0):,.0f} equity, "
                   f"{portfolio.get('total_return',0):.1f}% return")
    if agents:
        top = sorted(agents, key=lambda a: a.get("perf", 0), reverse=True)[:3]
        ctx.append("Top agents: " + ", ".join(f"{a['abbr']}({a.get('perf',0):.1f}%)" for a in top))
    prompt = ("\n".join(ctx) + "\n\n" if ctx else "") + message
    resp   = await _complete(prompt, system=_CHAT_SYS, temperature=0.4, max_tokens=400)
    order  = None
    if any(w in message.lower() for w in ["buy","sell","trade","long","short","order"]):
        order = await parse_order(message, {"portfolio": portfolio})
    return {"response": resp, "suggested_order": order, "model": MODEL}

# ── Order parser ───────────────────────────────────────────────────────────────
_ORDER_SYS = """Extract trade parameters. Reply ONLY valid JSON, no markdown.
Schema: {"action":"BUY|SELL|HOLD","symbol":"TICKER","quantity":1,"order_type":"MARKET",
"limit_price":null,"agent_abbr":null,"horizon":"swing","confidence":0.7,"reasoning":""}"""

async def parse_order(text: str, context=None) -> dict:
    ctx  = f"\nContext: {json.dumps(context, default=str)[:200]}" if context else ""
    resp = await _complete(f'Parse trade instruction:{ctx}\n"{text}"',
                           system=_ORDER_SYS, temperature=0.1, max_tokens=250)
    try:
        clean = resp.replace("```json", "").replace("```", "").strip()
        s, e  = clean.find("{"), clean.rfind("}") + 1
        if s >= 0 and e > s:
            return json.loads(clean[s:e])
    except Exception:
        pass
    return _fallback_parse(text)

def _fallback_parse(text: str) -> dict:
    tl     = text.lower()
    action = "BUY"  if any(w in tl for w in ["buy","long","call"]) else \
             "SELL" if any(w in tl for w in ["sell","short","put"]) else "HOLD"
    syms   = {"apple":"AAPL","microsoft":"MSFT","tesla":"TSLA","nvidia":"NVDA",
               "amazon":"AMZN","meta":"META","bitcoin":"BTC-USD","gold":"GLD"}
    symbol = next((v for k, v in syms.items() if k in tl), "SPY")
    m      = re.findall(r"\b([A-Z]{2,5})\b", text)
    if m: symbol = m[0]
    nums   = re.findall(r"\b(\d+)\b", text)
    qty    = int(nums[0]) if nums else 1
    horizon = ("scalping" if "scalp" in tl else "day" if "day" in tl
               else "position" if "position" in tl else "swing")
    return {"action": action, "symbol": symbol, "quantity": qty,
            "order_type": "MARKET", "limit_price": None,
            "agent_abbr": None, "horizon": horizon,
            "confidence": 0.6, "reasoning": "fallback parser"}

# ── Agent commentary ───────────────────────────────────────────────────────────
_COMM_SYS = "You are a quant analyst. Give concise 2-3 sentence commentary on this AI trading agent."

async def commentary(agent: dict) -> str:
    prompt = (f"Agent: {agent.get('name')} | Strategy: {agent.get('strategy')} | "
              f"Return: {agent.get('perf',0):.1f}% | Sharpe: {agent.get('sharpe',0):.2f} | "
              f"State: {agent.get('state')}")
    return await _complete(prompt, system=_COMM_SYS, temperature=0.5, max_tokens=150)

# ── Page summarizer ────────────────────────────────────────────────────────────
_SUM_SYS = """You are a quant analyst summarizing a trading dashboard page.
Structure: **Summary** (2-3 sentences) · **Key Insights** (2-3 bullets) · **Recommendation** (1 action).
Keep under 200 words. Be direct."""

async def summarize(page: str, data_str: str, question: str = "") -> str:
    prompt = f"Page: {page}\nData: {data_str}\nQuestion: {question or f'Summarize the {page} page.'}"
    return await _complete(prompt, system=_SUM_SYS, temperature=0.4, max_tokens=300)
