-- JobRadar admin health dashboard V1.
-- Read-only RPCs for: "Est-ce que la machine JobRadar tourne normalement aujourd'hui ?"

begin;

create or replace function public.admin_health_v1_assert_admin()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.role() = 'service_role' then
    return;
  end if;

  if coalesce(public.is_admin_user(), false) then
    return;
  end if;

  raise exception 'admin_only' using errcode = '42501';
end;
$$;

create or replace function public.admin_health_v1_redact_text(p_value text, p_max_len integer default 220)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select nullif(
    left(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              coalesce(p_value, ''),
              '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
              '[redacted]',
              'g'
            ),
            '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}',
            '[redacted]',
            'g'
          ),
          'Bearer[[:space:]]+[A-Za-z0-9._~+/=-]+',
          'Bearer [redacted]',
          'gi'
        ),
        '([A-Za-z0-9_-]{24,})',
        '[redacted]',
        'g'
      ),
      greatest(coalesce(p_max_len, 220), 40)
    ),
    ''
  );
$$;

create or replace function public.admin_health_v1_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_as_of timestamptz := now();
  v_jobs jsonb;
  v_sources jsonb;
  v_runs jsonb;
  v_recent_events jsonb := '[]'::jsonb;
  v_status text := 'ok';
  v_red_flags text[] := array[]::text[];
  v_active_jobs bigint := 0;
  v_active_sources bigint := 0;
  v_ingest_runs_24h bigint := 0;
  v_ingest_success_24h bigint := 0;
begin
  perform public.admin_health_v1_assert_admin();

  select
    count(*) filter (where is_active is true and is_expired is false),
    jsonb_build_object(
      'total', count(*),
      'active_not_expired', count(*) filter (where is_active is true and is_expired is false),
      'active_with_url', count(*) filter (
        where is_active is true
          and is_expired is false
          and nullif(btrim(coalesce(apply_url, source_url, '')), '') is not null
      ),
      'expired', count(*) filter (where is_expired is true),
      'created_today', count(*) filter (where created_at >= date_trunc('day', v_as_of)),
      'seen_today', count(*) filter (where last_seen_at >= date_trunc('day', v_as_of)),
      'created_7d', count(*) filter (where created_at >= v_as_of - interval '7 days'),
      'active_by_country', coalesce(
        (
          select jsonb_agg(jsonb_build_object('country', country_label, 'count', job_count) order by job_count desc, country_label asc)
          from (
            select coalesce(nullif(btrim(country), ''), 'unknown') as country_label, count(*) as job_count
            from public.jobs
            where is_active is true and is_expired is false
            group by 1
            order by 2 desc, 1 asc
            limit 12
          ) c
        ),
        '[]'::jsonb
      )
    )
  into v_active_jobs, v_jobs
  from public.jobs;

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

  if v_active_jobs = 0 then
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

create or replace function public.admin_health_v1_sources()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.admin_health_v1_assert_admin();

  return (
    with recent as (
      select distinct on (r.job_source_id)
        r.job_source_id,
        r.started_at,
        r.finished_at,
        r.status,
        coalesce(r.ok, r.status = 'success') as ok,
        r.fetched_count,
        r.inserted_count,
        r.updated_count,
        r.error
      from public.job_source_runs r
      where r.run_kind = 'ingest'
      order by r.job_source_id, r.started_at desc
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source_id', s.id,
          'code', s.code,
          'name', s.name,
          'ingest_method', s.ingest_method,
          'ingest_status', s.ingest_status,
          'is_active', s.is_active,
          'auto_disabled', coalesce(s.auto_disabled, false),
          'health_status', s.health_status,
          'last_success_at', s.last_success_at,
          'consecutive_failures', s.consecutive_failures,
          'last_run_at', recent.started_at,
          'last_run_status', recent.status,
          'last_run_ok', recent.ok,
          'last_run_fetched', recent.fetched_count,
          'last_run_inserted', recent.inserted_count,
          'last_run_updated', recent.updated_count,
          'last_run_duration_ms',
            case
              when recent.started_at is not null and recent.finished_at is not null
              then floor(extract(epoch from (recent.finished_at - recent.started_at)) * 1000)::bigint
              else null
            end,
          'last_error_summary',
            case when recent.ok is false then public.admin_health_v1_redact_text(recent.error, 220) else null end,
          'watch_level',
            case
              when coalesce(s.auto_disabled, false) is true then 'critical'
              when s.is_active is true and (s.last_success_at is null or s.last_success_at < now() - interval '7 days') then 'critical'
              when s.is_active is true and (s.last_success_at is null or s.last_success_at < now() - interval '24 hours') then 'warning'
              when recent.ok is false then 'warning'
              else 'ok'
            end
        )
        order by
          case
            when coalesce(s.auto_disabled, false) is true then 0
            when s.is_active is true and (s.last_success_at is null or s.last_success_at < now() - interval '7 days') then 1
            when s.is_active is true and (s.last_success_at is null or s.last_success_at < now() - interval '24 hours') then 2
            when recent.ok is false then 3
            else 4
          end,
          coalesce(s.last_success_at, recent.started_at) asc nulls first,
          s.code asc
      ),
      '[]'::jsonb
    )
    from public.job_sources s
    left join recent on recent.job_source_id = s.id
    where s.is_active is true
       or coalesce(s.auto_disabled, false) is true
       or recent.ok is false
  );
end;
$$;

