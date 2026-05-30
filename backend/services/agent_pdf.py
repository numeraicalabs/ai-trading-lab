"""
Agent PDF — genera una presentazione PDF professionale per ogni agente AI.

Layout (3 pagine):
  1. Cover     — nome, strategia, KPI principali, descrizione
  2. Analytics — equity curve (SVG→canvas), feature importance, metriche OOS
  3. Trade Log — ultime 30 operazioni + sommario statistico
"""
import io, math, os
from datetime import datetime, timezone
from pathlib import Path

# ── ReportLab imports ─────────────────────────────────────────────────────────
from reportlab.lib.pagesizes   import A4
from reportlab.lib.units        import cm, mm
from reportlab.lib              import colors
from reportlab.lib.styles       import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums        import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus         import (SimpleDocTemplate, Paragraph, Spacer,
                                         Table, TableStyle, HRFlowable,
                                         PageBreak, KeepTogether)
from reportlab.graphics.shapes  import (Drawing, Rect, Line, Polygon,
                                         String, Circle, Path)
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics         import renderPDF

PDF_DIR = Path(__file__).parent.parent / "agent_pdfs"
PDF_DIR.mkdir(exist_ok=True)

# ── Palette ───────────────────────────────────────────────────────────────────
BG    = colors.HexColor("#0a0e17")
CARD  = colors.HexColor("#141c2e")
SURF  = colors.HexColor("#111827")
BDR   = colors.HexColor("#1e2d47")
GREEN = colors.HexColor("#10b981")
RED   = colors.HexColor("#ef4444")
YELL  = colors.HexColor("#f59e0b")
CYAN  = colors.HexColor("#06b6d4")
PURP  = colors.HexColor("#8b5cf6")
BLUE  = colors.HexColor("#3b82f6")
TEXT  = colors.HexColor("#e2e8f0")
MUTED = colors.HexColor("#64748b")
WHITE = colors.white

W, H  = A4   # 595 × 842 pt


# ── Style helpers ─────────────────────────────────────────────────────────────
def _style(name="Normal", **kw):
    base = getSampleStyleSheet()[name]
    return ParagraphStyle(name + "_custom", parent=base, **kw)

HEAD1 = _style("Normal", fontSize=28, fontName="Helvetica-Bold",
               textColor=WHITE, leading=34, spaceAfter=4)
HEAD2 = _style("Normal", fontSize=16, fontName="Helvetica-Bold",
               textColor=TEXT, leading=20, spaceAfter=6)
HEAD3 = _style("Normal", fontSize=11, fontName="Helvetica-Bold",
               textColor=CYAN, leading=14, spaceAfter=4)
BODY  = _style("Normal", fontSize=9,  fontName="Helvetica",
               textColor=MUTED, leading=14, spaceAfter=4)
SMALL = _style("Normal", fontSize=8,  fontName="Helvetica",
               textColor=MUTED, leading=11)
MONO  = _style("Normal", fontSize=9,  fontName="Courier",
               textColor=TEXT,  leading=13)
TAG   = _style("Normal", fontSize=8,  fontName="Helvetica-Bold",
               textColor=TEXT,  alignment=TA_CENTER)


# ── Background canvas ─────────────────────────────────────────────────────────
def _bg_canvas(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BG)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    # Subtle grid dots
    canvas.setFillColor(colors.HexColor("#1e2d47"))
    step = 24
    for x in range(0, int(W) + step, step):
        for y in range(0, int(H) + step, step):
            canvas.circle(x, y, 0.6, fill=1, stroke=0)
    canvas.restoreState()

def _first_page(canvas, doc):
    _bg_canvas(canvas, doc)
    # Top accent bar
    canvas.saveState()
    canvas.setFillColor(BLUE)
    canvas.rect(0, H - 4, W, 4, fill=1, stroke=0)
    canvas.restoreState()

