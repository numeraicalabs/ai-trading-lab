"""
Report generator — produce HTML reports sharabili.
Compatibile con Python 3.11 (no backslash in f-string expressions).
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
.green{color:#10b981}.red{color:#ef4444}.yellow{color:#f59e0b}.cyan{color:#06b6d4}
.card{background:#141c2e;border:1px solid #1e2d47;border-radius:10px;padding:20px;margin-bottom:16px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.kpi{background:#0a0e17;border-radius:8px;padding:14px;border:1px solid #1e2d47}
.kpi-label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px}
.kpi-value{font-size:22px;font-weight:800;font-family:monospace}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:7px 12px;color:#64748b;font-size:10px;text-transform:uppercase;
   letter-spacing:.8px;border-bottom:1px solid #1e2d47}
td{padding:8px 12px;border-bottom:1px solid rgba(30,45,71,0.4)}
.mono{font-family:monospace}
.meta{font-size:11px;color:#475569;margin-bottom:20px}
header{display:flex;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #1e2d47}
footer{margin-top:32px;padding-top:16px;border-top:1px solid #1e2d47;font-size:10px;color:#475569}
a.btn{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.4);color:#3b82f6;
      padding:6px 14px;border-radius:7px;font-size:11px;text-decoration:none;display:inline-block;margin-right:8px}
</style>
"""

def _html(title, body, report_id):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    url = f"{APP_URL}/report/{report_id}"
    return (
        "<!DOCTYPE html><html lang='en'><head>"
        "<meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{title} — AI Trading Lab</title>"
        f"{_CSS}"
        "</head><body>"
        "<header>"
        "<span style='font-size:28px;margin-right:10px'>⚡</span>"
        f"<div><h1>{title}</h1>"
        f"<div class='meta'>AI Trading Lab · {now}</div></div>"
        "</header>"
        f"{body}"
        f"<footer>AI Trading Lab · Paper trading · Not financial advice<br>"
        f"<a href='{url}' style='color:#3b82f6'>{url}</a></footer>"
        "</body></html>"
    )

def _vc(v):
    """CSS class for a numeric value (green/red/empty)."""
    try:
        f = float(v)
        return "green" if f > 0 else "red" if f < 0 else ""
    except Exception:
        return ""

def _kpi(label, value, cls=""):
    return (
        f"<div class='kpi'>"
        f"<div class='kpi-label'>{label}</div>"
        f"<div class='kpi-value {cls}'>{value}</div>"
        f"</div>"
    )

def _row(*cells):
    inner = "".join(f"<td>{c}</td>" for c in cells)
    return f"<tr>{inner}</tr>"


