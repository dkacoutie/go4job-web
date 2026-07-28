-- =============================================================================
-- JobRadar — Supervision par couverture, réactivation des sources,
--            partitionnement France Travail
-- Incident du 2026-07-28. État final consolidé.
--
-- Pourquoi la panne est passée inaperçue 8 jours
-- ----------------------------------------------
-- 1. jobradar_health_guard() comptait jobs_active via is_active = true, qui
--    inclut les offres périmées non nettoyées. Le tableau de bord affichait
--    263 000 pendant que le catalogue réellement frais tombait à 41 296.
--
-- 2. L'alerte ne se déclenchait que si AUCUNE source ne tournait. Avec 9
--    sources vivantes sur 70, tout paraissait normal. On surveille désormais
--    le TAUX de couverture (seuil critique à 70 %).
--
-- 3. Le cron jobradar_monitor_email (jobid 31) était désactivé, donc aucun
--    email n'est parti. Réactivé.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Supervision : compteur de vérité + alerte de couverture
-- -----------------------------------------------------------------------------
alter table public.jobradar_health_snapshots
  add column if not exists jobs_stale int,
  add column if not exists sources_ran_24h int,
  add column if not exists source_coverage_pct numeric;

create or replace function public.jobradar_health_guard()
returns jsonb
language plpgsql
as $function$
declare
  v_now timestamptz := now();
  v_active_sources int := 0;
  v_ready_inactive int := 0;
  v_jobs_active int := 0;
  v_jobs_stale int := 0;
  v_jobs_24h int := 0;
  v_jobs_7d int := 0;
  v_jobs_30d int := 0;
  v_enrich_24h int := 0;
  v_ingest_runs_24h int := 0;
  v_ingest_success_24h int := 0;
  v_sources_ran_24h int := 0;
  v_coverage numeric := 100;
  v_status text := 'healthy';
  v_warning boolean := false;
  v_reactivated int := 0;
  v_min_active int := 3;
  v_min_coverage numeric := 70;