def _later_page(canvas, doc):
    _bg_canvas(canvas, doc)
    # Thin top bar
    canvas.saveState()
    canvas.setFillColor(BDR)
    canvas.rect(0, H - 2, W, 2, fill=1, stroke=0)
    # Footer
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(2*cm, 1.2*cm, "AI Trading Lab — Agent Profile")
    canvas.drawRightString(W - 2*cm, 1.2*cm,
                           f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d')}")
    canvas.restoreState()


# ── Chart: equity sparkline ───────────────────────────────────────────────────
def _equity_chart(equity_data: list, color_hex: str, w=420, h=130) -> Drawing:
    d = Drawing(w, h)
    d.add(Rect(0, 0, w, h, fillColor=CARD, strokeColor=BDR, strokeWidth=0.5))

    if len(equity_data) < 2:
        d.add(String(w/2, h/2, "No data", fillColor=MUTED, fontSize=9,
                     textAnchor="middle"))
        return d

    vals = [float(pt.get("v", pt.get("equity", 100))) for pt in equity_data]
    mn, mx = min(vals), max(vals)
    rng = mx - mn if mx != mn else 1

    # Grid lines
    for pct in [0.25, 0.5, 0.75]:
        y = 12 + pct * (h - 24)
        d.add(Line(10, y, w - 10, y,
                   strokeColor=BDR, strokeWidth=0.4))

    # Zero baseline
    base_y = 12 + (100 - mn) / rng * (h - 24) if mn <= 100 <= mx else None
    if base_y:
        d.add(Line(10, base_y, w - 10, base_y,
                   strokeColor=MUTED, strokeWidth=0.8, strokeDashArray=[3, 3]))

    # Area fill
    step = (w - 20) / (len(vals) - 1)
    pts  = []
    for i, v in enumerate(vals):
        x = 10 + i * step
        y = 12 + (v - mn) / rng * (h - 24)
        pts.append((x, y))

    # Fill polygon
    poly_pts = [10, 12] + [c for p in pts for c in p] + [pts[-1][0], 12]
    d.add(Polygon(poly_pts,
                  fillColor=colors.HexColor(color_hex + "33"),
                  strokeColor=None))

    # Line
    for i in range(len(pts) - 1):
        d.add(Line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1],
                   strokeColor=colors.HexColor(color_hex),
                   strokeWidth=1.8))

    # Axis labels
    d.add(String(10, 3, f"{mn:.1f}", fillColor=MUTED, fontSize=6))
    d.add(String(10, h - 10, f"{mx:.1f}", fillColor=MUTED, fontSize=6))
    d.add(String(w/2, h - 10, "Equity Curve", fillColor=MUTED,
                 fontSize=7, textAnchor="middle"))
    return d


# ── Chart: feature importance bar ─────────────────────────────────────────────
def _feature_chart(fi: dict, color_hex: str, w=260, h=120) -> Drawing:
    d  = Drawing(w, h)
    d.add(Rect(0, 0, w, h, fillColor=CARD, strokeColor=BDR, strokeWidth=0.5))

    items = sorted(fi.items(), key=lambda x: -x[1])[:8]
    if not items:
        d.add(String(w/2, h/2, "No data", fillColor=MUTED, fontSize=9,
                     textAnchor="middle"))
        return d

    bar_h   = (h - 20) / len(items)
    max_val = items[0][1]
    col     = colors.HexColor(color_hex)

    for i, (feat, val) in enumerate(items):
        y      = h - 15 - (i + 1) * bar_h + 2
        bar_w  = max(2, (val / max_val) * (w - 90))
        d.add(Rect(78, y, bar_w, bar_h - 3,
                   fillColor=col, strokeColor=None))
        d.add(String(4, y + 2, feat[:10], fillColor=MUTED,
                     fontSize=6.5, textAnchor="start"))
        d.add(String(w - 4, y + 2, f"{val*100:.1f}%",
                     fillColor=col, fontSize=6.5, textAnchor="end"))

    d.add(String(w/2, 3, "Feature Importance", fillColor=MUTED,
                 fontSize=7, textAnchor="middle"))
    return d


