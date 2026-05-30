"""
Report generator — produce HTML reports sharabili per:
  - Portfolio summary
  - Agent performance
  - SCOUT screen results
  - Backtest results

Ogni report ha una URL pubblica: /report/{type}/{id}
"""
import json, os
from datetime import datetime, timezone
from pathlib import Path

REPORTS_DIR = Path(__file__).parent.parent / "reports"
REPORTS_DIR.mkdir(exist_ok=True)

APP_URL = os.getenv("RENDER_EXTERNAL_URL", "http://localhost:8000")

_CSS = """
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#0a0e17;color:#e2e8f0;padding:24px;max-width:960px;margin:0 auto}
h1{font-size:24px;font-weight:800;color:#fff;margin-bottom:4px}
h2{font-size:16px;font-weight:700;color:#94a3b8;margin:24px 0 12px}
.badge{display:inline-block;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.8px}
.green{color:#10b981}.red{color:#ef4444}.yellow{color:#f59e0b}.cyan{color:#06b6d4}.purple{color:#8b5cf6}
.card{background:#141c2e;border:1px solid #1e2d47;border-radius:10px;padding:20px;margin-bottom:16px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{background:#0a0e17;border-radius:8px;padding:14px;border:1px solid #1e2d47}
.kpi-label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px}
.kpi-value{font-size:22px;font-weight:800;font-family:monospace}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:7px 12px;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid #1e2d47}
td{padding:8px 12px;border-bottom:1px solid #1e2d4722}
.mono{font-family:monospace}
.meta{font-size:11px;color:#475569;margin-bottom:20px}
.logo{font-size:28px;margin-right:10px}
header{display:flex;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #1e2d47}
.share-btn{background:#3b82f622;border:1px solid #3b82f666;color:#3b82f6;padding:6px 14px;
           border-radius:7px;font-size:11px;cursor:pointer;text-decoration:none;display:inline-block;margin-top:16px}
footer{margin-top:32px;padding-top:16px;border-top:1px solid #1e2d47;font-size:10px;color:#475569}
</style>
"""

def _html(title: str, body: str, report_id: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    url = f"{APP_URL}/report/{report_id}"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} — AI Trading Lab</title>
{_CSS}
</head>
<body>
<header>
  <span class="logo">⚡</span>
  <div>
    <h1>{title}</h1>
    <div class="meta">AI Trading Lab · Generated {now}</div>
  </div>
</header>
{body}
<footer>
  AI Trading Lab · Paper trading platform · This report is for informational purposes only.
  Not financial advice.<br>
  <a href="{url}" style="color:#3b82f6">{url}</a>
