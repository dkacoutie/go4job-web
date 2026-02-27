-- Enrichment guardrails: alert when enrich_24h=0 and align health metrics to desc_updated_at
-- Pragmatic, no refactor

-- 1) Health view uses desc_updated_at (actual enrichment signal)
create or replace view public.jobradar_health_view as
select
  now() as as_of,
  (select count(*) from public.job_sources where is_active is true and ingest_status = 'ready') as active_sources,
  (select count(*) from public.job_sources where is_active is false and ingest_status = 'ready') as ready_inactive_sources,
  (select count(*) from public.jobs where is_active is true and is_expired is false) as jobs_active,
  (select count(*) from public.jobs where published_at >= now() - interval '24 hours') as jobs_24h,
  (select count(*) from public.jobs where published_at >= now() - interval '7 days') as jobs_7d,
  (select count(*) from public.jobs where published_at >= now() - interval '30 days') as jobs_30d,
  (select count(*) from public.jobs where desc_updated_at >= now() - interval '24 hours') as enrich_24h,
  (select count(*) from public.job_source_runs where run_kind = 'ingest' and started_at >= now() - interval '24 hours') as ingest_runs_24h,
  (select count(*) from public.job_source_runs where run_kind = 'ingest'
     and coalesce(ok, status = 'success')
     and finished_at >= now() - interval '24 hours') as ingest_success_24h;

-- 2) Health guard logs alert if enrich_24h = 0 in last 24h
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
  where desc_updated_at >= v_now - interval '24 hours';

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

  -- Enrichment alert: 0 in last 24h
  if v_enrich_24h = 0 then
    v_warning := true;
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'enrich_zero_24h' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('warning', 'enrich_zero_24h', jsonb_build_object('enrich_24h', v_enrich_24h, 'jobs_24h', v_jobs_24h));
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