# ── Portfolio report ──────────────────────────────────────────────────────────
def generate_portfolio_report(portfolio, agents, trades):
    rid  = "portfolio-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    body = "<div class='grid4'>"

    eq  = portfolio.get("equity", 0)
    ret = portfolio.get("total_return", 0)
    pnl = portfolio.get("daily_pnl", 0)

    body += _kpi("Equity",        f"${eq:,.0f}",           "cyan")
    body += _kpi("Total Return",  f"{ret:+.2f}%",          _vc(ret))
    body += _kpi("Daily P&L",     f"${pnl:+,.0f}",         _vc(pnl))
    body += _kpi("Sharpe",        f"{portfolio.get('sharpe',0):.2f}")
    body += _kpi("Sortino",       f"{portfolio.get('sortino',0):.2f}")
    body += _kpi("Max Drawdown",  f"{portfolio.get('max_drawdown',0):.1f}%", "red")
    body += _kpi("Win Rate",      f"{portfolio.get('win_rate',0):.1f}%",     "green")
    body += _kpi("Active Agents", f"{portfolio.get('active_agents',0)}/10",  "cyan")
    body += "</div>"

    # Agent table
    body += "<h2>Agent Performance</h2><div class='card'><table>"
    body += "<tr><th>Agent</th><th>Strategy</th><th>Return</th><th>Sharpe</th><th>Accuracy</th><th>State</th><th>Last Trade</th></tr>"
    for a in sorted(agents, key=lambda x: x.get("perf", 0), reverse=True):
        p     = a.get("perf", 0)
        color = a.get("color", "#fff")
        state = a.get("state", "")
        sc    = "#10b981" if state == "Live" else "#f59e0b"
        body += (
            f"<tr>"
            f"<td class='mono' style='font-weight:700;color:{color}'>{a.get('abbr','')}</td>"
            f"<td style='color:#94a3b8'>{a.get('strategy','')}</td>"
            f"<td class='mono {_vc(p)}'>{p:+.2f}%</td>"
            f"<td class='mono'>{a.get('sharpe',0):.2f}</td>"
            f"<td class='mono'>{a.get('accuracy',0):.1f}%</td>"
            f"<td><span class='badge' style='background:{sc}22;color:{sc}'>{state}</span></td>"
            f"<td class='mono' style='font-size:10px;color:#64748b'>{a.get('last_trade','')}</td>"
            f"</tr>"
        )
    body += "</table></div>"

    # Trades
    if trades:
        body += "<h2>Recent Trades</h2><div class='card'><table>"
        body += "<tr><th>Agent</th><th>Symbol</th><th>Side</th><th>Price</th><th>P&L</th><th>Time</th></tr>"
        for t in trades[:20]:
            pnl_t  = t.get("pnl", 0)
            side   = t.get("side", "")
            side_c = "green" if side == "BUY" else "red"
            body  += (
                f"<tr>"
                f"<td class='mono'>{t.get('agent_abbr','')}</td>"
                f"<td class='mono' style='font-weight:700'>{t.get('symbol','')}</td>"
                f"<td class='mono {side_c}'>{side}</td>"
                f"<td class='mono'>${t.get('price',0):.2f}</td>"
                f"<td class='mono {_vc(pnl_t)}'>{pnl_t:+.2f}%</td>"
                f"<td style='font-size:10px;color:#64748b'>{str(t.get('ts',''))[:16]}</td>"
                f"</tr>"
            )
        body += "</table></div>"

    html = _html("Portfolio Report", body, rid)
    (REPORTS_DIR / f"{rid}.html").write_text(html)
    return rid


# ── Scout report ──────────────────────────────────────────────────────────────
def generate_scout_report(screen):
    rid  = "scout-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    body = "<div class='grid4'>"
    body += _kpi("Screened",  str(screen.get("screened", 0)))
    body += _kpi("Regime",    str(screen.get("regime", "?")).upper(), "cyan")
    body += _kpi("Top Long",  screen.get("top_long", "—") or "—", "green")
    body += _kpi("Top Short", screen.get("top_short", "—") or "—", "red")
    body += "</div>"

    longs = screen.get("longs", [])
    if longs:
        body += "<h2>Long Picks</h2><div class='card'><table>"
        body += "<tr><th>Symbol</th><th>Score</th><th>Conviction</th><th>Sector</th><th>Tech</th><th>Macro</th><th>Quality</th><th>Thesis</th></tr>"
        for p in longs[:10]:
            thesis = p.get("thesis", {})
            thesis_txt = ""
            if isinstance(thesis, dict):
                thesis_txt = (thesis.get("thesis") or "")[:80]
            conv = p.get("conviction", "")
            conv_c = {"HIGH": "#10b981", "MEDIUM": "#f59e0b", "LOW": "#ef4444"}.get(conv, "#64748b")
            bd    = p.get("breakdown", {})
            body += (
                f"<tr>"
                f"<td class='mono' style='font-weight:800'>{p['symbol']}</td>"
                f"<td class='mono' style='color:{conv_c};font-weight:700'>{p.get('composite',0)}</td>"
                f"<td><span class='badge' style='background:{conv_c}22;color:{conv_c}'>{conv}</span></td>"
                f"<td style='color:#94a3b8;font-size:11px'>{p.get('sector','')}</td>"
                f"<td class='mono'>{bd.get('technical',0):.0f}</td>"
                f"<td class='mono'>{bd.get('macro',0):.0f}</td>"
                f"<td class='mono'>{bd.get('quality',0):.0f}</td>"
                f"<td style='font-size:10px;color:#94a3b8'>{thesis_txt}</td>"
                f"</tr>"
            )
        body += "</table></div>"

    shorts = screen.get("shorts", [])
    if shorts:
        body += "<h2>Short Ideas</h2><div class='card'><table>"
        body += "<tr><th>Symbol</th><th>Score</th><th>Sector</th></tr>"
        for p in shorts[:5]:
            body += (
                f"<tr>"
                f"<td class='mono red' style='font-weight:800'>{p['symbol']}</td>"
                f"<td class='mono red'>{p.get('composite',0)}</td>"
                f"<td style='color:#94a3b8'>{p.get('sector','')}</td>"
                f"</tr>"
            )
        body += "</table></div>"

    regime_title = str(screen.get("regime", "")).title()
    html = _html(f"SCOUT Screen — {regime_title} Regime", body, rid)
    (REPORTS_DIR / f"{rid}.html").write_text(html)
    return rid


