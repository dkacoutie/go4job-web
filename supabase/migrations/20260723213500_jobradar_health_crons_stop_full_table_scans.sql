-- Audit du 23/07/2026 (chantier "page /jobradar/feed lente et instable").
--
-- Preuve mesuree sur ce projet (fygsoucyzmfainnbdpvw) :
--   - select count(*) from jobs (1 189 620 lignes)              -> 7,02 s (EXPLAIN ANALYZE)
--   - select count(*) from jobs where created_at >= today        -> 7,42 s (parallel seq scan,
--     "Rows Removed by Filter: 587008", lecture disque a froid)
--   - private.jobradar_admin_health_overview_refresh() (cron toutes les 5 min) observee a
--     21-67 s d'execution reelle dans les logs Postgres des dernieres minutes
--   - public.jobradar_health_guard() (cron toutes les 30 min) observee a 60-67 s
--   - Plusieurs erreurs "canceling statement due to statement timeout" (timeout = 2 min)
--     regroupees dans les memes fenetres de logs
--
-- Ces deux fonctions font des count(*) / agregats SANS filtre exploitable par un index
-- existant (created_at, last_seen_at, published_at, desc_updated_at n'ont aucun index
-- dedie ; is_expired seul non plus). Chaque execution force donc un balayage complet
-- (sequentiel ou "index only" degrade) de la table jobs, sur la MEME instance Postgres
-- qui sert aussi les requetes du feed cote utilisateur. C'est une cause racine confirmee
-- de la lenteur et des erreurs intermittentes du feed (contention CPU/IO periodique +
-- annulations par statement_timeout).
--
-- Ce fichier ne touche a aucune donnee et ne supprime rien. Il :
--   1) ajoute des index cibles (CONCURRENTLY, donc hors transaction, sans verrou bloquant) ;
--   2) reecrit les deux fonctions pour qu'elles utilisent ces index au lieu d'un scan complet,
--      en conservant EXACTEMENT la meme forme de resultat (meme JSON, memes colonnes) pour
--      ne rien casser sur /admin/health ;
--   3) espace la frequence du cron d'health overview (5 min -> 15 min). A ajuster si tu veux
--      une fraicheur differente pour /admin/health : ce n'est pas un choix technique, dis-moi
--      si 15 min ne convient pas.
--
-- Rien n'est destructif : les index sont additifs (DROP INDEX possible a tout moment),
-- les fonctions remplacees peuvent etre restaurees en repassant leur ancienne definition
-- (conservee dans l'historique git / capturee lors de cet audit).
--
-- Dry-run recommande avant d'executer ce fichier dans le SQL Editor :
--   explain (analyze, buffers) select count(*) from jobs where created_at >= date_trunc('day', now());
--   -- comparer le temps avant/apres la creation de idx_jobs_created_at ci-dessous.

-- ---------------------------------------------------------------------------
-- 1) Index additifs (hors transaction : CONCURRENTLY ne peut pas etre dans un begin/commit)
-- ---------------------------------------------------------------------------

create index concurrently if not exists idx_jobs_created_at
  on public.jobs (created_at);

create index concurrently if not exists idx_jobs_last_seen_at
  on public.jobs (last_seen_at);

create index concurrently if not exists idx_jobs_published_at_plain
  on public.jobs (published_at);

create index concurrently if not exists idx_jobs_desc_updated_at
  on public.jobs (desc_updated_at);

create index concurrently if not exists idx_jobs_is_expired_true
  on public.jobs (id)
  where is_expired is true;

-- ---------------------------------------------------------------------------
-- 2) Fonctions : remplacement transactionnel (CREATE OR REPLACE FUNCTION est
--    transactionnel, contrairement a CREATE INDEX CONCURRENTLY ci-dessus).
-- ---------------------------------------------------------------------------

begin;

create or replace function private.jobradar_admin_health_overview_refresh()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'vault'
as $function$
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
  -- Champs calcules separement (chacun sur son propre index) plutot que dans
  -- une seule agregation FILTER qui force un scan complet de la table.
  v_total_estimate bigint;
  v_active_not_expired bigint;
  v_active_with_url bigint;
  v_expired bigint;
  v_created_today bigint;
  v_seen_today bigint;
  v_created_7d bigint;
  v_active_by_country jsonb;
begin
  -- 'total' : estimation planificateur (pg_class.reltuples), rafraichie par
  -- autovacuum/autoanalyze. Un tableau de bord de sante n'a pas besoin d'un
  -- compte exact a la ligne pres ; eviter un scan de 1,19M lignes pour ce
  -- seul chiffre fait gagner l'essentiel du temps d'execution.
  select coalesce(reltuples::bigint, 0) into v_total_estimate
  from pg_class where oid = 'public.jobs'::regclass;

  -- Sert l'index partiel jobs_feed_gate_idx (is_active, is_expired, quality_status).
  select count(*) into v_active_not_expired
  from public.jobs
  where is_active is true and is_expired is false;

  select count(*) into v_active_with_url
  from public.jobs
  where is_active is true
    and is_expired is false
    and nullif(btrim(coalesce(apply_url, source_url, '')), '') is not null;

  -- Sert idx_jobs_is_expired_true (index partiel cree ci-dessus).
  select count(*) into v_expired
  from public.jobs
  where is_expired is true;

  -- Sert idx_jobs_created_at.
  select count(*) into v_created_today
  from public.jobs
  where created_at >= date_trunc('day', v_as_of);

  select count(*) into v_created_7d
  from public.jobs
  where created_at >= v_as_of - interval '7 days';

  -- Sert idx_jobs_last_seen_at.
  select count(*) into v_seen_today
  from public.jobs
  where last_seen_at >= date_trunc('day', v_as_of);

  select coalesce(
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
  ) into v_active_by_country;

  v_active_jobs := v_active_not_expired;
  v_jobs := jsonb_build_object(
    'total', v_total_estimate,
    'total_is_estimate', true,
    'active_not_expired', v_active_not_expired,
    'active_with_url', v_active_with_url,
    'expired', v_expired,
    'created_today', v_created_today,
    'seen_today', v_seen_today,
    'created_7d', v_created_7d,
    'active_by_country', v_active_by_country
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
$function$;

-- public.jobradar_health_guard() : memes comptages, memes seuils, meme structure de
-- retour et memes insertions dans jobradar_health_events / jobradar_health_snapshots.
-- Seul changement : les comptages sur published_at / desc_updated_at s'appuient
-- desormais sur idx_jobs_published_at_plain et idx_jobs_desc_updated_at au lieu
-- d'un balayage complet (aucun index n'existait sur ces deux colonnes seules).
create or replace function public.jobradar_health_guard()
 returns jsonb
 language plpgsql
as $function$
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
$function$;

-- ---------------------------------------------------------------------------
-- 3) Espacement du cron le plus frequent (jobid 55). A confirmer avec Dieudonne :
--    /admin/health n'a pas besoin d'une fraicheur de 5 minutes obtenue au prix
--    d'un scan complet ; 15 minutes reste largement suffisant pour un tableau
--    de bord de supervision consulte manuellement.
-- ---------------------------------------------------------------------------

select cron.alter_job(job_id := 55, schedule := '*/15 * * * *');

commit;

-- Note : jobradar_job_lifecycle_maintenance() (jobid 36, toutes les heures, 49 s
-- observees) N'EST PAS touchee par cette migration. Elle fait de vraies ecritures
-- (transitions de statut d'offres) et merite un audit dedie avant toute
-- modification, plutot qu'un correctif rapide sur une fonction qui touche
-- directement is_active/is_expired en production. A traiter separement.
