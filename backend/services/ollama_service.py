"""Ollama service — chat, order parsing, commentary, page summarizer."""
import os, json, logging
import httpx

logger = logging.getLogger(__name__)
OLLAMA_BASE  = os.getenv("OLLAMA_BASE_URL","http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL","llama3")

async def is_available():
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get(f"{OLLAMA_BASE}/api/tags")
            return r.status_code == 200
    except: return False

async def list_models():
    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(f"{OLLAMA_BASE}/api/tags")
            return [m["name"] for m in r.json().get("models",[])]
    except: return []

async def _complete(prompt, system="", temperature=0.3, max_tokens=512):
    payload = {"model":OLLAMA_MODEL,"prompt":prompt,"system":system,
               "stream":False,"options":{"temperature":temperature,"num_predict":max_tokens}}
    try:
        async with httpx.AsyncClient(timeout=60.0) as c:
            r = await c.post(f"{OLLAMA_BASE}/api/generate", json=payload)
            r.raise_for_status()
            return r.json().get("response","").strip()
    except httpx.TimeoutException: return "[Ollama timeout — model loading, retry shortly]"
    except httpx.ConnectError: return "[Ollama not running — run: ollama serve]"
    except Exception as e: return f"[Ollama error: {str(e)[:60]}]"

ORDER_SYS = """Extract trade parameters from text. Reply ONLY with valid JSON, no markdown.
Schema: {"action":"BUY|SELL|HOLD","symbol":"TICKER","quantity":number,"order_type":"MARKET|LIMIT","limit_price":null,"agent_abbr":"MOM|MRV|PPO|DQN|MAC|SEN|VOL|REG|OPT|null","horizon":"scalping|day|swing|position","confidence":0.0-1.0,"reasoning":"brief"}
Defaults: quantity=1, order_type=MARKET, horizon=swing, symbol=SPY"""

async def parse_order_from_text(text, context=None):
    ctx = f"\nMarket context: {json.dumps(context,default=str)[:200]}" if context else ""
    resp = await _complete(f'Parse trade instruction:{ctx}\n"{text}"', system=ORDER_SYS, temperature=0.1, max_tokens=250)
    try:
        clean = resp.replace("```json","").replace("```","").strip()
        s,e = clean.find("{"), clean.rfind("}")+1
        if s>=0 and e>s: return json.loads(clean[s:e])
    except: pass
    return _fallback_parse(text)

def _fallback_parse(text):
    import re
    tl = text.lower()
    action = "BUY" if any(w in tl for w in ["buy","long","call","purchase"]) else "SELL" if any(w in tl for w in ["sell","short","put","exit"]) else "HOLD"
    syms = {"apple":"AAPL","msft":"MSFT","microsoft":"MSFT","tesla":"TSLA","nvidia":"NVDA","amazon":"AMZN","meta":"META","bitcoin":"BTC-USD","ethereum":"ETH-USD","gold":"GLD"}
    symbol="SPY"
    for k,v in syms.items():
        if k in tl: symbol=v; break
    m = re.findall(r'\b([A-Z]{2,5})\b',text)
    if m: symbol=m[0]
    nums = re.findall(r'\b(\d+)\b',text)
    qty = int(nums[0]) if nums else 1
    horizon = "scalping" if "scalp" in tl else "day" if "day" in tl else "position" if "position" in tl else "swing"
    agent = None
    if "momentum" in tl: agent="MOM"
    elif "sentiment" in tl or "news" in tl: agent="SEN"
    elif "volatil" in tl: agent="VOL"
    elif "macro" in tl: agent="MAC"
    return {"action":action,"symbol":symbol,"quantity":qty,"order_type":"MARKET","limit_price":None,"agent_abbr":agent,"horizon":horizon,"confidence":0.6,"reasoning":"fallback parser"}

CHAT_SYS = """You are an expert quant analyst for AI Trading Lab — a paper trading platform with 9 AI agents.
Agents: MOM(Momentum), MRV(Mean Reversion), PPO(RL Policy Gradient), DQN(Deep Q-Learning),
MAC(Macro), SEN(Sentiment/NLP), VOL(Volatility), REG(Regime Detection), OPT(Portfolio Optimizer).
Help users: understand agent performance, execute paper trades, analyze market conditions.
Be concise and actionable. For trade suggestions specify: action, symbol, quantity, horizon, agent."""

async def chat(message, conversation_history=None, portfolio_context=None, agent_context=None):
    ctx = []
    if portfolio_context:
        ctx.append(f"Portfolio: ${portfolio_context.get('equity',0):,.0f} equity, {portfolio_context.get('total_return',0):.1f}% return, sharpe {portfolio_context.get('sharpe',0):.2f}")
    if agent_context:
        top = sorted(agent_context, key=lambda x:x.get("perf",0), reverse=True)[:3]
        ctx.append("Top agents: " + ", ".join(f"{a['abbr']}({a.get('perf',0):.1f}%)" for a in top))
    prompt = ("\n".join(ctx)+"\n\n" if ctx else "") + message
    resp = await _complete(prompt, system=CHAT_SYS, temperature=0.4, max_tokens=400)
    order_kw = ["buy","sell","trade","purchase","short","long","order","execute"]
    suggested = None
    if any(w in message.lower() for w in order_kw):
        suggested = await parse_order_from_text(message, {"portfolio":portfolio_context})
    return {"response":resp,"suggested_order":suggested,"model":OLLAMA_MODEL}

COMMENTARY_SYS = "You are a quant analyst. Give concise 2-3 sentence commentary on this AI trading agent. Be direct and insightful."

async def agent_commentary(agent_data, market_context=None):
    prompt = f"Agent: {agent_data.get('name')} | Strategy: {agent_data.get('strategy')} | Return: {agent_data.get('perf',0):.1f}% | Sharpe: {agent_data.get('sharpe',0):.2f} | Status: {agent_data.get('state')} | Last trade: {agent_data.get('last_trade','—')}"
    return await _complete(prompt, system=COMMENTARY_SYS, temperature=0.5, max_tokens=150)

SUMMARIZE_SYS = """You are a quant analyst summarizing data from an AI trading dashboard.
Structure your response:
**Summary** (2-3 sentences)
**Key Insights** (2-3 bullets)
**Recommendations** (1-2 actions)
Keep under 200 words. Be direct."""

async def summarize_page(page, data_str, question=""):
    prompt = f"Page: {page}\nData: {data_str}\n\nQuestion: {question or f'Summarize the {page} page.'}"
    return await _complete(prompt, system=SUMMARIZE_SYS, temperature=0.4, max_tokens=300)
