# AI Trading Lab — Prompt per Sessione di Miglioramento

Copia e incolla questo intero documento come primo messaggio della prossima sessione.

---

## CONTESTO PROGETTO

Sei Claude. Stai continuando lo sviluppo di **AI Trading Lab** — una piattaforma di paper trading multi-agente con 10 agenti ML, FastAPI + React + Supabase, deployata su Render come singolo web service.

**Percorso progetto:** `/home/claude/trading-lab/`
**Ultimo ZIP:** `ai-trading-lab-v12.zip`
**URL Render:** `https://ai-trading-lab-wtat.onrender.com`

---

## STACK TECNICO (non cambiare)

```
Backend  : FastAPI 0.111 · Python 3.11 · uvicorn
ML       : scikit-learn 1.4 · joblib · pandas · numpy
Frontend : React 18 · Vite · Recharts
DB       : Supabase PostgreSQL
AI Chat  : Ollama (llama3, opzionale — offline su Render free tier)
PDF      : ReportLab 4.2
Deploy   : Render single web service · render.yaml
```

---

## STATO ATTUALE (v12) — COSA ESISTE GIÀ

### Backend services
```
agents.py         — 10 agenti (MOM MRV PPO DQN MAC SEN VOL REG OPT SCOUT)
                    AGENT_STATE con equity_history[], impulse flow bus
                    OPT come master agent con get_all_positions()
trainer.py        — sklearn + walk-forward CV 3 fold + OOS accuracy (20% hold-out)
                    Metriche: F1, Precision, Recall, Brier, Confusion Matrix, overfit gap
trainer_queue.py  — async job queue con Supabase persistence
backtest.py       — vectorized simulation: Sharpe/Sortino/Calmar/MaxDD/WinRate/ProfitFactor
market.py         — yfinance (bloccato su Render) + synthetic OHLCV garantito
                    USE_SYNTHETIC_DATA=true su Render
scheduler.py      — auto-retrain: staleness/degradation/regime-triggered
scout.py          — SCOUT: 5-factor scoring (Technical/Macro/Quality/Relative/Sentiment)
                    AI thesis via Ollama per top picks
paper.py          — deduplication: DUPLICATE/FLIP/CONFLICT/SIZE_CAP (HTTP 409)
                    opt_rebalance() per ribilanciamento portfolio
universe.py       — 53 simboli default + CSV upload + custom symbols
db.py             — Supabase save: trades/jobs/models/scout_screens
reports.py        — HTML reports condivisibili per portfolio/scout/backtest
agent_pdf.py      — PDF 3 pagine per agente (ReportLab, FilePath alias)
ollama.py         — chat, parse_order, commentary, summarize
```

### Frontend pages & components
```
App.jsx            — root, 9 nav: Dashboard/Agents/Ecosystem/Network/Analytics/Trades/Chat/Lab/Learning/Scout
Dashboard          — KPI strip, equity curve, risk metrics, ensemble signal, sector exposure
AgentCard/Detail   — 4 tab: overview/learning/risk/trades + PDF download
OrderModal         — 4-step wizard: Ordine→Memo→Review→Done
                     Memo strutturato: thesis, signal_source, stop_loss, take_profit, tags, risk_level
                     Pre-trade checks: dedup/flip/R:R/regime/confidence
TradesPage         — open positions + conflict warnings + OPT rebalance suggestions
NetworkPage        — ImpulseFlow animato + Opportunity Scanner + Correlation Matrix
ScoutPage          — stock screening UI con AI thesis
TrainingLabPage    — 5 tab: Models/Backtest/Universe/Data/Health
AgentLearningPage  — learning curves per agente: OOS accuracy trend, overfit, F1
EcosystemPage      — agent control panel + training jobs + impulse flow tab
```

### Supabase tables
```
trades · training_jobs · model_versions · agent_snapshots
portfolio_snapshots · scout_screens · chat_messages
```

