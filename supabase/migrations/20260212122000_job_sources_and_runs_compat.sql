-- Job sources + runs: align schema with ingest/admin code
-- Idempotent and safe on existing local DB.

-- job_sources extensions
alter table public.job_sources
  add column if not exists code text,
  add column if not exists url text,
  add column if not exists source_type text,
  add column if not exists ingest_method text,
  add column if not exists ingest_config jsonb,
  add column if not exists ingest_status text,
  add column if not exists is_active boolean,
  add column if not exists country text,
  add column if not exists region text;

-- backfill is_active from legacy "active" if present
update public.job_sources
set is_active = coalesce(is_active, active)
where is_active is null;

-- default is_active if still null
update public.job_sources
set is_active = false
where is_active is null;

-- backfill ingest_status from legacy "status" if present
update public.job_sources
set ingest_status = coalesce(ingest_status, status)
where ingest_status is null;

-- default ingest_status if still null
update public.job_sources
set ingest_status = 'draft'
where ingest_status is null;

create unique index if not exists job_sources_code_uq
  on public.job_sources (code)
  where code is not null;

create index if not exists job_sources_is_active_idx
  on public.job_sources (is_active);

-- job_source_runs extensions
alter table public.job_source_runs
  add column if not exists status text,
  add column if not exists fetched_count int,
  add column if not exists inserted_count int,
  add column if not exists updated_count int,
  add column if not exists error text;
