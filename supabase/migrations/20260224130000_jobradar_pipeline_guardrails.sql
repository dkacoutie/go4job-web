-- JobRadar pipeline guardrails, monitoring, and safer auto-disable

-- 1) Ensure job_source_runs exists + columns used by cron logic
create table if not exists public.job_source_runs (
  id bigserial primary key,
  job_source_id uuid not null references public.job_sources(id) on delete cascade,
  run_kind text not null default 'ingest',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  ok boolean,
  fetched_count int,
  inserted_count int,
  updated_count int,
  error text
);

alter table public.job_source_runs
  add column if not exists run_kind text default 'ingest',
  add column if not exists ok boolean;

create index if not exists job_source_runs_source_started_idx
  on public.job_source_runs (job_source_id, started_at desc);

create index if not exists job_source_runs_kind_started_idx
  on public.job_source_runs (run_kind, started_at desc);

-- 2) Job source control fields (safe defaults)
alter table public.job_sources
  add column if not exists source_tier text default 'standard',
  add column if not exists auto_disable_enabled boolean default true,
  add column if not exists auto_disabled boolean default false,
  add column if not exists activated_at timestamptz,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_reason text,
  add column if not exists disabled_note text,
  add column if not exists min_offers_7d int,
  add column if not exists volume_window_days int,
  add column if not exists grace_days int,
  add column if not exists max_consecutive_failures int,
  add column if not exists max_fail_rate_10 numeric,
  add column if not exists fail_rate_window int,
  add column if not exists active boolean;

update public.job_sources
set
  auto_disable_enabled = coalesce(auto_disable_enabled, true),
  min_offers_7d = coalesce(min_offers_7d, 10),
  volume_window_days = coalesce(volume_window_days, 7),
  grace_days = coalesce(grace_days, 2),
  max_consecutive_failures = coalesce(max_consecutive_failures, 3),
  max_fail_rate_10 = coalesce(max_fail_rate_10, 0.5),
  fail_rate_window = coalesce(fail_rate_window, 10)
where true;

-- 3) Define pillar sources (minimal reliable set)
update public.job_sources
set
  source_tier = 'pillar',
  auto_disable_enabled = true,
  min_offers_7d = coalesce(min_offers_7d, 5),
  grace_days = coalesce(grace_days, 7),
  max_consecutive_failures = coalesce(max_consecutive_failures, 5),
  max_fail_rate_10 = coalesce(max_fail_rate_10, 0.8)
where
  code in (
    'remotive','weworkremotely','himalayas','aej_ci','agl_rss','bourbon_rss',
    'reliefweb_jobs','rss_unjobs_africa','rss_agl_westafrica'
  )
  or name ilike any (array[
    '%Remotive%','%We Work Remotely%','%Himalayas%','%Agence Emploi Jeunes%',
    '%AGL%','%Bourbon%','%ReliefWeb%','%UNjobs%'
  ]);

update public.job_sources
set ingest_status = 'ready'
where source_tier = 'pillar' and ingest_status = 'disabled';

-- 4) Reactivate minimal pillar sources if needed
create or replace function public.jobradar_reactivate_min_sources()
returns integer
language plpgsql
as $$
declare
  v_count int := 0;