### Regole critiche Python 3.11 + JSX
```python
# NO backslash in f-string expressions
f"value = {var}"           # OK
f"value = {d.get(\"k\")}" # CRASH su 3.11 — estrarre var prima

# NO import Path se si usa reportlab.graphics.shapes
from pathlib import Path as FilePath  # alias obbligatorio

# JSX: NO > nei text node
→ usare &rarr; o {'->'}  # mai -> direttamente nel testo JSX

# Supabase pg_policies: tablename (senza underscore)
# information_schema: table_name (con underscore)

# React: sempre default props per array/object
function Component({ agents = [], trades = {}, prices = {} })

# Dashboard + tutti i componenti: passare agents={agents} prices={prices} esplicitamente
```

---

## OBIETTIVI DELLA SESSIONE

Implementa i seguenti 3 macro-obiettivi **in ordine**, completando ogni sezione prima di passare alla successiva.

---

### OBIETTIVO 1 — MODELLI DI SEGNALE ROBUSTI

I modelli attuali usano solo 16 feature tecniche standard. Devono diventare molto più robusti.

#### 1A. Feature engineering avanzato (`trainer.py`)
Aggiungi questi nuovi layer di feature in `market.add_indicators()`:

```python
# Microstructure
"close_to_open"     # gap overnight
"intraday_range"    # (high-low)/close
"upper_shadow"      # (high - max(open,close)) / (high-low+ε)
"lower_shadow"      # (min(open,close) - low) / (high-low+ε)
"body_ratio"        # |close-open| / (high-low+ε)

# Multi-timeframe momentum (usando il df corrente)
"roc_1", "roc_3", "roc_60"   # aggiunta a roc_5/10/20 esistenti
"ema_ratio_9_21"    # ema(9)/ema(21) - 1
"ema_ratio_21_55"   # ema(21)/ema(55) - 1

# Volatility regime
"realized_vol_5"    # std(returns, 5)
"realized_vol_20"   # std(returns, 20)
"vol_regime"        # realized_vol_5 / realized_vol_20 - 1  (>0 = vol espanding)
"atr_pct"           # atr / close

# Mean reversion
"distance_from_52w_high"   # (close - rolling_max(252)) / rolling_max(252)
"distance_from_52w_low"    # (close - rolling_min(252)) / rolling_min(252)
"percentile_rank_20"       # percentile rank del close negli ultimi 20 bar

# Volume analysis
"obv_slope"         # on-balance volume slope 10 bar
"vol_price_corr"    # rolling correlation(returns, volume_change, 20)
"vol_surge_3"       # volume / rolling_mean(volume, 3) - 1
```

#### 1B. Walk-forward validation rigorosa (`trainer.py`)
Sostituisci il CV a 3 fold con **expanding window walk-forward**:
- Minimo 5 fold
- Ogni fold: train su tutto il passato, test sul successivo 10% del dataset
- Calcola `avg_oos_accuracy`, `min_oos_accuracy`, `consistency_score` (% fold con acc > 52%)
- Se `consistency_score < 0.6` → modello marcato come `low_confidence`
- Aggiungi `information_coefficient` (IC): correlazione tra predicted score e actual return
- Aggiungi `hit_rate_by_confidence_decile`: tabella 10 bucket di confidence → actual win rate

#### 1C. Calibration del modello
- Usa `CalibratedClassifierCV(cv=3, method='isotonic')` per calibrare le probabilità
- Aggiungi Brier Skill Score (BSS) rispetto a baseline climatologico
- Aggiungi Expected Calibration Error (ECE)
- Salva reliability diagram data: 10 bin di predicted_prob → actual_frequency

#### 1D. Per-agente feature set ottimizzato
Ogni agente deve usare solo le feature più rilevanti per la sua strategia:

```python
AGENT_FEATURES = {
    "MOM": ["roc_5","roc_20","ema_ratio_9_21","ema_ratio_21_55","above_sma50",
            "vol_ratio","vol_surge_3","trend_slope","momentum","macd_hist"],
    "MRV": ["z_score_20","bb_pct","rsi","distance_from_52w_high",
            "distance_from_52w_low","percentile_rank_20","atr_pct","lower_shadow"],
    "VOL": ["realized_vol_5","realized_vol_20","vol_regime","atr_pct",
            "bb_width","intraday_range","vol_price_corr","upper_shadow"],
    "SEN": ["roc_1","roc_3","gap","close_to_open","vol_surge_3",
            "body_ratio","vol_ratio","macd_hist"],
    "MAC": ["ema_ratio_21_55","above_sma50","distance_from_52w_high",
            "trend_slope","vol_regime","roc_60"],
    "REG": ["realized_vol_5","vol_regime","ema_ratio_21_55","rsi",
            "percentile_rank_20","trend_slope","bb_width"],
}
# OPT/PPO/DQN usano tutti i feature (regressori)
```

