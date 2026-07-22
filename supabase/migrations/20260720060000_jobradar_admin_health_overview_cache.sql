-- Mise en cache de admin_health_v1_overview() : calcul programme toutes les
-- 5 minutes au lieu d'un calcul a chaque chargement de la page Admin Health.
--
-- Diagnostic du 20/07/2026 (EXPLAIN) : la requete de synthese fait un
-- Parallel Seq Scan sur public.jobs (~660k lignes lues, table de 1,1M lignes
-- au total) car elle calcule plusieurs compteurs filtres differents (total,
-- actifs non expires, expires, crees aujourd'hui, vus aujourd'hui, crees sur
-- 7 jours, repartition par pays) en un seul passage -- aucun index ne peut
-- servir toutes ces conditions a la fois. Resultat : ~8-9 secondes
-- d'execution, au-dessus du timeout du client edge function, d'ou l'erreur
-- health_rpc_failed / 500 vue sur /admin/health.
--
-- Fix durable : la page Admin Health n'a pas besoin d'une fraicheur a la
-- seconde -- un instantane recalcule toutes les 5 minutes est largement
-- suffisant. Le calcul lourd est deplace vers une tache planifiee qui ecrit
-- son resultat dans une table de cache ; admin_health_v1_overview() devient
-- une simple lecture de cette table (quasi instantane), et expose l'age du
-- dernier calcul (cache_computed_at / cache_age_seconds) pour que l'admin
-- sache a quel point les chiffres sont recents.

begin;

create table if not exists private.jobradar_admin_health_overview_cache (
  id boolean primary key default true,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  computed_duration_ms integer,
  constraint jobradar_admin_health_overview_cache_singleton check (id)
);

revoke all on table private.jobradar_admin_health_overview_cache from public, authenticated, anon;

create or replace function private.jobradar_admin_health_overview_refresh()
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'vault'
as $func$
declare
  v_started timestamptz := clock_timestamp();
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
  v_payload jsonb;
begin
  -- Corps identique a l'ancien admin_health_v1_overview() (migration
  -- 20260517110000 / 20260702120000), inchange -- seule la destination du
  -- resultat change (cache au lieu d'un retour direct).
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

  v_payload := jsonb_build_object(
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

  insert into private.jobradar_admin_health_overview_cache (id, payload, computed_at, computed_duration_ms)
  values (true, v_payload, v_as_of, ceil(extract(epoch from (clock_timestamp() - v_started)) * 1000)::int)
  on conflict (id) do update
    set payload = excluded.payload,
        computed_at = excluded.computed_at,
        computed_duration_ms = excluded.computed_duration_ms;
end;
$func$;

revoke all on function private.jobradar_admin_health_overview_refresh() from public;

-- admin_health_v1_overview() devient une simple lecture du cache (quasi
-- instantane) au lieu de recalculer a chaque appel.
create or replace function public.admin_health_v1_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, private
as $$
declare
  v_payload jsonb;
  v_computed_at timestamptz;
  v_duration int;
begin
  perform public.admin_health_v1_assert_admin();

  select payload, computed_at, computed_duration_ms
  into v_payload, v_computed_at, v_duration
  from private.jobradar_admin_health_overview_cache
  where id = true;

  if not found then
    -- Premiere execution : pas encore de cache, on calcule une fois en
    -- direct pour ne pas renvoyer une page vide.
    perform private.jobradar_admin_health_overview_refresh();

    select payload, computed_at, computed_duration_ms
    into v_payload, v_computed_at, v_duration
    from private.jobradar_admin_health_overview_cache
    where id = true;
  end if;

  return v_payload || jsonb_build_object(
    'cache_computed_at', v_computed_at,
    'cache_computed_duration_ms', v_duration,
    'cache_age_seconds', floor(extract(epoch from (now() - v_computed_at)))
  );
end;
$$;

grant execute on function public.admin_health_v1_overview() to service_role;

-- Calcul initial immediat pour ne pas laisser le cache vide en attendant le
-- premier cycle du cron.
select private.jobradar_admin_health_overview_refresh();

-- Rafraichissement automatique toutes les 5 minutes.
do $$
begin
  if to_regclass('cron.job') is not null then
    if not exists (select 1 from cron.job where jobname = 'jobradar_admin_health_overview_refresh') then
      perform cron.schedule(
        'jobradar_admin_health_overview_refresh',
        '*/5 * * * *',
        $cron$select private.jobradar_admin_health_overview_refresh();$cron$
      );
    end if;
  end if;
end;
$$;

commit;
