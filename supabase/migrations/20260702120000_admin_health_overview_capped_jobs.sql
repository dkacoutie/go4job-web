-- JobRadar admin health overview: keep jobs counters fast and non-null.
-- Uses capped counters instead of full table counts on public.jobs.

begin;

create or replace function public.admin_health_v1_overview()
returns jsonb
language plpgsql
security definer
set search_path to public, pg_catalog
as $$
declare
  v_as_of timestamptz := now();
  v_day_start timestamptz := date_trunc('day', now());
  v_job_count_limit integer := 10000;
  v_jobs jsonb;
  v_sources jsonb;
  v_runs jsonb;
  v_recent_events jsonb := '[]'::jsonb;
  v_status text := 'ok';
  v_red_flags text[] := array[]::text[];
  v_total_jobs bigint := 0;
  v_active_jobs bigint := 0;
  v_active_with_url bigint := 0;
  v_expired_jobs bigint := 0;
  v_created_today bigint := 0;
  v_seen_today bigint := 0;
  v_created_7d bigint := 0;
  v_active_sources bigint := 0;
  v_ingest_runs_24h bigint := 0;
  v_ingest_success_24h bigint := 0;
begin
  perform public.admin_health_v1_assert_admin();

  select count(*) into v_total_jobs
  from (
    select 1
    from public.jobs
    limit v_job_count_limit
  ) limited;

  select count(*) into v_active_jobs
  from (
    select 1
    from public.jobs
    where is_active is true
      and is_expired is false
    limit v_job_count_limit
  ) limited;

  select count(*) into v_active_with_url
  from (
    select 1
    from public.jobs
    where is_active is true
      and is_expired is false
      and nullif(btrim(coalesce(apply_url, source_url, '')), '') is not null
    limit v_job_count_limit
  ) limited;

  select count(*) into v_expired_jobs
  from (
    select 1
    from public.jobs
    where is_expired is true
    limit v_job_count_limit
  ) limited;

  select count(*) into v_created_today
  from (
    select 1
    from public.jobs
    where created_at >= v_day_start
    limit v_job_count_limit
  ) limited;

  select count(*) into v_seen_today
  from (
    select 1
    from public.jobs
    where last_seen_at >= v_day_start
    limit v_job_count_limit
  ) limited;

  select count(*) into v_created_7d
  from (
    select 1
    from public.jobs
    where created_at >= v_as_of - interval '7 days'
    limit v_job_count_limit
  ) limited;

  v_jobs := jsonb_build_object(
    'total', coalesce(v_total_jobs, 0),
    'total_capped', coalesce(v_total_jobs, 0) >= v_job_count_limit,
    'active_not_expired', coalesce(v_active_jobs, 0),
    'active_not_expired_capped', coalesce(v_active_jobs, 0) >= v_job_count_limit,
    'active_with_url', coalesce(v_active_with_url, 0),
    'active_with_url_capped', coalesce(v_active_with_url, 0) >= v_job_count_limit,
    'expired', coalesce(v_expired_jobs, 0),
    'expired_capped', coalesce(v_expired_jobs, 0) >= v_job_count_limit,
    'created_today', coalesce(v_created_today, 0),
    'created_today_capped', coalesce(v_created_today, 0) >= v_job_count_limit,
    'seen_today', coalesce(v_seen_today, 0),
    'seen_today_capped', coalesce(v_seen_today, 0) >= v_job_count_limit,
    'created_7d', coalesce(v_created_7d, 0),
    'created_7d_capped', coalesce(v_created_7d, 0) >= v_job_count_limit,
    'counter_limit', v_job_count_limit,
    'active_by_country', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('country', country_label, 'count', job_count)
          order by job_count desc, country_label asc
        )
        from (
          select coalesce(nullif(btrim(country), ''), 'unknown') as country_label,
                 count(*) as job_count
          from (
            select country
            from public.jobs
            where is_active is true
              and is_expired is false
            limit v_job_count_limit
          ) active_sample
          group by 1
          order by 2 desc, 1 asc
          limit 12
        ) c
      ),
      '[]'::jsonb
    ),
    'active_by_country_capped', coalesce(v_active_jobs, 0) >= v_job_count_limit
  );

  select
    count(*) filter (where is_active is true and ingest_status = 'ready'),
    jsonb_build_object(
      'total', count(*),
      'active', count(*) filter (where is_active is true),
      'ready_active', count(*) filter (where is_active is true and ingest_status = 'ready'),
      'ready_inactive', count(*) filter (where is_active is false and ingest_status = 'ready'),
      'auto_disabled', count(*) filter (where coalesce(auto_disabled, false) is true),
      'healthy', count(*) filter (where health_status = 'healthy'),
      'warning', count(*) filter (where health_status = 'warning'),
      'critical', count(*) filter (where health_status = 'critical'),
      'without_success_24h', count(*) filter (
        where is_active is true and (last_success_at is null or last_success_at < v_as_of - interval '24 hours')
      ),
      'without_success_48h', count(*) filter (
        where is_active is true and (last_success_at is null or last_success_at < v_as_of - interval '48 hours')
      ),
      'without_success_7d', count(*) filter (
        where is_active is true and (last_success_at is null or last_success_at < v_as_of - interval '7 days')
      )
    )
  into v_active_sources, v_sources
  from public.job_sources;

  select
    count(*) filter (where run_kind = 'ingest' and started_at >= v_as_of - interval '24 hours'),
    count(*) filter (
      where run_kind = 'ingest'
        and coalesce(ok, status = 'success')
        and coalesce(finished_at, started_at) >= v_as_of - interval '24 hours'
    ),
    jsonb_build_object(
      'ingest_runs_24h', count(*) filter (where run_kind = 'ingest' and started_at >= v_as_of - interval '24 hours'),
      'ingest_success_24h', count(*) filter (
        where run_kind = 'ingest'
          and coalesce(ok, status = 'success')
          and coalesce(finished_at, started_at) >= v_as_of - interval '24 hours'
      ),
      'ingest_failures_24h', count(*) filter (
        where run_kind = 'ingest'
          and coalesce(ok, status = 'success') is false
          and started_at >= v_as_of - interval '24 hours'
      ),
      'running_over_30m', count(*) filter (
        where run_kind = 'ingest'
          and status = 'running'
          and started_at < v_as_of - interval '30 minutes'
      )
    )
  into v_ingest_runs_24h, v_ingest_success_24h, v_runs
  from public.job_source_runs;

  if to_regclass('public.jobradar_health_events') is not null then
    execute $events$
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'level', level,
            'code', code,
            'count_7d', event_count,
            'latest_at', latest_at
          )
          order by latest_at desc
        ),
        '[]'::jsonb
      )
      from (
        select level, code, count(*) as event_count, max(created_at) as latest_at
        from public.jobradar_health_events
        where created_at >= now() - interval '7 days'
          and resolved_at is null
        group by level, code
        order by max(created_at) desc
        limit 12
      ) e
    $events$ into v_recent_events;
  end if;

  if coalesce(v_active_jobs, 0) = 0 then
    v_status := 'critical';
    v_red_flags := array_append(v_red_flags, 'no_active_jobs');
  end if;

  if v_active_sources = 0 then
    v_status := 'critical';
    v_red_flags := array_append(v_red_flags, 'no_active_sources');
  end if;

  if v_ingest_runs_24h = 0 then
    v_status := 'critical';
    v_red_flags := array_append(v_red_flags, 'no_ingest_runs_24h');
  elsif v_ingest_success_24h = 0 then
    v_status := 'critical';
    v_red_flags := array_append(v_red_flags, 'no_successful_ingest_24h');
  end if;

  if v_status = 'ok' and jsonb_array_length(v_recent_events) > 0 then
    v_status := 'warning';
  end if;

  return jsonb_build_object(
    'as_of', v_as_of,
    'status', v_status,
    'red_flags', to_jsonb(v_red_flags),
    'jobs', v_jobs,
    'sources', v_sources,
    'runs', v_runs,
    'health_events_7d', v_recent_events,
    'excluded_from_v1', jsonb_build_array(
      'billing_details',
      'partner_details',
      'message_details',
      'admin_actions',
      'imports',
      'cron_retries',
      'outbound_sends'
    )
  );
end;
$$;

do $grant$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'admin_health_v1\_%' escape '\'
  loop
    execute format('grant execute on function %s to authenticated, service_role', v_function);
  end loop;
end
$grant$;

commit;
