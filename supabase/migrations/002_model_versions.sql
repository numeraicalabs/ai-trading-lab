-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 002: Model Versions + Training History
-- Run AFTER 001_init.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Model Versions ────────────────────────────────────────────────────────────
create table if not exists model_versions (
  id                  uuid primary key default uuid_generate_v4(),
  agent_abbr          text not null,
  symbol              text not null,
  horizon             text not null check (horizon in ('scalping','day','swing','position')),
  version             integer not null default 1,
  accuracy            numeric(8,6) default 0,
  samples             integer default 0,
  feature_cols        text[] default '{}',
  feature_importance  jsonb  default '{}',
  storage_path        text,                 -- path inside Supabase Storage bucket
  is_active           boolean default true,
  trained_at          timestamptz default now(),
  created_at          timestamptz default now(),
  unique(agent_abbr, symbol, horizon, version)
);

create index idx_mv_agent       on model_versions(agent_abbr);
create index idx_mv_agent_sym_h on model_versions(agent_abbr, symbol, horizon);

-- ── Training Jobs (history) ───────────────────────────────────────────────────
create table if not exists training_jobs (
  id            uuid primary key default uuid_generate_v4(),
  job_id        text not null unique,
  agent_abbr    text not null,
  symbol        text not null,
  horizon       text not null,
  status        text not null default 'queued'
                  check (status in ('queued','running','completed','failed','cancelled')),
  progress      integer default 0,
  stage         text default 'queued',
  force_retrain boolean default false,
  result        jsonb  default '{}',
  error         text   default '',
  created_at    timestamptz default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

create index idx_tj_agent  on training_jobs(agent_abbr);
create index idx_tj_status on training_jobs(status);

-- ── Auto-Improvement Log ──────────────────────────────────────────────────────
create table if not exists improvement_log (
  id          uuid primary key default uuid_generate_v4(),
  agent_abbr  text not null,
  symbol      text not null,
  horizon     text not null,
  from_version integer,
  to_version   integer,
  from_acc    numeric(8,6),
  to_acc      numeric(8,6),
  improvement numeric(8,6),   -- to_acc - from_acc
  improved    boolean,
  trained_at  timestamptz default now()
);

create index idx_il_agent on improvement_log(agent_abbr, trained_at desc);

-- ── Supabase Storage bucket (run this manually or via dashboard) ──────────────
-- Dashboard → Storage → New Bucket → Name: "model-storage" → Public: false
-- Or via CLI: supabase storage create model-storage

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table model_versions  enable row level security;
alter table training_jobs   enable row level security;
alter table improvement_log enable row level security;

create policy "Public read model_versions"  on model_versions  for select using (true);
create policy "Public read training_jobs"   on training_jobs   for select using (true);
create policy "Public read improvement_log" on improvement_log for select using (true);

create policy "Service write model_versions"  on model_versions  for all using (auth.role() = 'service_role');
create policy "Service write training_jobs"   on training_jobs   for all using (auth.role() = 'service_role');
create policy "Service write improvement_log" on improvement_log for all using (auth.role() = 'service_role');

-- ── Realtime ─────────────────────────────────────────────────────────────────
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime for table
    trades, signals, agent_metrics, portfolio, price_ticks, positions,
    training_jobs, model_versions, improvement_log;
commit;