create or replace function public.admin_health_v1_runs()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.admin_health_v1_assert_admin();

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'run_id', r.id,
          'source_code', s.code,
          'source_name', s.name,
          'run_kind', r.run_kind,
          'started_at', r.started_at,
          'finished_at', r.finished_at,
          'status', r.status,
          'ok', coalesce(r.ok, r.status = 'success'),
          'fetched_count', r.fetched_count,
          'inserted_count', r.inserted_count,
          'updated_count', r.updated_count,
          'duration_ms',
            case
              when r.started_at is not null and r.finished_at is not null
              then floor(extract(epoch from (r.finished_at - r.started_at)) * 1000)::bigint
              else null
            end,
          'error_summary',
            case
              when coalesce(r.ok, r.status = 'success') is false
              then public.admin_health_v1_redact_text(r.error, 220)
              else null
            end
        )
        order by r.started_at desc
      ),
      '[]'::jsonb
    )
    from (
      select *
      from public.job_source_runs
      where run_kind = 'ingest'
      order by started_at desc
      limit 40
    ) r
    left join public.job_sources s on s.id = r.job_source_id
  );
end;
$$;

create or replace function public.admin_health_v1_crons()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_result jsonb := '[]'::jsonb;
begin
  perform public.admin_health_v1_assert_admin();

  if to_regclass('cron.job') is null then
    return jsonb_build_array(
      jsonb_build_object(
        'jobid', null,
        'jobname', 'pg_cron_unavailable',
        'active', false,
        'schedule', null,
        'target_summary', 'pg_cron schema not available',
        'dry_run_false_detected', false,
        'allow_send_detected', false,
        'allow_import_detected', false,
        'hardcoded_user_id_detected', false,
        'last_run_status', null,
        'last_run_at', null,
        'recent_error_summary', null
      )
    );
  end if;

  begin
    execute $crons$
      with jobs as (
        select
          j.jobid,
          coalesce(nullif(j.jobname, ''), 'unnamed_' || j.jobid::text) as jobname,
          j.active,
          j.schedule,
          j.command,
          substring(j.command from '/functions/v1/([A-Za-z0-9_-]+)') as endpoint_name,
          substring(j.command from 'select[[:space:]]+([A-Za-z0-9_]+\.[A-Za-z0-9_]+)[[:space:]]*\(') as sql_fn
        from cron.job j
      ),
      last_runs as (
        select distinct on (d.jobid)
          d.jobid,
          d.status,
          coalesce(d.end_time, d.start_time) as last_run_at
        from cron.job_run_details d
        order by d.jobid, d.start_time desc
      ),
      errors as (
        select
          d.jobid,
          public.admin_health_v1_redact_text(string_agg(d.status || ': ' || coalesce(d.return_message, ''), ' | ' order by d.start_time desc), 260) as summary
        from (
          select *
          from cron.job_run_details
          where start_time >= now() - interval '7 days'
            and coalesce(status, '') <> 'succeeded'
          order by start_time desc
          limit 100
        ) d
        group by d.jobid
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'jobid', jobs.jobid,
            'jobname', jobs.jobname,
            'active', jobs.active,
            'schedule', jobs.schedule,
            'target_summary',
              case
                when jobs.endpoint_name is not null then 'edge:' || jobs.endpoint_name
                when jobs.sql_fn is not null then 'sql:' || jobs.sql_fn
                else 'sql:unknown'
              end,
            'dry_run_false_detected', jobs.command ~* '(''dry_run''[[:space:]]*,[[:space:]]*false|"dry_run"[[:space:]]*:[[:space:]]*false)',
            'allow_send_detected', jobs.command ~* '(''allow_send''[[:space:]]*,[[:space:]]*true|"allow_send"[[:space:]]*:[[:space:]]*true)',
            'allow_import_detected', jobs.command ~* '(''allow_import''[[:space:]]*,[[:space:]]*true|"allow_import"[[:space:]]*:[[:space:]]*true)',
            'hardcoded_user_id_detected', jobs.command ~* '(''user_id''[[:space:]]*,[[:space:]]*''[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}''|"user_id"[[:space:]]*:[[:space:]]*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")',
            'last_run_status', last_runs.status,
            'last_run_at', last_runs.last_run_at,
            'recent_error_summary', errors.summary
          )
          order by jobs.active desc, jobs.jobname asc, jobs.jobid asc
        ),
        '[]'::jsonb
      )
      from jobs
      left join last_runs on last_runs.jobid = jobs.jobid
      left join errors on errors.jobid = jobs.jobid
    $crons$ into v_result;

  exception
    when insufficient_privilege or undefined_table or invalid_schema_name then
      return jsonb_build_array(
        jsonb_build_object(
          'jobid', null,
          'jobname', 'pg_cron_access_unavailable',
          'active', false,
          'schedule', null,
          'target_summary', 'pg_cron access unavailable',
          'dry_run_false_detected', false,
          'allow_send_detected', false,
          'allow_import_detected', false,
          'hardcoded_user_id_detected', false,
          'last_run_status', null,
          'last_run_at', null,
          'recent_error_summary', public.admin_health_v1_redact_text(sqlerrm, 220)
        )
      );
  end;

  return v_result;
end;
$$;

revoke all on function public.admin_health_v1_assert_admin() from public;
revoke all on function public.admin_health_v1_redact_text(text, integer) from public;
revoke all on function public.admin_health_v1_overview() from public;
revoke all on function public.admin_health_v1_sources() from public;
revoke all on function public.admin_health_v1_runs() from public;
revoke all on function public.admin_health_v1_crons() from public;

grant execute on function public.admin_health_v1_overview() to service_role;
grant execute on function public.admin_health_v1_sources() to service_role;
grant execute on function public.admin_health_v1_runs() to service_role;
grant execute on function public.admin_health_v1_crons() to service_role;

commit;


