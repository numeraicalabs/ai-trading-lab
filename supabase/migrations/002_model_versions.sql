-- ============================================================
-- AI Trading Lab — Model version registry (run AFTER 001)
-- HOW TO RUN: Supabase Dashboard → SQL Editor → paste & run
-- ============================================================

-- Model versions table is already created in 001_init.sql.
-- This file adds a unique index to prevent duplicate active models.

create unique index if not exists idx_models_active_unique
  on model_versions(agent_abbr, symbol, horizon)
  where is_active = true;

-- Storage bucket for .pkl model files (run this too)
-- insert into storage.buckets (id, name, public)
-- values ('model-storage', 'model-storage', true)
-- on conflict (id) do nothing;

select 'Migration 002 complete' as result;