#### 1E. Ensemble migliorato
Nel `ensemble_vote()` in `agents.py`:
- Peso = `oos_accuracy × ic_score × consistency_score` (invece di solo accuracy)
- Aggiungi `regime_confidence_multiplier`: se REG confidence > 0.7, agenti allineati pesano 1.3×
- `ensemble_confidence_interval`: range [lower, upper] del 80% confidence
- Filtro: se spread buy/sell < 0.15 → HOLD forzato (segnale troppo debole)

---

### OBIETTIVO 2 — REGISTRO ORDINI APPROFONDITO

#### 2A. Order Book completo (`services/order_book.py`) — NUOVO FILE
Crea un registro ordini persistente con questi campi estesi:

```python
@dataclass
class Order:
    # Identity
    order_id:        str     # uuid
    parent_order_id: str     # per ordini derivati (es. stop loss generato da un BUY)
    
    # What
    agent_abbr:      str
    symbol:          str
    side:            str     # BUY / SELL
    quantity:        float
    order_type:      str     # MARKET / LIMIT / STOP / TRAILING_STOP
    limit_price:     float | None
    stop_price:      float | None
    trailing_pct:    float | None   # per TRAILING_STOP
    
    # Context
    horizon:         str
    confidence:      float
    signal_source:   str     # quale agente/modello ha generato il segnale
    regime:          str     # regime al momento dell'ordine
    
    # Memo (dal wizard OrderModal)
    thesis:          str
    market_context:  str
    risk_level:      str     # LOW / MEDIUM / HIGH
    tags:            list
    
    # Risk management (generati automaticamente se mancanti)
    stop_loss_price:   float | None
    take_profit_price: float | None
    risk_reward_ratio: float | None
    
    # Lifecycle
    status:          str     # PENDING / FILLED / PARTIAL / CANCELLED / REJECTED / EXPIRED
    created_at:      str
    submitted_at:    str | None
    filled_at:       str | None
    cancelled_at:    str | None
    expiry:          str | None   # TTL per ordini LIMIT
    
    # Execution
    fill_price:      float | None
    fill_quantity:   float | None
    slippage:        float | None
    fee:             float | None
    pnl_realized:    float | None
    pnl_unrealized:  float | None   # aggiornato dal tick loop
    
    # Rejection
    rejection_code:  str | None    # DUPLICATE / FLIP / CONFLICT / SIZE_CAP / MARGIN
    rejection_detail:str | None
    
    # Audit trail
    checks_passed:   list    # lista check pre-trade superati
    checks_failed:   list    # lista check falliti (con dettaglio)
    memo_score:      int     # 0-100 completezza memo
```

**Funzionalità order book:**
```python
def submit_order(order: Order) -> Order         # valida + esegue o rigetta
def cancel_order(order_id: str) -> Order        # cancella se PENDING
def get_order(order_id: str) -> Order
def list_orders(agent=None, symbol=None,        # filtri multipli
                status=None, from_dt=None, to_dt=None,
                tags=None, horizon=None) -> list
def get_open_orders() -> list                   # tutti i PENDING
def get_order_history(limit=100) -> list        # ultimi filled/cancelled
def get_stats(agent=None, period_days=30) -> dict  # statistiche aggregate

# Statistics per agente:
{
  "total_orders":     int,
  "fill_rate":        float,    # % ordini filled
  "cancel_rate":      float,
  "avg_slippage":     float,
  "avg_memo_score":   float,
  "win_rate":         float,    # % ordini filled con pnl > 0
  "avg_hold_time":    float,    # ore medie tra open e close
  "best_trade":       dict,
  "worst_trade":      dict,
  "pnl_by_tag":       dict,     # {tag: total_pnl}
  "pnl_by_horizon":   dict,
  "pnl_by_risk_level":dict,
  "signal_accuracy":  dict,     # per signal_source
}
```

**Auto-stop management:**
```python
def check_stops(current_prices: dict) -> list   # controlla tutti gli ordini aperti
                                                 # con stop_loss_price impostato
                                                 # genera automaticamente SELL se triggerato
```