# ── KPI badge ─────────────────────────────────────────────────────────────────
def _kpi_table(kpis: list) -> Table:
    """kpis = [(label, value, color_hex), ...]"""
    row = []
    for label, value, chex in kpis:
        inner = Table(
            [[Paragraph(label, SMALL)],
             [Paragraph(f"<b>{value}</b>",
                        _style("Normal", fontSize=15, fontName="Courier-Bold",
                               textColor=colors.HexColor(chex), leading=18))]],
            colWidths=[3.6*cm],
        )
        inner.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), CARD),
            ("BOX",       (0,0), (-1,-1), 0.5, BDR),
            ("TOPPADDING",(0,0), (-1,-1), 8),
            ("BOTTOMPADDING",(0,0),(-1,-1),8),
            ("LEFTPADDING",(0,0),(-1,-1),8),
        ]))
        row.append(inner)
    t = Table([row], colWidths=[3.9*cm] * len(kpis))
    t.setStyle(TableStyle([
        ("TOPPADDING",    (0,0), (-1,-1), 0),
        ("BOTTOMPADDING", (0,0), (-1,-1), 0),
        ("LEFTPADDING",   (0,0), (-1,-1), 4),
        ("RIGHTPADDING",  (0,0), (-1,-1), 4),
    ]))
    return t