# ── Backtest report ───────────────────────────────────────────────────────────
def generate_backtest_report(result):
    abbr    = result.get("abbr", "")
    symbol  = result.get("symbol", "")
    horizon = result.get("horizon", "")
    rid     = f"backtest-{abbr}-{symbol}-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    body    = "<div class='grid4'>"

    total_ret = result.get("total_return", 0)
    alpha_v   = result.get("alpha", 0)
    dd        = result.get("max_drawdown", 0)
    pf        = result.get("profit_factor", 1)

    body += _kpi("Total Return",  f"{total_ret:+.2f}%",            _vc(total_ret))
    body += _kpi("Alpha vs B&H",  f"{alpha_v:+.2f}%",              _vc(alpha_v))
    body += _kpi("Sharpe",        f"{result.get('sharpe',0):.3f}")
    body += _kpi("Max Drawdown",  f"{dd:.1f}%",                    "red")
    body += _kpi("Win Rate",      f"{result.get('win_rate',0):.1f}%", "green")
    body += _kpi("Total Trades",  str(result.get("total_trades", 0)))
    body += _kpi("Profit Factor", f"{pf:.2f}x",                    _vc(pf - 1))
    body += _kpi("Calmar",        f"{result.get('calmar',0):.2f}")
    body += "</div>"

    trades = result.get("trades", [])
    if trades:
        body += "<h2>Trade Log</h2><div class='card'><table>"
        body += "<tr><th>Date</th><th>Side</th><th>Price</th><th>Entry</th><th>P&L</th><th>P&L%</th></tr>"
        for t in trades[-20:]:
            pnl_v   = t.get("pnl", 0)
            pnl_pct = t.get("pnl_pct", 0) * 100
            side    = t.get("side", "")
            side_c  = "red" if side == "SELL" else "green"
            body   += (
                f"<tr>"
                f"<td style='color:#64748b;font-size:10px'>{str(t.get('ts',''))[:10]}</td>"
                f"<td class='mono {side_c}'>{side}</td>"
                f"<td class='mono'>${t.get('price',0):.2f}</td>"
                f"<td class='mono'>${t.get('entry',0):.2f}</td>"
                f"<td class='mono {_vc(pnl_v)}'>{pnl_v:+.2f}</td>"
                f"<td class='mono {_vc(pnl_pct)}'>{pnl_pct:+.2f}%</td>"
                f"</tr>"
            )
        body += "</table></div>"

    title = f"Backtest — {abbr} / {symbol} / {horizon}"
    html  = _html(title, body, rid)
    (REPORTS_DIR / f"{rid}.html").write_text(html)
    return rid


# ── List + get reports ────────────────────────────────────────────────────────
def list_reports():
    return sorted([
        {
            "id":      p.stem,
            "type":    p.stem.split("-")[0],
            "url":     f"/report/{p.stem}",
            "size_kb": round(p.stat().st_size / 1024, 1),
            "created": datetime.fromtimestamp(
                p.stat().st_mtime, tz=timezone.utc
            ).isoformat(),
        }
        for p in REPORTS_DIR.glob("*.html")
    ], key=lambda x: x["created"], reverse=True)


def get_report_html(report_id):
    p = REPORTS_DIR / f"{report_id}.html"
    if p.exists():
        return p.read_text()
    return None
