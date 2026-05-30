-- Model version registry
-- Run AFTER 001_init.sql

create table if not exists model_versions (
  id              bigserial primary key,
  agent_abbr      text not null,
  symbol          text not null,
  horizon         text not null,
  version         int  not null default 1,
  accuracy        numeric(6,4),
  samples         int,
  feature_cols    text[],
  feature_importance jsonb,
  model_path      text,
  storage_key     text,
  is_active       boolean default true,
  trained_at      timestamptz default now(),
  created_at      timestamptz default now()
);

create unique index if not exists mv_active_idx
  on model_versions(agent_abbr, symbol, horizon)
  where is_active = true;

create index if not exists mv_agent_idx  on model_versions(agent_abbr);
create index if not exists mv_trained_idx on model_versions(trained_at desc);

-- Training job log
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

-- RLS
alter table model_versions  enable row level security;
alter table training_jobs   enable row level security;
create policy "service_role_all" on model_versions for all using (true);
create policy "service_role_all" on training_jobs  for all using (true);

-- Supabase Storage bucket for model .pkl files
-- Create manually: Storage → New bucket → "model-storage" → Public
-- insert into storage.buckets (id, name, public) values ('model-storage', 'model-storage', true);
