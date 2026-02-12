-- Adds source health logging + automatic disable rules (low volume / unstable)
-- Idempotent: works even if some tables/columns already exist.

-- 1) Extend public.job_sources with health + admin workflow fields
alter table public.job_sources
  add column if not exists code text,
  add column if not exists url text,
  add column if not exists source_type text,              -- rss | api | custom | unknown
  add column if not exists status text,                  -- draft | ready_to_verify | active | needs_connector | disabled_auto | disabled_manual
  add column if not exists active boolean not null default false,
  add column if not exists activated_at timestamptz,
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_ingested_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists consecutive_failures int not null default 0,
  add column if not exists auto_disable_enabled boolean not null default true,
  add column if not exists auto_disabled boolean not null default false,
  add column if not exists disabled_reason text,          -- low_volume | unstable | manual
  add column if not exists disabled_note text,
  add column if not exists disabled_at timestamptz,
  -- thresholds (defaults are MVP-friendly)
  add column if not exists min_offers_7d int not null default 20,
  add column if not exists volume_window_days int not null default 7,
  add column if not exists grace_days int not null default 2,
  add column if not exists max_consecutive_failures int not null default 3,
  add column if not exists fail_rate_window int not null default 10,
  add column if not exists max_fail_rate_10 numeric not null default 0.5;

create unique index if not exists job_sources_code_uq
  on public.job_sources (code)
  where code is not null;

create index if not exists job_sources_active_idx
  on public.job_sources (active);

-- 2) Ensure logs table exists (even if created previously with fewer columns)
create table if not exists public.job_source_runs (
  id bigserial primary key,
  job_source_id uuid not null references public.job_sources(id) on delete cascade
);

-- Add missing columns if the table already existed
alter table public.job_source_runs
  add column if not exists run_kind text,          -- check | ingest
  add column if not exists trigger text,           -- manual | cron
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists ok boolean,
  add column if not exists http_status int,
  add column if not exists items_fetched int,
  add column if not exists jobs_seen int,
  add column if not exists jobs_upserted int,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists duration_ms int,
  add column if not exists meta jsonb,
  add column if not exists created_at timestamptz;

-- Set defaults (safe even if columns existed)
alter table public.job_source_runs
  alter column started_at set default now(),
  alter column created_at set default now();

-- Backfill for older rows so queries/functions don't break
update public.job_source_runs
set created_at = coalesce(created_at, started_at, now())
where created_at is null;

update public.job_source_runs
set started_at = coalesce(started_at, created_at)
where started_at is null;

update public.job_source_runs
set run_kind = coalesce(run_kind, 'ingest')
where run_kind is null;

update public.job_source_runs
set trigger = coalesce(trigger, 'cron')
where trigger is null;

create index if not exists job_source_runs_source_time_idx
  on public.job_source_runs (job_source_id, started_at desc);

create index if not exists job_source_runs_kind_idx
  on public.job_source_runs (run_kind);

create index if not exists job_source_runs_ok_idx
  on public.job_source_runs (ok);

-- Lock down logs by default (no client access unless policies are added later)
alter table public.job_source_runs enable row level security;

-- 3) Function to auto-disable bad sources (called by cron or after ingests)
create or replace function public.auto_disable_job_sources()
returns integer
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_disabled int := 0;
begin
  with
  runs_agg as (
    select
      js.id as job_source_id,
      count(*) as run_count,
      count(*) filter (where r.ok is false) as fail_count,
      case
        when count(*) = 0 then 0
        else (count(*) filter (where r.ok is false))::numeric / count(*)::numeric
      end as fail_rate
    from public.job_sources js
    left join lateral (
      select ok
      from public.job_source_runs r
      where r.job_source_id = js.id
        and r.run_kind = 'ingest'
      order by r.started_at desc
      limit coalesce(js.fail_rate_window, 10)
    ) r on true
    group by js.id
  ),

  consec as (
    select
      t.job_source_id,
      count(*) as consecutive_failures
    from (
      select
        r.job_source_id,
        r.ok,
        sum(case when r.ok is true then 1 else 0 end)
          over (partition by r.job_source_id order by r.started_at desc
                rows between unbounded preceding and current row) as ok_seen
      from public.job_source_runs r
      where r.run_kind = 'ingest'
    ) t
    where t.ok is false and t.ok_seen = 0
    group by t.job_source_id
  ),

  offers as (
    select
      js.id as job_source_id,
      count(j.*) as offers_window
    from public.job_sources js
    left join public.jobs j
      on j.job_source_id = js.id
     and j.last_seen_at >= v_now - (coalesce(js.volume_window_days, 7) || ' days')::interval
    group by js.id
  ),

  candidates as (
    select
      js.id,
      js.active,
      js.activated_at,
      js.auto_disable_enabled,

      coalesce(o.offers_window, 0) as offers_window,
      coalesce(js.min_offers_7d, 20) as min_offers_7d,
      coalesce(js.grace_days, 2) as grace_days,

      coalesce(c.consecutive_failures, 0) as consecutive_failures,
      coalesce(js.max_consecutive_failures, 3) as max_consecutive_failures,

      coalesce(ra.run_count, 0) as run_count,
      coalesce(ra.fail_rate, 0) as fail_rate,
      coalesce(js.max_fail_rate_10, 0.5) as max_fail_rate_10
    from public.job_sources js
    left join offers o on o.job_source_id = js.id
    left join consec c on c.job_source_id = js.id
    left join runs_agg ra on ra.job_source_id = js.id
  ),

  to_disable as (
    select *
    from candidates
    where active is true
      and auto_disable_enabled is true
      and (activated_at is null or activated_at < v_now - (grace_days || ' days')::interval)
      and (
        (run_count > 0 and offers_window < min_offers_7d)
        or (consecutive_failures >= max_consecutive_failures)
        or (run_count >= 4 and fail_rate > max_fail_rate_10)
      )
  ),

  upd as (
    update public.job_sources js
      set active = false,
          auto_disabled = true,
          disabled_at = v_now,
          disabled_reason = case
            when td.consecutive_failures >= td.max_consecutive_failures
              or (td.run_count >= 4 and td.fail_rate > td.max_fail_rate_10)
              then 'unstable'
            else 'low_volume'
          end,
          disabled_note =
            'offers_window=' || td.offers_window ||
            '; runs=' || td.run_count ||
            '; fail_rate=' || round(td.fail_rate * 100, 1) || '%' ||
            '; consecutive_failures=' || td.consecutive_failures,
          status = coalesce(js.status, 'active')
    from to_disable td
    where js.id = td.id
    returning 1
  )
  select count(*) into v_disabled from upd;

  return v_disabled;
end;
$$;