**Persistenza:** salva tutto su Supabase tabella `orders` (crea migration).

#### 2B. Supabase migration per orders
```sql
create table if not exists orders (
  order_id          uuid primary key default gen_random_uuid(),
  parent_order_id   uuid,
  agent_abbr        text not null,
  symbol            text not null,
  side              text not null,
  quantity          numeric not null,
  order_type        text default 'MARKET',
  limit_price       numeric,
  stop_price        numeric,
  trailing_pct      numeric,
  horizon           text,
  confidence        numeric,
  signal_source     text,
  regime            text,
  thesis            text,
  market_context    text,
  risk_level        text default 'MEDIUM',
  tags              text[],
  stop_loss_price   numeric,
  take_profit_price numeric,
  risk_reward_ratio numeric,
  status            text default 'PENDING',
  created_at        timestamptz default now(),
  submitted_at      timestamptz,
  filled_at         timestamptz,
  cancelled_at      timestamptz,
  expiry            timestamptz,
  fill_price        numeric,
  fill_quantity     numeric,
  slippage          numeric,
  fee               numeric,
  pnl_realized      numeric,
  pnl_unrealized    numeric,
  rejection_code    text,
  rejection_detail  text,
  checks_passed     jsonb default '[]',
  checks_failed     jsonb default '[]',
  memo_score        int default 0
);
create index idx_orders_agent    on orders(agent_abbr);
create index idx_orders_symbol   on orders(symbol);
create index idx_orders_status   on orders(status);
create index idx_orders_created  on orders(created_at desc);
alter table orders enable row level security;
create policy "allow_all_orders" on orders for all using (true) with check (true);
```

#### 2C. OrderBookPage.jsx — NUOVA PAGINA
Crea `frontend/src/pages/OrderBookPage.jsx` con 4 tab:

**Tab 1: Ordini Aperti**
- Tabella real-time di tutti gli ordini PENDING
- Colonne: Time / Agent / Symbol / Side / Qty / Order Type / Limit/Stop price / Stop Loss / Take Profit / R:R / Memo score / Actions (Cancel)
- Highlight rosso se stop_loss non impostato
- Highlight giallo se memo_score < 50

**Tab 2: Storico**
- Tabella paginata di ordini FILLED/CANCELLED/REJECTED
- Filtri: agente / simbolo / date range / tag / risk level / status
- Colonne: Time / Agent / Symbol / Side / Fill Price / P&L $ / P&L % / Hold Time / Memo / Tags
- Export CSV button

**Tab 3: Analytics**
Visualizzazioni:
- P&L cumulativo nel tempo (line chart) per agente sovrapposto
- Win rate per signal_source (bar chart) — mostra quali agenti ML danno i segnali più accurati
- P&L per tag (horizontal bar) — momentum vs reversal vs macro etc.
- Distribution di memo_score (histogram) — incentiva memo di qualità
- Heatmap agent × risk_level con avg P&L
- Drawdown chart per agente

**Tab 4: Registro Memo**
- Feed di tutti gli ordini con memo completo
- Ricerca full-text su thesis
- Mostra: thesis / signal_source / market_context / tags / outcome (P&L)
- Tag cloud interattivo (click filtra la lista)

#### 2D. API endpoints per order book
```
GET  /api/orders                     ?agent=&symbol=&status=&from=&to=&tags=
GET  /api/orders/open
GET  /api/orders/stats               ?agent=&days=30
GET  /api/orders/{order_id}
POST /api/orders/{order_id}/cancel
GET  /api/orders/export/csv          ?agent=&from=&to=
```

---

### OBIETTIVO 3 — TRAINING CON GAMIFICATION E UPLOAD DOCUMENTI

#### 3A. Document Intelligence (`services/doc_intel.py`) — NUOVO FILE
Gli agenti possono apprendere da documenti caricati dall'utente:
- **PDF earnings report** → SEN agent: estrae sentiment, EPS surprise, guidance
- **CSV dati macro** (inflazione, tassi, PIL) → MAC agent: arricchisce feature macroeconomiche  
- **TXT/PDF ricerca** → tutti gli agenti: aggiunge bias direzionale contestuale
- **CSV OHLCV custom** → qualsiasi agente: training su dati proprietari