# ── Main PDF generator ────────────────────────────────────────────────────────
def generate_agent_pdf(agent: dict, meta: dict = None,
                       backtest: dict = None, trades: list = None) -> bytes:
    """
    Genera il PDF dell'agente e restituisce i bytes.
    agent  : AGENT_STATE entry
    meta   : trainer metadata (accuracy, feature_importance, ...)
    backtest: backtest result dict
    trades  : lista trade recenti
    """
    buf  = io.BytesIO()
    doc  = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2.5*cm, bottomMargin=2.5*cm,
    )

    story = []
    abbr  = agent.get("abbr", "?")
    name  = agent.get("name", abbr)
    color = agent.get("color", "#3b82f6")
    icon  = agent.get("icon", "🤖")
    strategy  = agent.get("strategy", "")
    typ       = agent.get("type", "")
    state     = agent.get("state", "Live")
    perf      = agent.get("perf", 0.0)
    sharpe    = agent.get("sharpe", 0.0)
    sortino   = agent.get("sortino", 0.0)
    max_dd    = agent.get("max_drawdown", 0.0)
    accuracy  = agent.get("accuracy", 0.0)
    win_rate  = agent.get("win_rate", 0.0)
    trades_n  = agent.get("trades_count", 0)
    alpha     = agent.get("alpha", 0.0)
    confidence= agent.get("confidence", 50)
    reward    = agent.get("reward", 0.0)
    equity    = agent.get("equity", [])
    horizon   = agent.get("horizon", "swing")
    assets    = agent.get("assets", [])
    pf        = agent.get("profit_factor", 1.0)
    col       = colors.HexColor(color)

    meta     = meta     or {}
    backtest = backtest or {}
    trades   = trades   or []

    state_c  = "#10b981" if state == "Live" else "#f59e0b" if state == "Training" else "#64748b"

    # ── PAGE 1: Cover ─────────────────────────────────────────────────────────

    # Accent bar at top (drawn via onFirstPage)
    story.append(Spacer(1, 0.4*cm))

    # Logo + badge row
    badge_tbl = Table(
        [[
            Paragraph(f"<b>{icon} {abbr}</b>",
                      _style("Normal", fontSize=34, fontName="Helvetica-Bold",
                             textColor=col, leading=40)),
            Paragraph(f'<font color="{state_c}"><b>{state}</b></font>',
                      _style("Normal", fontSize=11, fontName="Helvetica-Bold",
                             textColor=colors.HexColor(state_c),
                             alignment=TA_RIGHT, leading=14)),
        ]],
        colWidths=[12*cm, 5*cm],
    )
    badge_tbl.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "BOTTOM"),
        ("TOPPADDING", (0,0), (-1,-1), 0),
        ("BOTTOMPADDING", (0,0), (-1,-1), 0),
    ]))
    story.append(badge_tbl)
    story.append(Spacer(1, 0.2*cm))

    story.append(Paragraph(name, HEAD1))
    story.append(Paragraph(
        f"<b>{strategy}</b>  ·  {typ}  ·  Horizon: {horizon}",
        _style("Normal", fontSize=11, textColor=MUTED, leading=16)
    ))

    story.append(HRFlowable(width="100%", thickness=0.5, color=BDR,
                             spaceAfter=12, spaceBefore=10))

    # Main KPIs
    perf_c  = "#10b981" if perf >= 0 else "#ef4444"
    kpis1   = [
        ("YTD Return",     f"{perf:+.2f}%",     perf_c),
        ("Sharpe Ratio",   f"{sharpe:.2f}",      "#06b6d4"),
        ("Sortino Ratio",  f"{sortino:.2f}",     "#8b5cf6"),
        ("Max Drawdown",   f"{max_dd:.1f}%",     "#ef4444"),
    ]
    story.append(_kpi_table(kpis1))
    story.append(Spacer(1, 0.3*cm))
    kpis2 = [
        ("OOS Accuracy",   f"{accuracy:.1f}%",   "#10b981" if accuracy>=65 else "#f59e0b"),
        ("Win Rate",       f"{win_rate:.1f}%",   "#10b981"),
        ("Total Trades",   str(int(trades_n)),    "#e2e8f0"),
        ("Alpha",          f"{alpha:+.1f}%",      "#10b981" if alpha>=0 else "#ef4444"),
    ]
    story.append(_kpi_table(kpis2))
    story.append(Spacer(1, 0.3*cm))

    # Equity chart
    if equity:
        story.append(Paragraph("Equity Curve", HEAD3))
        d = _equity_chart(equity, color, w=int(W - 4*cm), h=140)
        story.append(d)
        story.append(Spacer(1, 0.3*cm))

    # Description
    DESCRIPTIONS = {
        "MOM": ("Trend-following agent that rides momentum across multiple timeframes. "
                "Uses Gradient Boosting to detect when price action exhibits "
                "sustained directional strength combined with above-average volume."),
        "MRV": ("Contrarian mean-reversion specialist. Identifies statistically "
                "stretched price deviations from fair value using Bollinger Bands, "
                "z-scores and Logistic Regression trained on reversal patterns."),
        "PPO": ("Reinforcement Learning agent using Proximal Policy Optimization. "
                "Learns an optimal trading policy through reward-penalty cycles "
                "on historical market simulations."),
        "DQN": ("Deep Q-Network agent that models the market as a discrete action "
                "space (BUY/SELL/HOLD). Uses a Random Forest to approximate "
                "Q-values and select highest-reward actions."),
        "MAC": ("Macro top-down analyst. Tracks cross-asset correlations — equities, "
                "bonds, gold and oil — to identify risk-on vs risk-off regimes "
                "and position accordingly."),
        "SEN": ("NLP-powered sentiment trader. Fuses news scores, social sentiment "
                "proxies and Logistic Regression signal to trade around "
                "information events and narrative shifts."),
        "VOL": ("Volatility specialist. Exploits ATR expansions and contractions, "
                "fear/greed cycles and VIX term structure to profit from "
                "variance mispricing."),
        "REG": ("Market regime detector. Classifies the market into bull, bear and "
                "neutral states using HMM-inspired Gradient Boosting. Broadcasts "
                "regime signals to all other agents."),
        "OPT": ("Portfolio optimizer. Uses Ridge regression and Modern Portfolio "
                "Theory to dynamically size positions, minimise drawdown and "
                "maximise risk-adjusted returns across the agent ecosystem."),
        "SCOUT": ("Senior trader & macro analyst AI. Screens 50+ symbols using "
                  "a 5-factor model (Technical, Macro, Quality, Relative Strength, "
                  "Sentiment) and generates conviction-weighted investment theses "
                  "via Ollama LLM."),
    }
    desc = DESCRIPTIONS.get(abbr, f"{name} is an AI-powered trading agent.")
    story.append(Paragraph("About This Agent", HEAD3))
    story.append(Paragraph(desc, BODY))
    story.append(Spacer(1, 0.3*cm))

    # Assets + best horizons
    info_tbl = Table(
        [[
            Paragraph(f"<b>Primary Assets</b><br/>"
                      + " · ".join(assets),
                      _style("Normal", fontSize=9, textColor=MUTED, leading=14)),
            Paragraph(f"<b>Best Horizons</b><br/>"
                      + " · ".join(agent.get("best_horizons", [horizon])),
                      _style("Normal", fontSize=9, textColor=MUTED, leading=14)),
            Paragraph(f"<b>Confidence</b><br/>{confidence:.0f} / 100",
                      _style("Normal", fontSize=9, textColor=MUTED, leading=14)),
            Paragraph(f"<b>Reward</b><br/>{reward:.0f}",
                      _style("Normal", fontSize=9, textColor=MUTED, leading=14)),
        ]],
        colWidths=[4.3*cm] * 4,
    )
    info_tbl.setStyle(TableStyle([
        ("BACKGROUND",     (0,0),(-1,-1), CARD),
        ("BOX",            (0,0),(-1,-1), 0.5, BDR),
        ("INNERGRID",      (0,0),(-1,-1), 0.3, BDR),
        ("TOPPADDING",     (0,0),(-1,-1), 8),
        ("BOTTOMPADDING",  (0,0),(-1,-1), 8),
        ("LEFTPADDING",    (0,0),(-1,-1), 10),
    ]))
    story.append(info_tbl)

    story.append(PageBreak())

    # ── PAGE 2: Analytics ─────────────────────────────────────────────────────
    story.append(Spacer(1, 0.4*cm))
    story.append(Paragraph("Analytics & Model Performance", HEAD2))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BDR,
                             spaceAfter=10, spaceBefore=6))

    # OOS metrics
    oos = meta.get("oos_metrics", {})
    if oos:
        story.append(Paragraph("Out-of-Sample Test Metrics", HEAD3))
        oos_kpis = []
        for k, v in oos.items():
            if k == "confusion_matrix": continue
            try:
                oos_kpis.append((k.replace("_"," ").title(), f"{float(v):.4f}", "#06b6d4"))
            except Exception:
                pass
        if oos_kpis:
            # Build in rows of 4
            for i in range(0, len(oos_kpis), 4):
                story.append(_kpi_table(oos_kpis[i:i+4]))
                story.append(Spacer(1, 0.2*cm))

    # Model training stats
    if meta.get("trained"):
        story.append(Paragraph("Training Quality", HEAD3))
        cv    = meta.get("cv_mean", 0)
        cv_s  = meta.get("cv_std", 0)
        ofs   = meta.get("overfit_gap", 0)
        ofs_c = "#ef4444" if ofs > 0.15 else "#10b981"
        tr_kpis = [
            ("Train Samples",  str(meta.get("samples_train", 0)),    "#e2e8f0"),
            ("Test Samples",   str(meta.get("samples_test",  0)),    "#e2e8f0"),
            ("CV Mean",        f"{cv*100:.1f}%",                     "#06b6d4"),
            ("CV Std",         f"±{cv_s*100:.1f}%",                  "#64748b"),
            ("Train Acc",      f"{meta.get('train_accuracy',0)*100:.1f}%", "#e2e8f0"),
            ("Overfit Gap",    f"{ofs*100:+.1f}%",                   ofs_c),
        ]
        for i in range(0, len(tr_kpis), 4):
            story.append(_kpi_table(tr_kpis[i:i+4]))
            story.append(Spacer(1, 0.2*cm))

    # Side-by-side: feature importance + backtest metrics
    left_items = []
    right_items = []

    fi = meta.get("feature_importance", {})
    if fi:
        left_items.append(Paragraph("Feature Importance", HEAD3))
        left_items.append(_feature_chart(fi, color))

    if backtest and backtest.get("total_return") is not None:
        story.append(Paragraph("Backtest Results", HEAD3))
        bt_r  = backtest.get("total_return", 0)
        bt_al = backtest.get("alpha", 0)
        bt_dd = backtest.get("max_drawdown", 0)
        bt_kpis = [
            ("BT Return",   f"{bt_r:+.2f}%",  "#10b981" if bt_r>=0 else "#ef4444"),
            ("BT Alpha",    f"{bt_al:+.2f}%", "#10b981" if bt_al>=0 else "#ef4444"),
            ("BT Sharpe",   f"{backtest.get('sharpe',0):.3f}",  "#06b6d4"),
            ("BT Max DD",   f"{bt_dd:.1f}%",  "#ef4444"),
            ("BT Win Rate", f"{backtest.get('win_rate',0):.1f}%","#10b981"),
            ("BT P.Factor", f"{backtest.get('profit_factor',1):.2f}x","#e2e8f0"),
        ]
        story.append(_kpi_table(bt_kpis[:4]))
        story.append(Spacer(1, 0.15*cm))
        story.append(_kpi_table(bt_kpis[4:]))
        story.append(Spacer(1, 0.3*cm))

    if fi:
        story.append(KeepTogether([
            Paragraph("Top Features", HEAD3),
            _feature_chart(fi, color, w=int(W - 4*cm), h=110),
        ]))

    # Confusion matrix
    cm_data = oos.get("confusion_matrix")
    if cm_data and len(cm_data) == 2:
        story.append(Spacer(1, 0.3*cm))
        story.append(Paragraph("Confusion Matrix", HEAD3))
        labels = [["", "Pred: SELL", "Pred: BUY"],
                  ["Act: SELL", str(cm_data[0][0]), str(cm_data[0][1])],
                  ["Act: BUY",  str(cm_data[1][0]), str(cm_data[1][1])]]
        cm_tbl = Table(labels, colWidths=[3.5*cm, 3.5*cm, 3.5*cm])
        cm_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0,0), (-1, 0), SURF),
            ("BACKGROUND",    (0,0), ( 0,-1), SURF),
            ("BACKGROUND",    (1,1), ( 1, 1), colors.HexColor("#10b98133")),
            ("BACKGROUND",    (2,2), ( 2, 2), colors.HexColor("#10b98133")),
            ("BACKGROUND",    (1,2), ( 1, 2), colors.HexColor("#ef444433")),
            ("BACKGROUND",    (2,1), ( 2, 1), colors.HexColor("#ef444433")),
            ("TEXTCOLOR",     (0,0), (-1,-1), TEXT),
            ("FONTNAME",      (0,0), (-1,-1), "Helvetica"),
            ("FONTNAME",      (0,0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME",      (0,0), ( 0,-1), "Helvetica-Bold"),
            ("FONTSIZE",      (0,0), (-1,-1), 10),
            ("ALIGN",         (0,0), (-1,-1), "CENTER"),
            ("BOX",           (0,0), (-1,-1), 0.5, BDR),
            ("INNERGRID",     (0,0), (-1,-1), 0.3, BDR),
            ("TOPPADDING",    (0,0), (-1,-1), 8),
            ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ]))
        story.append(cm_tbl)

    story.append(PageBreak())

    # ── PAGE 3: Trade Log ─────────────────────────────────────────────────────
    story.append(Spacer(1, 0.4*cm))
    story.append(Paragraph("Trade Activity & Statistics", HEAD2))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BDR,
                             spaceAfter=10, spaceBefore=6))

    # Summary stats
    if trades:
        wins    = [t for t in trades if (t.get("pnl") or 0) > 0]
        losses  = [t for t in trades if (t.get("pnl") or 0) <= 0]
        avg_win = sum(t.get("pnl",0) for t in wins)  / max(len(wins),  1)
        avg_los = sum(t.get("pnl",0) for t in losses)/ max(len(losses), 1)
        gross_w = sum(t.get("pnl",0) for t in wins)
        gross_l = abs(sum(t.get("pnl",0) for t in losses)) or 1e-9
        sum_kpis = [
            ("Total Trades",  str(len(trades)),                   "#e2e8f0"),
            ("Win Rate",      f"{len(wins)/max(len(trades),1)*100:.1f}%", "#10b981"),
            ("Avg Win",       f"{avg_win:+.2f}%",                 "#10b981"),
            ("Avg Loss",      f"{avg_los:+.2f}%",                 "#ef4444"),
            ("Gross Win",     f"{gross_w:.2f}",                   "#10b981"),
            ("Profit Factor", f"{gross_w/gross_l:.2f}x",          "#06b6d4"),
        ]
        story.append(_kpi_table(sum_kpis[:4]))
        story.append(Spacer(1, 0.15*cm))
        story.append(_kpi_table(sum_kpis[4:]))
        story.append(Spacer(1, 0.3*cm))

    # Trade table (last 30)
    story.append(Paragraph(f"Last {min(len(trades), 30)} Trades", HEAD3))

    if trades:
        headers = ["Date", "Symbol", "Side", "Price", "P&L", "Status"]
        rows    = [headers]
        for t in trades[:30]:
            pnl_v  = t.get("pnl", 0)
            pnl_s  = f"{pnl_v:+.2f}%"
            side   = t.get("side", "")
            rows.append([
                str(t.get("ts", ""))[:10],
                t.get("symbol", ""),
                side,
                f"${t.get('price', 0):.2f}",
                pnl_s,
                t.get("status", "filled"),
            ])

        trade_tbl = Table(rows, colWidths=[2.8*cm, 2.2*cm, 1.5*cm, 2.5*cm, 2.5*cm, 2.5*cm])
        ts = TableStyle([
            # Header
            ("BACKGROUND",    (0,0), (-1, 0), SURF),
            ("TEXTCOLOR",     (0,0), (-1, 0), MUTED),
            ("FONTNAME",      (0,0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",      (0,0), (-1,-1), 8),
            ("FONTNAME",      (0,1), (-1,-1), "Courier"),
            ("TEXTCOLOR",     (0,1), (-1,-1), TEXT),
            ("BACKGROUND",    (0,1), (-1,-1), CARD),
            ("ROWBACKGROUNDS",(0,1), (-1,-1), [CARD, SURF]),
            ("BOX",           (0,0), (-1,-1), 0.5, BDR),
            ("INNERGRID",     (0,0), (-1,-1), 0.2, BDR),
            ("TOPPADDING",    (0,0), (-1,-1), 5),
            ("BOTTOMPADDING", (0,0), (-1,-1), 5),
            ("LEFTPADDING",   (0,0), (-1,-1), 6),
        ])
        # Color P&L column
        for i, t in enumerate(trades[:30], start=1):
            pnl_v = t.get("pnl", 0)
            clr   = GREEN if pnl_v > 0 else RED
            ts.add("TEXTCOLOR", (4, i), (4, i), clr)
        # Color side column
        for i, t in enumerate(trades[:30], start=1):
            side_c = GREEN if t.get("side") == "BUY" else RED
            ts.add("TEXTCOLOR", (2, i), (2, i), side_c)
        trade_tbl.setStyle(ts)
        story.append(trade_tbl)
    else:
        story.append(Paragraph("No trades recorded yet.", BODY))

    # Footer note
    story.append(Spacer(1, 0.6*cm))
    story.append(HRFlowable(width="100%", thickness=0.3, color=BDR, spaceAfter=8))
    story.append(Paragraph(
        f"This document was generated on "
        f"{datetime.now(timezone.utc).strftime('%Y-%m-%d at %H:%M UTC')} "
        f"by AI Trading Lab. All results are paper trading simulations. "
        f"Not financial advice.",
        _style("Normal", fontSize=7, textColor=MUTED, leading=10)
    ))

    doc.build(story,
              onFirstPage=_first_page,
              onLaterPages=_later_page)
    return buf.getvalue()


def save_agent_pdf(agent_abbr: str, pdf_bytes: bytes) -> Path:
    path = PDF_DIR / f"agent-{agent_abbr.lower()}.pdf"
    path.write_bytes(pdf_bytes)
    return path