begin
  select count(*) into v_active_sources
  from public.job_sources where is_active is true and ingest_status = 'ready';

  select count(*) into v_ready_inactive
  from public.job_sources where is_active is false and ingest_status = 'ready';

  -- Compteur de vérité : le cycle de vie, pas le booléen legacy.
  select count(*) into v_jobs_active
  from public.jobs where job_status = 'active'::public.job_lifecycle_status;

  select count(*) into v_jobs_stale
  from public.jobs where job_status = 'stale'::public.job_lifecycle_status;

  select count(*) into v_jobs_24h
  from public.jobs where published_at >= v_now - interval '24 hours';

  select count(*) into v_jobs_7d
  from public.jobs where published_at >= v_now - interval '7 days';

  select count(*) into v_jobs_30d
  from public.jobs where published_at >= v_now - interval '30 days';

  select count(*) into v_enrich_24h
  from public.jobs where desc_updated_at >= v_now - interval '24 hours';

  select count(*) into v_ingest_runs_24h
  from public.job_source_runs
  where run_kind = 'ingest' and started_at >= v_now - interval '24 hours';

  select count(*) into v_ingest_success_24h
  from public.job_source_runs
  where run_kind = 'ingest' and coalesce(ok, status = 'success')
    and finished_at >= v_now - interval '24 hours';

  -- Couverture : combien de sources actives ont réellement tourné.
  select count(distinct r.job_source_id) into v_sources_ran_24h
  from public.job_source_runs r
  join public.job_sources s on s.id = r.job_source_id
  where r.run_kind = 'ingest'
    and r.started_at >= v_now - interval '24 hours'
    and s.is_active is true and s.ingest_status = 'ready';

  if v_active_sources > 0 then
    v_coverage := round((v_sources_ran_24h::numeric / v_active_sources) * 100, 1);
  end if;

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

  -- ALERTE CLÉ : c'est celle qui aurait attrapé la panne du 20 juillet en 24 h.
  if v_active_sources > 0 and v_coverage < v_min_coverage then
    v_status := 'critical';
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'source_coverage_low' and created_at > v_now - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'source_coverage_low',
        jsonb_build_object('coverage_pct', v_coverage, 'ran_24h', v_sources_ran_24h,
                           'active_sources', v_active_sources, 'threshold', v_min_coverage));
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
    active_sources, ready_inactive_sources, jobs_active, jobs_stale, jobs_24h, jobs_7d, jobs_30d,
    enrich_24h, ingest_runs_24h, ingest_success_24h, sources_ran_24h, source_coverage_pct, status
  )
  values (
    v_active_sources, v_ready_inactive, v_jobs_active, v_jobs_stale, v_jobs_24h, v_jobs_7d, v_jobs_30d,
    v_enrich_24h, v_ingest_runs_24h, v_ingest_success_24h, v_sources_ran_24h, v_coverage, v_status
  );

  return jsonb_build_object(
    'status', v_status,
    'active_sources', v_active_sources,
    'sources_ran_24h', v_sources_ran_24h,
    'source_coverage_pct', v_coverage,
    'ready_inactive_sources', v_ready_inactive,
    'jobs_active', v_jobs_active,
    'jobs_stale', v_jobs_stale,
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

-- -----------------------------------------------------------------------------
-- 2. Réactivation sélective des sources en pause
--
-- Sur 57 sources 'ready' mais inactives :
--   A. 24 fiables et déjà productives            -> réactivées
--   B.  8 fiables mais sans offre à ce jour       -> réactivées
--   C. 25 cassées (403/404/DNS) ou en échec majoritaire -> laissées en pause,
--      elles demandent une réparation, pas un interrupteur.
--
-- Note : sur les 43 marquées « unstable », 23 avaient un historique de succès
-- à 100 %. L'ancienne règle de désactivation automatique jugeait sur le volume
-- d'offres, pas sur l'échec. La version actuelle de jobradar_monitor_sources()
-- ne désactive plus automatiquement.
--
-- Résultat : 70 -> 102 sources actives.
-- -----------------------------------------------------------------------------
with r as (
  select job_source_id,
         count(*) n,
         count(*) filter (where ok) ok_n,
         max(started_at) filter (where ok) last_ok,
         (array_agg(coalesce(error_code, error_message, error, '') order by started_at desc)
           filter (where not coalesce(ok, false)))[1] last_err
  from public.job_source_runs
  where run_kind = 'ingest'
  group by 1
),
eligible as (
  select s.id
  from public.job_sources s
  join r on r.job_source_id = s.id
  where s.is_active is false
    and s.ingest_status = 'ready'
    and r.n > 0
    and r.ok_n::numeric / nullif(r.n, 0) >= 0.5
    and not (
      coalesce(r.last_err, '') ~* '40[34]|error sending request|dns|timeout'
      and r.last_ok < now() - interval '60 days'
    )
)
update public.job_sources s
set is_active = true,
    active = true,
    auto_disabled = false,
    disabled_reason = null,
    disabled_at = null,
    health_status = 'healthy',
    health_status_reason = 'reactivated_after_audit_2026_07_28',
    last_auto_reactivated_at = now(),
    last_enqueued_at = null,
    updated_at = now()
from eligible e
where s.id = e.id;

-- -----------------------------------------------------------------------------
-- 3. France Travail : partition de la collecte par département
--
-- L'API plafonne chaque recherche à 3 150 résultats (paramètre `range`).
-- Avec 4 segments de type de contrat, seules ~12 600 offres étaient
-- atteignables sur un catalogue de ~147 000. Le reste ne pouvait pas être
-- rafraîchi, donc finissait mécaniquement par sortir du catalogue.
--
-- 101 départements + 1 segment générique = 102 x 3 150 = 321 000 offres
-- atteignables, largement au-dessus du volume réel.
--
-- Le curseur d'offset par segment est géré côté fonction edge
-- (runtime_state.segment_offsets), corrigé dans le même lot.
-- -----------------------------------------------------------------------------
with deps as (
  select lpad(g::text, 2, '0') as code
  from generate_series(1, 95) g
  where g <> 20
  union all
  select unnest(array['2A','2B','971','972','973','974','976'])
),
dep_segments as (
  select jsonb_agg(
    jsonb_build_object(
      'key', 'dep_' || code,
      'label', 'Departement ' || code,
      'limit', 100,
      'max_pages', 10,
      'range_step', 100,
      'search_params', jsonb_build_object('departement', code)
    ) order by code
  ) as arr
  from deps
),
new_segments as (
  select
    jsonb_build_array(
      jsonb_build_object(
        'key', 'generic_recent',
        'label', 'Generique recent',
        'limit', 100,
        'max_pages', 10,
        'range_step', 100,
        'search_params', jsonb_build_object()
      )
    ) || arr as arr
  from dep_segments
)
update public.job_sources s
set ingest_config = s.ingest_config
      || jsonb_build_object(
           'rotation_segments', ns.arr,
           'rotation_mode', 'departement_segments_v2',
           'subset_label', 'france_travail_rotation_v2_departements',
           'current_segment_index', 0,
           'segment_key', 'generic_recent',
           'updated_by_note', 'france_travail_departement_partitioning_2026_07_28',
           'runtime_state',
             coalesce(s.ingest_config->'runtime_state', '{}'::jsonb)
             || jsonb_build_object(
                  'segment_offsets', '{}'::jsonb,
                  'current_segment_index', 0,
                  'current_segment_key', 'generic_recent'
                )
         ),
    updated_at = now()
from new_segments ns
where s.code = 'france_travail_api';

-- -----------------------------------------------------------------------------
-- 4. Adzuna : remise à zéro des curseurs bloqués
--
-- startPage était borné par Math.min(cursor, 999). Un curseur arrivé à 1000
-- était donc ramené à 999 à chaque exécution. La page 999 renvoyant un lot
-- complet, la condition de fin n'était jamais atteinte et next_page était
-- réenregistré à 1000. La même page était relue depuis des semaines.
-- Le code est corrigé (retour à la page 1 au lieu d'une troncature) ; on
-- réinitialise les curseurs pour repartir immédiatement.
-- -----------------------------------------------------------------------------
update public.job_sources
set ingest_config = jsonb_set(
      ingest_config,
      '{runtime_state,segment_pages}',
      (
        select coalesce(jsonb_object_agg(k, jsonb_set(v, '{next_page}', '1'::jsonb)), '{}'::jsonb)
        from jsonb_each(coalesce(ingest_config->'runtime_state'->'segment_pages', '{}'::jsonb)) as t(k, v)
      )
    ) || jsonb_build_object('updated_by_note', 'adzuna_cursor_reset_2026_07_28'),
    updated_at = now()
where code = 'adzuna_api';

commit;
