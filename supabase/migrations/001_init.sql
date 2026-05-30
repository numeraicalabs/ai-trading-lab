-- ============================================================
-- AI Trading Lab — Database Setup
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste & run
-- Do NOT use Supabase CLI (supabase db push) for this file.
-- ============================================================

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists trades (
  id            uuid primary key default gen_random_uuid(),
  agent_abbr    text        not null,
  symbol        text        not null,
  side          text        not null,
  quantity      numeric     not null default 1,
  price         numeric     not null default 0,
  notional      numeric,
  fee           numeric,
  slippage      numeric,
  pnl           numeric,
  horizon       text,
  order_type    text        default 'MARKET',
  confidence    numeric,
  reason        text,
  source        text        default 'auto',
  status        text        default 'filled',
  created_at    timestamptz default now()
);

create table if not exists training_jobs (
  id            text        primary key,
  agent_abbr    text        not null,
  symbol        text        not null,
  horizon       text        not null,
  force         boolean     default false,
  status        text        default 'queued',
  progress      int         default 0,
  stage         text,
  result        jsonb,
  error         text,
  created_at    timestamptz default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

create table if not exists model_versions (
  id                bigserial   primary key,
  agent_abbr        text        not null,
  symbol            text        not null,
  horizon           text        not null,
  version           int         default 1,
  accuracy          numeric,
  samples           int,
  feature_cols      text[],
  feature_importance jsonb,
  model_path        text,
  is_active         boolean     default true,
  trained_at        timestamptz default now(),
  created_at        timestamptz default now()
);

create table if not exists agent_snapshots (
  id          bigserial   primary key,
  agent_abbr  text        not null,
  equity      numeric,
  perf        numeric,
  sharpe      numeric,
  max_dd      numeric,
  reward      numeric,
  accuracy    numeric,
  win_rate    numeric,
  state       text,
  snapshot_at timestamptz default now()
);

create table if not exists portfolio_snapshots (
  id           bigserial   primary key,
  equity       numeric,
  cash         numeric,
  invested     numeric,
  total_return numeric,
  daily_pnl    numeric,
  sharpe       numeric,
  sortino      numeric,
  max_drawdown numeric,
  snapshot_at  timestamptz default now()
);

create table if not exists scout_screens (
  id         bigserial   primary key,
  regime     text,
  horizon    text,
  screened   int,
  top_long   text,
  top_short  text,
  results    jsonb,
  created_at timestamptz default now()
);

create table if not exists chat_messages (
  id         bigserial   primary key,
  role       text        not null,
  content    text        not null,
  page       text,
  model      text,
  created_at timestamptz default now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

create index if not exists idx_trades_agent    on trades(agent_abbr);
create index if not exists idx_trades_symbol   on trades(symbol);
create index if not exists idx_trades_created  on trades(created_at desc);
create index if not exists idx_jobs_agent      on training_jobs(agent_abbr);
create index if not exists idx_jobs_status     on training_jobs(status);
create index if not exists idx_jobs_created    on training_jobs(created_at desc);
create index if not exists idx_models_agent    on model_versions(agent_abbr);
create index if not exists idx_snap_agent      on agent_snapshots(agent_abbr);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Allow all operations from the service_role key (used by the backend).
-- The backend uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS automatically,
-- but we add policies for completeness and for anon/authenticated access too.

alter table trades              enable row level security;
alter table training_jobs       enable row level security;
alter table model_versions      enable row level security;
alter table agent_snapshots     enable row level security;
alter table portfolio_snapshots enable row level security;
alter table scout_screens       enable row level security;
alter table chat_messages       enable row level security;

-- Drop old policies if they exist (idempotent re-run)
do $$ begin
  drop policy if exists "allow_all_trades"    on trades;
  drop policy if exists "allow_all_jobs"      on training_jobs;
  drop policy if exists "allow_all_models"    on model_versions;
  drop policy if exists "allow_all_snapshots" on agent_snapshots;
  drop policy if exists "allow_all_portfolio" on portfolio_snapshots;
  drop policy if exists "allow_all_scout"     on scout_screens;
  drop policy if exists "allow_all_chat"      on chat_messages;
  -- Drop old duplicate-named policies from previous migrations
  drop policy if exists "service_role_all"    on trades;
  drop policy if exists "service_role_all"    on training_jobs;
  drop policy if exists "service_role_all"    on model_versions;
  drop policy if exists "service_role_all"    on agent_snapshots;
  drop policy if exists "service_role_all"    on portfolio_snapshots;
  drop policy if exists "service_role_all"    on scout_screens;
  drop policy if exists "service_role_all"    on chat_messages;
exception when others then null;
end $$;

-- Create fresh policies — both USING and WITH CHECK for full read+write
create policy "allow_all_trades"    on trades              for all using (true) with check (true);
create policy "allow_all_jobs"      on training_jobs       for all using (true) with check (true);
create policy "allow_all_models"    on model_versions      for all using (true) with check (true);
create policy "allow_all_snapshots" on agent_snapshots     for all using (true) with check (true);
create policy "allow_all_portfolio" on portfolio_snapshots for all using (true) with check (true);
create policy "allow_all_scout"     on scout_screens       for all using (true) with check (true);
create policy "allow_all_chat"      on chat_messages       for all using (true) with check (true);

-- Confirm
select 'Setup complete — ' || count(*)::text || ' tables created' as result
from information_schema.tables
where table_schema = 'public'
  and table_name in ('trades','training_jobs','model_versions',
                     'agent_snapshots','portfolio_snapshots','scout_screens','chat_messages');