begin
  with candidates as (
    select id
    from public.job_sources
    where
      is_active is false
      and ingest_status = 'ready'
      and (ingest_method in ('rss_generic','rss','api','aej_html') or ingest_method is null)
      and (source_tier = 'pillar' or coalesce(priority, 0) >= 60)
      and (disabled_reason is null or disabled_reason = 'low_volume' or auto_disabled is false)
  ),
  upd as (
    update public.job_sources js
      set is_active = true,
          active = true,
          auto_disabled = false,
          disabled_at = null,
          disabled_reason = null,
          disabled_note = null,
          activated_at = now()
    from candidates c
    where js.id = c.id
    returning 1
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$$;

-- 5) Safer auto-disable (pillar aware + gentler on low volume)
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
      r.job_source_id,
      count(*) as run_count,
      count(*) filter (where coalesce(r.ok, r.status = 'success')) as ok_count,
      count(*) filter (where coalesce(r.ok, r.status = 'failed')) as fail_count,
      case
        when count(*) = 0 then 0
        else (count(*) filter (where coalesce(r.ok, r.status = 'failed')))::numeric / count(*)::numeric
      end as fail_rate
    from public.job_source_runs r
    where r.run_kind = 'ingest'
    group by r.job_source_id
  ),

  consec as (
    select
      t.job_source_id,
      count(*) as consecutive_failures
    from (
      select
        r.job_source_id,
        coalesce(r.ok, r.status = 'success') as ok,
        sum(case when coalesce(r.ok, r.status = 'success') then 1 else 0 end)
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
      js.is_active,
      js.activated_at,
      js.auto_disable_enabled,
      js.source_tier,
      js.ingest_method,
      js.priority,

      coalesce(o.offers_window, 0) as offers_window,
      coalesce(js.min_offers_7d, 20) as min_offers_7d,
      coalesce(js.grace_days, 2) as grace_days,

      coalesce(c.consecutive_failures, 0) as consecutive_failures,
      coalesce(js.max_consecutive_failures, 3) as max_consecutive_failures,

      coalesce(ra.run_count, 0) as run_count,
      coalesce(ra.fail_rate, 0) as fail_rate,
      coalesce(js.max_fail_rate_10, 0.5) as max_fail_rate_10,

      case
        when js.source_tier = 'pillar' then true
        when coalesce(js.priority, 0) >= 70 then true
        when js.ingest_method = 'api' then true
        else false
      end as is_pillar
    from public.job_sources js
    left join offers o on o.job_source_id = js.id
    left join consec c on c.job_source_id = js.id
    left join runs_agg ra on ra.job_source_id = js.id
  ),

  to_disable as (
    select *
    from candidates
    where is_active is true
      and auto_disable_enabled is true
      and (activated_at is null or activated_at < v_now - (grace_days || ' days')::interval)
      and (
        (is_pillar is false and run_count > 0 and offers_window < min_offers_7d)
        or (consecutive_failures >= max_consecutive_failures)
        or (run_count >= 4 and fail_rate > max_fail_rate_10)
      )
  ),

  upd as (
    update public.job_sources js
      set is_active = false,
          active = false,
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
            '; consecutive_failures=' || td.consecutive_failures
    from to_disable td
    where js.id = td.id
    returning 1
  )
  select count(*) into v_disabled from upd;

  return v_disabled;
end;
$$;

-- 6) Monitoring tables + health view
create table if not exists public.jobradar_health_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  level text not null,
  code text not null,
  details jsonb not null default '{}'::jsonb,
  resolved_at timestamptz
);

create table if not exists public.jobradar_health_snapshots (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  active_sources int not null,
  ready_inactive_sources int not null,
  jobs_active int not null,
  jobs_24h int not null,
  jobs_7d int not null,
  jobs_30d int not null,
  enrich_24h int not null,
  ingest_runs_24h int not null,
  ingest_success_24h int not null,
  status text not null,
  notes text
);

create or replace view public.jobradar_health_view as
select
  now() as as_of,
  (select count(*) from public.job_sources where is_active is true and ingest_status = 'ready') as active_sources,
  (select count(*) from public.job_sources where is_active is false and ingest_status = 'ready') as ready_inactive_sources,
  (select count(*) from public.jobs where is_active is true and is_expired is false) as jobs_active,
  (select count(*) from public.jobs where published_at >= now() - interval '24 hours') as jobs_24h,
  (select count(*) from public.jobs where published_at >= now() - interval '7 days') as jobs_7d,
  (select count(*) from public.jobs where published_at >= now() - interval '30 days') as jobs_30d,
  (select count(*) from public.jobs where ai_description_status = 'ok'
     and ai_description_updated_at >= now() - interval '24 hours') as enrich_24h,
  (select count(*) from public.job_source_runs where run_kind = 'ingest'
     and started_at >= now() - interval '24 hours') as ingest_runs_24h,
  (select count(*) from public.job_source_runs where run_kind = 'ingest'
     and coalesce(ok, status = 'success')
     and finished_at >= now() - interval '24 hours') as ingest_success_24h;

-- 7) Health guard: log anomalies + auto-reactivate pillars if needed
create or replace function public.jobradar_health_guard()
returns jsonb
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_active_sources int := 0;
  v_ready_inactive int := 0;
  v_jobs_active int := 0;
  v_jobs_24h int := 0;
  v_jobs_7d int := 0;
  v_jobs_30d int := 0;
  v_enrich_24h int := 0;
  v_ingest_runs_24h int := 0;
  v_ingest_success_24h int := 0;
  v_status text := 'healthy';
  v_warning boolean := false;
  v_reactivated int := 0;
  v_min_active int := 3;
