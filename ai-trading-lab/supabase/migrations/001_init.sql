-- ═══════════════════════════════════════════════════════════════════════════
-- AI Trading Agents Lab — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pg_stat_statements";

-- ── Agents ───────────────────────────────────────────────────────────────────
create table if not exists agents (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  abbr          text not null unique,
  strategy      text not null,
  agent_type    text not null,
  state         text not null default 'idle'
                  check (state in ('Live','Training','Backtest','Idle','Paused')),
  color         text default '#3b82f6',
  icon          text default '🤖',
  risk_level    text default 'Medium',
  assets        text[] default '{}',
  config        jsonb default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ── Agent Metrics (time-series snapshots) ────────────────────────────────────
create table if not exists agent_metrics (
  id              uuid primary key default uuid_generate_v4(),
  agent_id        uuid references agents(id) on delete cascade,
  ts              timestamptz default now(),
  equity          numeric(14,4) default 100.0,
  perf_pct        numeric(8,4) default 0.0,
  sharpe          numeric(6,4) default 0.0,
  sortino         numeric(6,4) default 0.0,
  max_drawdown    numeric(8,4) default 0.0,
  volatility      numeric(8,4) default 0.0,
  win_rate        numeric(6,4) default 0.0,
  profit_factor   numeric(8,4) default 1.0,
  accuracy        numeric(6,4) default 0.0,
  reward          numeric(12,4) default 0.0,
  trades_count    integer default 0,
  confidence      numeric(6,4) default 0.5,
  alpha           numeric(8,4) default 0.0,
  progress        numeric(6,4) default 0.0
);

create index idx_agent_metrics_agent_ts on agent_metrics(agent_id, ts desc);

-- ── Trades ───────────────────────────────────────────────────────────────────
create table if not exists trades (
  id              uuid primary key default uuid_generate_v4(),
  agent_id        uuid references agents(id) on delete cascade,
  ts              timestamptz default now(),
  symbol          text not null,
  side            text not null check (side in ('BUY','SELL','HOLD')),
  quantity        numeric(14,6) default 0,
  price           numeric(14,4) default 0,
  notional        numeric(14,4) default 0,
  fee             numeric(10,6) default 0,
  slippage        numeric(10,6) default 0,
  pnl             numeric(14,4) default 0,
  pnl_pct         numeric(8,4) default 0,
  status          text default 'filled' check (status in ('pending','filled','cancelled','rejected')),
  confidence      numeric(6,4) default 0.5,
  reason          text,
  metadata        jsonb default '{}'
);

create index idx_trades_agent_ts on trades(agent_id, ts desc);
create index idx_trades_symbol on trades(symbol);

-- ── Portfolio ─────────────────────────────────────────────────────────────────
create table if not exists portfolio (
  id              uuid primary key default uuid_generate_v4(),
  ts              timestamptz default now(),
  total_equity    numeric(14,4) default 100000,
  cash            numeric(14,4) default 100000,
  invested        numeric(14,4) default 0,
  total_return    numeric(8,4) default 0,
  daily_pnl       numeric(14,4) default 0,
  sharpe          numeric(6,4) default 0,
  sortino         numeric(6,4) default 0,
  max_drawdown    numeric(8,4) default 0,
  volatility      numeric(8,4) default 0,
  alpha           numeric(8,4) default 0,
  win_rate        numeric(6,4) default 0,
  profit_factor   numeric(8,4) default 1,
  exposure_pct    numeric(6,4) default 0,
  active_agents   integer default 0
);

create index idx_portfolio_ts on portfolio(ts desc);

-- ── Positions ────────────────────────────────────────────────────────────────
create table if not exists positions (
  id              uuid primary key default uuid_generate_v4(),
  agent_id        uuid references agents(id) on delete cascade,
  symbol          text not null,
  quantity        numeric(14,6) default 0,
  avg_cost        numeric(14,4) default 0,
  current_price   numeric(14,4) default 0,
  market_value    numeric(14,4) default 0,
  unrealized_pnl  numeric(14,4) default 0,
  unrealized_pct  numeric(8,4) default 0,
  opened_at       timestamptz default now(),
  updated_at      timestamptz default now(),
  unique(agent_id, symbol)
);

-- ── Price Feed (tick data) ────────────────────────────────────────────────────
create table if not exists price_ticks (
  id      bigserial primary key,
  ts      timestamptz default now(),
  symbol  text not null,
  open    numeric(14,4),
  high    numeric(14,4),
  low     numeric(14,4),
  close   numeric(14,4),
  volume  bigint default 0,
  source  text default 'simulation'
);

create index idx_price_ticks_symbol_ts on price_ticks(symbol, ts desc);

-- ── Agent Signals ─────────────────────────────────────────────────────────────
create table if not exists signals (
  id          uuid primary key default uuid_generate_v4(),
  agent_id    uuid references agents(id) on delete cascade,
  ts          timestamptz default now(),
  symbol      text not null,
  action      text not null check (action in ('BUY','SELL','HOLD','REDUCE','INCREASE')),
  confidence  numeric(6,4) default 0.5,
  price       numeric(14,4),
  reason      text,
  executed    boolean default false
);

create index idx_signals_agent_ts on signals(agent_id, ts desc);

-- ── RL Episodes ──────────────────────────────────────────────────────────────
create table if not exists rl_episodes (
  id              uuid primary key default uuid_generate_v4(),
  agent_id        uuid references agents(id) on delete cascade,
  episode         integer not null,
  ts              timestamptz default now(),
  total_reward    numeric(12,4) default 0,
  avg_reward      numeric(10,6) default 0,
  loss            numeric(12,8) default 0,
  epsilon         numeric(6,4) default 1.0,
  policy_updates  integer default 0,
  steps           integer default 0
);

create index idx_rl_episodes_agent on rl_episodes(agent_id, episode);

-- ── Watchlist ────────────────────────────────────────────────────────────────
create table if not exists watchlist (
  id        uuid primary key default uuid_generate_v4(),
  symbol    text not null unique,
  name      text,
  asset_class text default 'equity',
  added_at  timestamptz default now()
);

-- ── Seed initial watchlist ───────────────────────────────────────────────────
insert into watchlist (symbol, name, asset_class) values
  ('SPY',  'SPDR S&P 500 ETF',        'etf'),
  ('QQQ',  'Invesco QQQ Trust',        'etf'),
  ('AAPL', 'Apple Inc.',               'equity'),
  ('MSFT', 'Microsoft Corp.',          'equity'),
  ('NVDA', 'NVIDIA Corp.',             'equity'),
  ('TSLA', 'Tesla Inc.',               'equity'),
  ('META', 'Meta Platforms Inc.',      'equity'),
  ('AMZN', 'Amazon.com Inc.',          'equity'),
  ('GLD',  'SPDR Gold Trust',          'etf'),
  ('TLT',  'iShares 20Y Treasury ETF', 'etf'),
  ('BTC-USD', 'Bitcoin USD',           'crypto'),
  ('ETH-USD', 'Ethereum USD',          'crypto')
on conflict do nothing;

-- ── Seed initial agents ──────────────────────────────────────────────────────
insert into agents (name, abbr, strategy, agent_type, state, color, icon, risk_level, assets) values
  ('Momentum Agent',     'MOM', 'Trend Following',          'Rule-Based + ML',    'Live',     '#06b6d4', '↑',  'Medium',    ARRAY['SPY','QQQ','AAPL','MSFT']),
  ('Mean Reversion',     'MRV', 'Contrarian',               'Statistical Arb',    'Live',     '#8b5cf6', '⇄',  'Low',       ARRAY['GLD','TLT','SHY']),
  ('RL PPO Agent',       'PPO', 'Reinforcement Learning',   'Policy Gradient',    'Training', '#3b82f6', '🧠', 'High',      ARRAY['BTC-USD','ETH-USD']),
  ('DQN Agent',          'DQN', 'Deep Q-Learning',          'Value-Based RL',     'Backtest', '#ec4899', '⚡', 'High',      ARRAY['NVDA','AMD']),
  ('Macro Agent',        'MAC', 'Macro / Top-Down',         'Factor Model',       'Live',     '#f59e0b', '🌐', 'Medium',    ARRAY['GLD','TLT']),
  ('Sentiment Agent',    'SEN', 'NLP / News Sentiment',     'LLM-Powered',        'Live',     '#f97316', '📰', 'Medium',    ARRAY['TSLA','META','AMZN']),
  ('Volatility Agent',   'VOL', 'Vol Trading / VIX',        'Options Simulation', 'Live',     '#ef4444', '📊', 'Very High', ARRAY['SPY','QQQ']),
  ('Market Regime',      'REG', 'Regime Detection',         'HMM + Clustering',   'Training', '#14b8a6', '🔍', 'Low',       ARRAY['SPY','TLT']),
  ('Portfolio Optimizer','OPT', 'Dynamic Allocation',       'MVO + RL',           'Live',     '#10b981', '⚖️', 'Low',       ARRAY['SPY','BND','GLD'])
on conflict (abbr) do nothing;

-- ── RLS Policies (public read for demo) ──────────────────────────────────────
alter table agents         enable row level security;
alter table agent_metrics  enable row level security;
alter table trades         enable row level security;
alter table portfolio      enable row level security;
alter table positions      enable row level security;
alter table price_ticks    enable row level security;
alter table signals        enable row level security;
alter table rl_episodes    enable row level security;
alter table watchlist      enable row level security;

-- Allow public read (demo mode — tighten for production)
create policy "Public read agents"        on agents         for select using (true);
create policy "Public read metrics"       on agent_metrics  for select using (true);
create policy "Public read trades"        on trades         for select using (true);
create policy "Public read portfolio"     on portfolio      for select using (true);
create policy "Public read positions"     on positions      for select using (true);
create policy "Public read ticks"         on price_ticks    for select using (true);
create policy "Public read signals"       on signals        for select using (true);
create policy "Public read episodes"      on rl_episodes    for select using (true);
create policy "Public read watchlist"     on watchlist      for select using (true);

-- Service role can write everything (backend uses service role key)
create policy "Service write agents"      on agents         for all using (auth.role() = 'service_role');
create policy "Service write metrics"     on agent_metrics  for all using (auth.role() = 'service_role');
create policy "Service write trades"      on trades         for all using (auth.role() = 'service_role');
create policy "Service write portfolio"   on portfolio      for all using (auth.role() = 'service_role');
create policy "Service write positions"   on positions      for all using (auth.role() = 'service_role');
create policy "Service write ticks"       on price_ticks    for all using (auth.role() = 'service_role');
create policy "Service write signals"     on signals        for all using (auth.role() = 'service_role');
create policy "Service write episodes"    on rl_episodes    for all using (auth.role() = 'service_role');
create policy "Service write watchlist"   on watchlist      for all using (auth.role() = 'service_role');

-- ── Realtime publication ──────────────────────────────────────────────────────
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime for table
    trades, signals, agent_metrics, portfolio, price_ticks, positions;
commit;