```python
# Tipi documento supportati
DOC_TYPES = {
    "earnings_report":  ["SEN", "MOM"],       # PDF earnings → sentiment features
    "macro_data":       ["MAC", "REG"],        # CSV tassi/inflazione/PIL → macro features
    "research_note":    ["SCOUT", "SEN"],      # PDF research → thesis context
    "custom_ohlcv":     "all",                 # CSV prezzi → training data
    "news_feed":        ["SEN", "MOM"],        # JSON/CSV news → sentiment
    "sec_filing":       ["SEN", "MAC"],        # 10-K/10-Q PDF → fundamental features
}
```

**Pipeline processing:**
1. Upload via `/api/data/upload-document` (multipart: file + type + target_agents)
2. Estrazione testo (PDF via `pypdf2`, CSV via pandas)
3. Se Ollama disponibile: parse con LLM → structured data
4. Se Ollama offline: regex + keyword extraction per campi chiave
5. Trasformazione in feature addizionali per il training
6. Salva in Supabase tabella `documents` + aggiunge ai `training_context`

```python
# Esempio output da earnings report:
{
  "symbol":         "AAPL",
  "doc_type":       "earnings_report",
  "period":         "Q4 2024",
  "eps_actual":     2.18,
  "eps_estimate":   2.10,
  "eps_surprise":   3.8,    # %
  "revenue_beat":   True,
  "guidance_tone":  0.6,    # -1 bearish → 1 bullish (LLM)
  "key_themes":     ["AI integration", "services growth", "China risk"],
  "sentiment_score":0.65,
  "agent_features": {        # da aggiungere come feature al training
    "eps_surprise":     3.8,
    "guidance_tone":    0.6,
    "fundamental_score":72.0
  }
}
```

#### 3B. Gamification system (`services/gamification.py`) — NUOVO FILE

**Punti per ogni agente (XP system):**
```python
XP_EVENTS = {
    # Training
    "model_trained":          50,
    "oos_above_60":          100,   # accuracy OOS > 60%
    "oos_above_70":          250,   # accuracy OOS > 70%
    "consistency_score_high": 150,  # tutti i fold CV > 55%
    "low_overfit":           100,   # overfit gap < 5%
    "doc_uploaded_and_used":  75,   # documento usato nel training
    
    # Trading
    "order_filled":           10,
    "profitable_trade":       25,
    "memo_score_80plus":      30,   # ordine con memo score >= 80
    "streak_3_wins":         100,   # 3 trade consecutivi profittevoli
    "streak_5_wins":         300,
    "new_symbol_traded":      20,   # primo trade su un simbolo mai usato
    "correct_regime_call":    50,   # segnale allineato al regime poi confermato
    
    # Backtest
    "backtest_sharpe_2plus":  200,
    "backtest_positive_alpha":100,
    "backtest_10_symbols":    150,  # backtest su 10+ simboli
    
    # Penalità
    "order_rejected_flip":   -20,
    "order_rejected_dedup":  -10,
    "overfit_flag":          -50,
    "low_memo_score":        -15,   # memo score < 30
}

# Livelli agente (basati su XP totale)
LEVELS = [
    (0,    "Novice",     "🥚"),
    (500,  "Learner",    "🐣"),
    (1500, "Trader",     "🐥"),
    (3000, "Analyst",    "📊"),
    (6000, "Strategist", "🎯"),
    (12000,"Expert",     "⭐"),
    (25000,"Master",     "💎"),
    (50000,"Legend",     "🏆"),
]
```