begin
  select count(*) into v_active_sources
  from public.job_sources
  where is_active is true and ingest_status = 'ready';

  select count(*) into v_ready_inactive
  from public.job_sources
  where is_active is false and ingest_status = 'ready';

  select count(*) into v_jobs_active
  from public.jobs
  where is_active is true and is_expired is false;

  select count(*) into v_jobs_24h
  from public.jobs
  where published_at >= v_now - interval '24 hours';

  select count(*) into v_jobs_7d
  from public.jobs
  where published_at >= v_now - interval '7 days';

  select count(*) into v_jobs_30d
  from public.jobs
  where published_at >= v_now - interval '30 days';

  select count(*) into v_enrich_24h
  from public.jobs
  where ai_description_status = 'ok'
    and ai_description_updated_at >= v_now - interval '24 hours';

  select count(*) into v_ingest_runs_24h
  from public.job_source_runs
  where run_kind = 'ingest' and started_at >= v_now - interval '24 hours';

  select count(*) into v_ingest_success_24h
  from public.job_source_runs
  where run_kind = 'ingest'
    and coalesce(ok, status = 'success')
    and finished_at >= v_now - interval '24 hours';

  if v_active_sources = 0 then
    v_status := 'critical';
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'no_active_sources' and created_at > v_now - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'no_active_sources',
        jsonb_build_object('active_sources', v_active_sources, 'ready_inactive', v_ready_inactive));
    end if;

    v_reactivated := public.jobradar_reactivate_min_sources();
    if v_reactivated > 0 then
      insert into public.jobradar_health_events(level, code, details)
      values ('warning', 'auto_reactivate_sources', jsonb_build_object('count', v_reactivated));
    end if;
  end if;

  if v_jobs_7d = 0 then
    v_status := 'critical';
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'no_jobs_7d' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'no_jobs_7d', jsonb_build_object('jobs_7d', v_jobs_7d));
    end if;
  elsif v_jobs_24h = 0 then
    v_warning := true;
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'no_jobs_24h' and created_at > v_now - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('warning', 'no_jobs_24h', jsonb_build_object('jobs_24h', v_jobs_24h));
    end if;
  end if;

  if v_active_sources < v_min_active then
    v_warning := true;
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'low_active_sources' and created_at > v_now - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('warning', 'low_active_sources',
        jsonb_build_object('active_sources', v_active_sources, 'min_active', v_min_active));
    end if;
  end if;

  if v_ready_inactive > 0 then
    v_warning := true;
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'ready_sources_inactive' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('info', 'ready_sources_inactive',
        jsonb_build_object('ready_inactive', v_ready_inactive));
    end if;
  end if;

  if v_ingest_runs_24h = 0 then
    v_warning := true;
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'no_ingest_runs_24h' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('warning', 'no_ingest_runs_24h', jsonb_build_object('ingest_runs_24h', v_ingest_runs_24h));
    end if;
  elsif v_ingest_success_24h = 0 then
    v_warning := true;
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'ingest_all_failed_24h' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('warning', 'ingest_all_failed_24h',
        jsonb_build_object('ingest_runs_24h', v_ingest_runs_24h, 'ingest_success_24h', v_ingest_success_24h));
    end if;
  end if;

  if v_jobs_24h > 0 and v_enrich_24h = 0 then
    v_warning := true;
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'enrich_stalled' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('warning', 'enrich_stalled', jsonb_build_object('enrich_24h', v_enrich_24h));
    end if;
  end if;

  if v_status <> 'critical' and v_warning then
    v_status := 'warning';
  end if;

  insert into public.jobradar_health_snapshots(
    active_sources, ready_inactive_sources, jobs_active, jobs_24h, jobs_7d, jobs_30d,
    enrich_24h, ingest_runs_24h, ingest_success_24h, status
  )
  values (
    v_active_sources, v_ready_inactive, v_jobs_active, v_jobs_24h, v_jobs_7d, v_jobs_30d,
    v_enrich_24h, v_ingest_runs_24h, v_ingest_success_24h, v_status
  );

  return jsonb_build_object(
    'status', v_status,
    'active_sources', v_active_sources,
    'ready_inactive_sources', v_ready_inactive,
    'jobs_active', v_jobs_active,
    'jobs_24h', v_jobs_24h,
    'jobs_7d', v_jobs_7d,
    'jobs_30d', v_jobs_30d,
    'enrich_24h', v_enrich_24h,
    'ingest_runs_24h', v_ingest_runs_24h,
    'ingest_success_24h', v_ingest_success_24h,
    'reactivated', v_reactivated
  );
end;
$$;

-- 8) Schedule guard (every 30 minutes) if not already present
-- Avoid $$ nesting inside DO blocks; pass command as a simple SQL string.
do $guard$
begin
  -- Skip if pg_cron is not available (e.g., local without cron schema)
  if to_regclass('cron.job') is not null then
    if not exists (select 1 from cron.job where jobname = 'jobradar_health_guard') then
      perform cron.schedule(
        'jobradar_health_guard',
        '*/30 * * * *',
        'select public.jobradar_health_guard();'
      );
    end if;
  end if;
end $guard$;
