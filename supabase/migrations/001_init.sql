-- AI Trading Lab — Initial schema v2
-- Run in: Supabase → SQL Editor

-- ── Trades ────────────────────────────────────────────────────────────────────
create table if not exists trades (
  id            uuid primary key default gen_random_uuid(),
  agent_abbr    text not null,
  symbol        text not null,
  side          text not null check (side in ('BUY','SELL','HOLD')),
  quantity      numeric(18,6) not null default 1,
  price         numeric(18,6) not null default 0,
  notional      numeric(18,2),
  fee           numeric(18,6),
  slippage      numeric(18,6),
  pnl           numeric(18,4),
  horizon       text,
  order_type    text default 'MARKET',
  confidence    numeric(5,3),
  reason        text,
  source        text default 'auto',
  status        text default 'filled',
  created_at    timestamptz default now()
);
create index if not exists trades_agent_idx   on trades(agent_abbr);
create index if not exists trades_symbol_idx  on trades(symbol);
create index if not exists trades_created_idx on trades(created_at desc);

-- ── Agent performance snapshots ───────────────────────────────────────────────
create table if not exists agent_snapshots (
  id          bigserial primary key,
  agent_abbr  text not null,
  equity      numeric(18,4),
  perf        numeric(10,4),
  sharpe      numeric(8,4),
  max_dd      numeric(8,4),
  reward      numeric(12,2),
  accuracy    numeric(6,3),
  win_rate    numeric(6,3),
  state       text,
  snapshot_at timestamptz default now()
);
create index if not exists snap_agent_idx on agent_snapshots(agent_abbr);
create index if not exists snap_at_idx    on agent_snapshots(snapshot_at desc);

-- ── Portfolio daily snapshots ─────────────────────────────────────────────────
create table if not exists portfolio_snapshots (
  id           bigserial primary key,
  equity       numeric(18,2),
  cash         numeric(18,2),
  invested     numeric(18,2),
  total_return numeric(10,4),
  daily_pnl    numeric(18,2),
  sharpe       numeric(8,4),
  sortino      numeric(8,4),
  max_drawdown numeric(8,4),
  snapshot_at  timestamptz default now()
);

-- ── Price cache ────────────────────────────────────────────────────────────────
create table if not exists price_cache (
  symbol      text primary key,
  price       numeric(18,6),
  change_pct  numeric(8,4),
  prev_close  numeric(18,6),
  updated_at  timestamptz default now()
);

-- ── Chat history ──────────────────────────────────────────────────────────────
create table if not exists chat_messages (
  id         bigserial primary key,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  page       text,
  model      text,
  created_at timestamptz default now()
);

-- ── Training jobs ─────────────────────────────────────────────────────────────
create table if not exists training_jobs (
  id           text primary key,
  agent_abbr   text not null,
  symbol       text not null,
  horizon      text not null,
  force        boolean default false,
  status       text default 'queued',
  progress     int  default 0,
  stage        text,
  result       jsonb,
  error        text,
  created_at   timestamptz default now(),
  started_at   timestamptz,
  completed_at timestamptz
);
create index if not exists tj_agent_idx   on training_jobs(agent_abbr);
create index if not exists tj_status_idx  on training_jobs(status);
create index if not exists tj_created_idx on training_jobs(created_at desc);

-- ── Scout screen results ──────────────────────────────────────────────────────
create table if not exists scout_screens (
  id         bigserial primary key,
  regime     text,
  horizon    text,
  screened   int,
  top_long   text,
  top_short  text,
  results    jsonb,
  created_at timestamptz default now()
);

-- ── Enable Row Level Security ─────────────────────────────────────────────────
alter table trades              enable row level security;
alter table agent_snapshots     enable row level security;
alter table portfolio_snapshots enable row level security;
alter table chat_messages       enable row level security;
alter table training_jobs       enable row level security;
alter table scout_screens       enable row level security;

-- ── Policies: service role full access (SELECT + INSERT + UPDATE + DELETE) ────
-- Note: WITH CHECK (true) required for INSERT/UPDATE
create policy "allow_all_trades"
  on trades for all to authenticated, anon
  using (true) with check (true);

create policy "allow_all_snapshots"
  on agent_snapshots for all to authenticated, anon
  using (true) with check (true);

create policy "allow_all_portfolio"
  on portfolio_snapshots for all to authenticated, anon
  using (true) with check (true);

create policy "allow_all_chat"
  on chat_messages for all to authenticated, anon
  using (true) with check (true);

create policy "allow_all_jobs"
  on training_jobs for all to authenticated, anon
  using (true) with check (true);

create policy "allow_all_scout"
  on scout_screens for all to authenticated, anon
  using (true) with check (true);