**Achievements (badges) sbloccabili:**
```python
ACHIEVEMENTS = {
    # Training achievements
    "first_model":     {"name":"First Steps",    "icon":"🎓", "desc":"Train your first model"},
    "accuracy_70":     {"name":"Sharp Eye",      "icon":"👁",  "desc":"Reach 70% OOS accuracy"},
    "doc_scholar":     {"name":"Doc Scholar",    "icon":"📚", "desc":"Train using 5 uploaded documents"},
    "multi_horizon":   {"name":"Time Traveler",  "icon":"⏰", "desc":"Train on all 4 horizons"},
    "full_universe":   {"name":"Universe Walker","icon":"🌌", "desc":"Train on 20+ symbols"},
    
    # Trading achievements
    "first_trade":     {"name":"First Blood",    "icon":"⚔️", "desc":"Execute your first trade"},
    "perfect_memo":    {"name":"Journalist",     "icon":"✍️", "desc":"Submit 10 orders with memo score 90+"},
    "risk_manager":    {"name":"Risk Manager",   "icon":"🛡",  "desc":"Always set stop loss for 20 orders"},
    "profit_streak":   {"name":"Hot Streak",     "icon":"🔥", "desc":"5 consecutive profitable trades"},
    "multi_agent":     {"name":"Conductor",      "icon":"🎼", "desc":"Execute trades with 5 different agents"},
    
    # Special
    "opt_rebalance":   {"name":"Portfolio Chef", "icon":"⚖️", "desc":"Execute an OPT rebalance"},
    "scout_discovery": {"name":"Gold Panner",    "icon":"⛏",  "desc":"SCOUT identifies a +5% opportunity"},
    "regime_master":   {"name":"Regime Surfer",  "icon":"🏄", "desc":"REG correctly calls 3 regime changes"},
    "doc_trader":      {"name":"Informed Edge",  "icon":"📰", "desc":"Trade immediately after doc upload"},
}
```

**Leaderboard:** classifica globale degli agenti per XP, win rate, Sharpe, P&L.

#### 3C. GamificationPage.jsx — NUOVA PAGINA
Crea `frontend/src/pages/GamificationPage.jsx` con layout tipo RPG dashboard:

**Layout principale:**
```
┌─────────────────────────────────────────────────────┐
│  🏆 AGENT LEADERBOARD          ┌──────────────────┐ │
│  [agenti ordinati per XP]      │ ACHIEVEMENTS     │ │
│  cada agente: avatar, level,   │ [badge grid]     │ │
│  XP bar, win rate, Sharpe      │                  │ │
│                                └──────────────────┘ │
├─────────────────────────────────────────────────────┤
│  📈 XP HISTORY                  🎯 NEXT MILESTONES  │
│  [line chart XP nel tempo]     [progress bars]      │
├─────────────────────────────────────────────────────┤
│  📚 TRAINING QUESTS             💼 TRADING QUESTS   │
│  [quest attive con progress]   [quest attive]       │
└─────────────────────────────────────────────────────┘
```

**Quests (sfide a tempo):**
```python
QUESTS = [
    {
        "id": "train_5_agents",
        "name": "Team Training Day",
        "desc": "Train 5 agents with OOS > 55% this week",
        "xp_reward": 500,
        "progress_fn": lambda: count_trained_above(55, days=7),
        "target": 5,
        "expires_in_days": 7,
    },
    {
        "id": "upload_earnings",
        "name": "Earnings Season",
        "desc": "Upload 3 earnings reports and train SEN agent",
        "xp_reward": 300,
        "requires": ["doc_upload × 3 (type=earnings)", "train SEN"],
    },
    {
        "id": "profitable_week",
        "name": "Green Week",
        "desc": "Achieve positive P&L across all agents this week",
        "xp_reward": 750,
    },
    {
        "id": "document_trader",
        "name": "Informed Trader",
        "desc": "Upload a macro document and execute 2 MAC agent trades",
        "xp_reward": 400,
    },
]
```

**Agent cards gamificate:**
Ogni agente ha una scheda con:
- Level badge animato (🥚→🏆)
- XP progress bar verso level successivo
- Streak counter (trade consecutivi verdi)
- Achievement badges sbloccati (mostrati come pin)
- Mini-history: ultimi 5 eventi XP con timestamp
- "Feed" degli achievement recenti tipo social

#### 3D. Document Upload UI — estendi DataTab in TrainingLabPage
La tab Data esistente deve diventare più potente:

```
┌─────────────────────────────────────────────────────┐
│  📂 DOCUMENT UPLOAD                                  │
│  Tipo: [Earnings Report ▼]  Target: [SEN MOM ▼]    │
│  [Drop zone PDF/CSV/TXT]                            │
│  Preview estratto: "EPS +3.8% beat, guidance UP"    │
│  Feature generate: {eps_surprise: 3.8, ...}         │
│  [Upload & Train SEN]  → +75 XP per Doc Scholar    │
├─────────────────────────────────────────────────────┤
│  📋 DOCUMENTI CARICATI (con badge tipo)             │
│  [lista con icon tipo, data, agenti coinvolti,      │
│   feature estratte, XP guadagnato]                  │
└─────────────────────────────────────────────────────┘
```