</footer>
</body>
</html>"""


def _c(v):
    """Color class for a numeric value."""
    try:
        return "green" if float(v) > 0 else "red" if float(v) < 0 else ""
    except Exception:
        return ""


# ── Portfolio report ──────────────────────────────────────────────────────────
def generate_portfolio_report(portfolio: dict, agents: list, trades: list) -> str:
    rid   = f"portfolio-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    body  = ""

    # KPIs
    body += "<div class='grid4'>"
    kpis = [
        ("Equity",       f"${portfolio.get('equity',0):,.0f}",   "cyan"),
        ("Total Return",  f"{portfolio.get('total_return',0):+.2f}%", _c(portfolio.get('total_return',0))),
        ("Daily P&L",    f"${portfolio.get('daily_pnl',0):+,.0f}", _c(portfolio.get('daily_pnl',0))),
        ("Sharpe",        f"{portfolio.get('sharpe',0):.2f}",     ""),
        ("Sortino",       f"{portfolio.get('sortino',0):.2f}",    ""),
        ("Max Drawdown",  f"{portfolio.get('max_drawdown',0):.1f}%", "red"),
        ("Win Rate",      f"{portfolio.get('win_rate',0):.1f}%",  "green"),
        ("Active Agents", f"{portfolio.get('active_agents',0)}/10","cyan"),
    ]
    for label, value, cls in kpis:
        body += f"<div class='kpi'><div class='kpi-label'>{label}</div><div class='kpi-value {cls}'>{value}</div></div>"
    body += "</div>"

    # Agent table
    body += "<h2>Agent Performance</h2><div class='card'><table>"
    body += "<tr><th>Agent</th><th>Strategy</th><th>Return</th><th>Sharpe</th><th>Accuracy</th><th>State</th><th>Last Trade</th></tr>"
    for a in sorted(agents, key=lambda x: x.get("perf",0), reverse=True):
        p = a.get("perf",0)
        body += (f"<tr>"
                 f"<td class='mono' style='font-weight:700;color:{a.get(\"color\",\"#fff\")}'>{a.get('abbr','')}</td>"
                 f"<td style='color:#94a3b8'>{a.get('strategy','')}</td>"
                 f"<td class='mono {_c(p)}'>{p:+.2f}%</td>"
                 f"<td class='mono'>{a.get('sharpe',0):.2f}</td>"
                 f"<td class='mono'>{a.get('accuracy',0):.1f}%</td>"
                 f"<td><span class='badge' style='background:{\"#10b98122\" if a.get(\"state\")==\"Live\" else \"#f59e0b22\"};color:{\"#10b981\" if a.get(\"state\")==\"Live\" else \"#f59e0b\"}'>{a.get('state','')}</span></td>"
                 f"<td class='mono' style='font-size:10px;color:#64748b'>{a.get('last_trade','')}</td>"
                 f"</tr>")
    body += "</table></div>"

    # Recent trades
    if trades:
        body += "<h2>Recent Trades</h2><div class='card'><table>"
        body += "<tr><th>Agent</th><th>Symbol</th><th>Side</th><th>Price</th><th>P&L</th><th>Time</th></tr>"
        for t in trades[:20]:
            pnl = t.get("pnl",0)
            side_c = "green" if t.get("side")=="BUY" else "red"
            body += (f"<tr>"
                     f"<td class='mono'>{t.get('agent_abbr','')}</td>"
                     f"<td class='mono' style='font-weight:700'>{t.get('symbol','')}</td>"
                     f"<td class='mono {side_c}'>{t.get('side','')}</td>"
                     f"<td class='mono'>${t.get('price',0):.2f}</td>"
                     f"<td class='mono {_c(pnl)}'>{pnl:+.2f}%</td>"
                     f"<td style='font-size:10px;color:#64748b'>{str(t.get('ts',''))[:16]}</td>"
                     f"</tr>")
        body += "</table></div>"

    html = _html("Portfolio Report", body, rid)
    path = REPORTS_DIR / f"{rid}.html"
    path.write_text(html)
    return rid


# ── Scout report ──────────────────────────────────────────────────────────────
def generate_scout_report(screen: dict) -> str:
    rid  = f"scout-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    body = ""

    # Summary
    body += "<div class='grid4'>"
    for label, value, cls in [
        ("Symbols Screened", screen.get("screened",0), ""),
        ("Regime",           screen.get("regime","?").upper(), "cyan"),
        ("Top Long",         screen.get("top_long","—"), "green"),
        ("Top Short",        screen.get("top_short","—") or "—", "red"),
    ]:
        body += f"<div class='kpi'><div class='kpi-label'>{label}</div><div class='kpi-value {cls}'>{value}</div></div>"
    body += "</div>"

    # Long picks
    longs = screen.get("longs",[])
    if longs:
        body += "<h2>🟢 Long Picks</h2><div class='card'><table>"
        body += "<tr><th>Symbol</th><th>Score</th><th>Conviction</th><th>Sector</th><th>Technical</th><th>Macro</th><th>Quality</th><th>Thesis</th></tr>"
        for p in longs[:10]:
            thesis = p.get("thesis",{})
            thesis_text = thesis.get("thesis","")[:80] + "…" if isinstance(thesis,dict) and thesis.get("thesis") else ""
            conv_c = {"HIGH":"#10b981","MEDIUM":"#f59e0b","LOW":"#ef4444"}.get(p.get("conviction",""),   "#64748b")
            body += (f"<tr>"
                     f"<td class='mono' style='font-weight:800;color:#e2e8f0'>{p['symbol']}</td>"
                     f"<td class='mono' style='color:{conv_c};font-weight:700'>{p.get('composite',0)}</td>"
                     f"<td><span class='badge' style='background:{conv_c}22;color:{conv_c}'>{p.get('conviction','')}</span></td>"
                     f"<td style='color:#94a3b8;font-size:11px'>{p.get('sector','')}</td>"
                     f"<td class='mono'>{p.get('breakdown',{}).get('technical',0):.0f}</td>"
                     f"<td class='mono'>{p.get('breakdown',{}).get('macro',0):.0f}</td>"
                     f"<td class='mono'>{p.get('breakdown',{}).get('quality',0):.0f}</td>"
                     f"<td style='font-size:10px;color:#94a3b8;max-width:200px'>{thesis_text}</td>"
                     f"</tr>")
        body += "</table></div>"

    # Short picks
    shorts = screen.get("shorts",[])
    if shorts:
        body += "<h2>🔴 Short Ideas</h2><div class='card'><table>"
        body += "<tr><th>Symbol</th><th>Score</th><th>Sector</th></tr>"
        for p in shorts[:5]:
            body += (f"<tr>"
                     f"<td class='mono red' style='font-weight:800'>{p['symbol']}</td>"
                     f"<td class='mono red'>{p.get('composite',0)}</td>"
                     f"<td style='color:#94a3b8'>{p.get('sector','')}</td>"
                     f"</tr>")
        body += "</table></div>"

    html = _html(f"SCOUT Screen — {screen.get('regime','').title()} Regime", body, rid)
    path = REPORTS_DIR / f"{rid}.html"
    path.write_text(html)
    return rid


# ── Backtest report ────────────────────────────────────────────────────────────
def generate_backtest_report(result: dict) -> str:
    rid  = f"backtest-{result.get('abbr','X')}-{result.get('symbol','X')}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    body = ""

    body += "<div class='grid4'>"
    for label, value, cls in [
        ("Total Return",    f"{result.get('total_return',0):+.2f}%",     _c(result.get('total_return',0))),
        ("Alpha vs B&H",    f"{result.get('alpha',0):+.2f}%",             _c(result.get('alpha',0))),
        ("Sharpe",          f"{result.get('sharpe',0):.3f}",              ""),
        ("Max Drawdown",    f"{result.get('max_drawdown',0):.1f}%",       "red"),
        ("Win Rate",        f"{result.get('win_rate',0):.1f}%",           "green"),
        ("Total Trades",    f"{result.get('total_trades',0)}",            ""),
        ("Profit Factor",   f"{result.get('profit_factor',0):.2f}×",     _c(result.get('profit_factor',1)-1)),
        ("Calmar",          f"{result.get('calmar',0):.2f}",              ""),
    ]:
        body += f"<div class='kpi'><div class='kpi-label'>{label}</div><div class='kpi-value {cls}'>{value}</div></div>"
    body += "</div>"

    # Trade log
    trades = result.get("trades",[])
    if trades:
        body += "<h2>Trade Log</h2><div class='card'><table>"
        body += "<tr><th>Date</th><th>Side</th><th>Price</th><th>Entry</th><th>P&L</th><th>P&L%</th></tr>"
        for t in trades[-20:]:
            pnl = t.get("pnl",0)
            body += (f"<tr>"
                     f"<td style='color:#64748b;font-size:10px'>{str(t.get('ts',''))[:10]}</td>"
                     f"<td class='mono {\"red\" if t.get(\"side\")==\"SELL\" else \"green\"}'>{t.get('side','')}</td>"
                     f"<td class='mono'>${t.get('price',0):.2f}</td>"
                     f"<td class='mono'>${t.get('entry',0):.2f}</td>"
                     f"<td class='mono {_c(pnl)}'>{pnl:+.2f}</td>"
                     f"<td class='mono {_c(t.get(\"pnl_pct\",0))}'>{t.get('pnl_pct',0)*100:+.2f}%</td>"
                     f"</tr>")
        body += "</table></div>"

    title = f"Backtest — {result.get('abbr','')} / {result.get('symbol','')} / {result.get('horizon','')}"
    html  = _html(title, body, rid)
    path  = REPORTS_DIR / f"{rid}.html"
    path.write_text(html)
    return rid


# ── List all reports ──────────────────────────────────────────────────────────
def list_reports() -> list:
    return sorted([
        {
            "id":       p.stem,
            "type":     p.stem.split("-")[0],
            "url":      f"/report/{p.stem}",
            "size_kb":  round(p.stat().st_size / 1024, 1),
            "created":  datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat(),
        }
        for p in REPORTS_DIR.glob("*.html")
    ], key=lambda x: x["created"], reverse=True)


def get_report_html(report_id: str) -> str | None:
    p = REPORTS_DIR / f"{report_id}.html"
    return p.read_text() if p.exists() else None