---

## API ENDPOINTS DA AGGIUNGERE

```
# Order Book
GET  /api/orders
GET  /api/orders/open
GET  /api/orders/stats
GET  /api/orders/{id}
POST /api/orders/{id}/cancel
GET  /api/orders/export/csv

# Documents
POST /api/data/upload-document     (multipart: file, type, target_agents, symbol)
GET  /api/data/documents
GET  /api/data/documents/{id}/features

# Gamification
GET  /api/gamification/leaderboard
GET  /api/gamification/agent/{abbr}/xp
GET  /api/gamification/achievements
GET  /api/gamification/quests
POST /api/gamification/award       (internal, chiamato da altri servizi)
```

---

## SUPABASE TABELLE DA AGGIUNGERE

```sql
-- orders (vedi sopra sezione 2B)

-- documents
create table if not exists documents (
  id             bigserial primary key,
  filename       text not null,
  doc_type       text not null,
  symbol         text,
  target_agents  text[],
  extracted_text text,
  features       jsonb,
  processed      boolean default false,
  xp_awarded     int default 0,
  uploaded_at    timestamptz default now()
);

-- gamification
create table if not exists agent_xp (
  id         bigserial primary key,
  agent_abbr text not null,
  event_type text not null,
  xp_delta   int  not null,
  reason     text,
  metadata   jsonb,
  ts         timestamptz default now()
);
create table if not exists achievements_unlocked (
  id           bigserial primary key,
  agent_abbr   text not null,
  achievement  text not null,
  unlocked_at  timestamptz default now()
);
```

---

## NUOVA NAVIGAZIONE (10 pagine)

```javascript
const NAV = [
  { id:'dashboard',  label:'Dashboard',  icon:'⬛' },
  { id:'agents',     label:'Agents',     icon:'🤖' },
  { id:'ecosystem',  label:'Ecosystem',  icon:'🧬' },
  { id:'network',    label:'Network',    icon:'🕸' },
  { id:'analytics',  label:'Analytics',  icon:'📈' },
  { id:'orders',     label:'Orders',     icon:'📋' },   // NUOVO — sostituisce Trades
  { id:'chat',       label:'AI Chat',    icon:'💬' },
  { id:'lab',        label:'Training Lab',icon:'🧪' },
  { id:'learning',   label:'Learning',   icon:'📚' },
  { id:'scout',      label:'SCOUT',      icon:'🔭' },
  { id:'gamification',label:'League',    icon:'🏆' }, // NUOVO
]
```

---

## DIPENDENZE DA AGGIUNGERE

```
# requirements.txt
pypdf2==3.0.1          # estrazione testo PDF
python-magic==0.4.27   # rilevamento tipo file
```

---

## PRIORITÀ DI IMPLEMENTAZIONE

1. **Prima:** `services/order_book.py` + migration SQL + `OrderBookPage.jsx` (self-contained)
2. **Seconda:** feature engineering avanzato in `market.py` + walk-forward migliorato in `trainer.py`
3. **Terza:** `services/doc_intel.py` + estensione DataTab
4. **Quarta:** `services/gamification.py` + `GamificationPage.jsx`
5. **Ultima:** ensemble migliorato (dipende dai nuovi metadati del trainer)

---

## NOTE FINALI

- Ogni nuovo file Python: testare con `python3 -c "import ast; ast.parse(open('file.py').read())"` prima del commit
- Ogni nuovo JSX: cercare `→` e `>` nei text node e sostituire con `&rarr;` / `{'>'}` 
- Ogni nuovo componente React: aggiungere `= []` default alle props array
- Ogni nuovo endpoint: aggiungere a `frontend/src/lib/api.js`
- Usare `USE_SYNTHETIC_DATA=true` su Render — yfinance bloccato
- Supabase RLS: sempre `for all using (true) with check (true)`
- Non toccare: `render.yaml` struttura single-service, `FilePath` alias in `agent_pdf.py`
