-- =============================================================================
-- JobRadar — Cycle de vie des offres : fenêtre adaptative + garde-fou source
-- Incident du 2026-07-28. État final consolidé.
--
-- Contexte
-- --------
-- Le 20/07 à 05:10 UTC, 61 sources sur 70 ont cessé d'être collectées (voir
-- 20260728020000_jobradar_ingest_rotating_batch.sql). Le catalogue frais est
-- tombé de ~230 000 à 41 296 offres. L'audit a révélé trois défauts distincts
-- dans le cycle de vie, corrigés ici.
--
-- Défaut 1 — stale -> expired sans garde-fou de vitalité
--   La règle « périmée depuis 7 jours, on purge » ne vérifiait pas si la
--   source tournait encore. Quand un crawler tombe, ses offres cessent d'être
--   revues et le pipeline les efface. Le système supprimait donc le catalogue
--   à chaque panne de collecte.
--
-- Défaut 2 — aucun chemin de retour stale -> active
--   Sur 2,1 M de transitions enregistrées, zéro stale->active. Une offre revue
--   par sa source restait bloquée en stale.
--
-- Défaut 3 — seuil de fraîcheur figé à 72 h pour toutes les sources
--   France Travail : 147 000 offres, ~11 000 revues par jour, soit un cycle
--   complet de 13 jours. Ses offres partaient forcément en périmé. La fenêtre
--   est désormais dérivée du débit réellement observé.
--
-- Effet mesuré : 41 296 -> 230 551 offres actives.
--
-- Appliqué en production le 2026-07-28 (migrations MCP 20260728004926 à
-- 20260728011555, consolidées dans ce fichier).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Fenêtre de fraîcheur par source, dérivée du débit de crawl observé.
--    fenêtre = 2 x (catalogue / offres revues par jour), bornée à [3 j, ttl_days].
--    Propriété recherchée : si on accélère la collecte, la fenêtre se resserre
--    d'elle-même. Aucun réglage manuel à refaire.
-- -----------------------------------------------------------------------------
create or replace function private.jobradar_source_freshness_window()
returns table (job_source_id uuid, window_days numeric)
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  with thr as (
    select
      j.job_source_id,
      count(*) filter (
        where j.last_seen_at > now() - interval '24 hours'
      )::numeric as seen_24h,
      count(*) filter (
        where j.job_status in ('active'::public.job_lifecycle_status,
                               'stale'::public.job_lifecycle_status)
      )::numeric as catalogue
    from public.jobs j
    where j.job_source_id is not null
    group by j.job_source_id
  )
  select
    t.job_source_id,
    least(
      greatest(
        3.0,
        case
          when t.seen_24h > 0 then (t.catalogue / t.seen_24h) * 2.0
          else 3.0
        end
      ),
      greatest(coalesce(s.ttl_days, 30)::numeric, 3.0)
    ) as window_days
  from thr t
  join public.job_sources s on s.id = t.job_source_id;
$function$;

comment on function private.jobradar_source_freshness_window() is
  'Fenetre de fraicheur par source, derivee du debit de crawl observe. Bornee a [3 jours, ttl_days].';

-- -----------------------------------------------------------------------------
-- 2. Cache persistant : le calcul ci-dessus scanne toute la table jobs
--    (1,24 M lignes). Inutile de le refaire à chaque lot.
--    Rafraîchi par le cron jobradar_refresh_freshness_window (horaire, à :10).
-- -----------------------------------------------------------------------------
create table if not exists private.source_freshness_window (
  job_source_id uuid primary key references public.job_sources(id) on delete cascade,
  window_days numeric not null,
  computed_at timestamptz not null default now()
);

revoke all on private.source_freshness_window from anon, authenticated;

create or replace function private.refresh_source_freshness_window()
returns int
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare v_n int;
begin
  insert into private.source_freshness_window (job_source_id, window_days, computed_at)
  select job_source_id, window_days, now()
  from private.jobradar_source_freshness_window()
  on conflict (job_source_id) do update
    set window_days = excluded.window_days,
        computed_at = excluded.computed_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 3. Rattrapage : un lot borné, appelable en boucle depuis l'extérieur.
--    A servi à restaurer les ~187 000 offres classées à tort en stale par
--    l'ancien seuil figé. Conservé pour tout rattrapage futur.
-- -----------------------------------------------------------------------------
create or replace function private.backfill_recover_batch(p_batch int default 20000)
returns int
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_now timestamptz := now();
  v_done int := 0;
begin
  with target as (
    select j.id, j.job_status as from_status
    from public.jobs j
    join private.source_freshness_window w on w.job_source_id = j.job_source_id
    where j.job_status = 'stale'::public.job_lifecycle_status
      and coalesce(j.last_seen_at, j.scraped_at) >= v_now - (w.window_days * interval '1 day')
      and (j.expires_at is null or j.expires_at > v_now)
    limit p_batch
  ),
  upd as (
    update public.jobs j
    set job_status = 'active'::public.job_lifecycle_status,
        job_status_changed_at = v_now,
        is_active = true, is_expired = false, updated_at = v_now
    from target t where j.id = t.id
    returning j.id, t.from_status
  ),
  logged as (
    insert into public.job_status_transitions (job_id, from_status, to_status, reason, triggered_at)
    select u.id, u.from_status, 'active'::public.job_lifecycle_status, 'backfill_reseen_within_window', v_now
    from upd u returning 1
  )
  select count(*) into v_done from upd;
  return v_done;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 4. Maintenance du cycle de vie.
--    Chaque étape est bornée à un lot de taille fixe : sans cela, un rattrapage
--    massif dépasse le statement_timeout et le cron échoue en silence. C'est
--    exactement le mode de panne corrigé côté ingestion. La fonction doit rester
--    à durée constante, le reste est traité au passage horaire suivant.
-- -----------------------------------------------------------------------------
create or replace function public.jobradar_job_lifecycle_maintenance(p_batch int default 15000)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_now timestamptz := now();
  v_expired_from_signal int := 0;
  v_recovered int := 0;
  v_staled int := 0;
  v_expired_from_stale int := 0;
  v_frozen int := 0;
  v_backlog int := 0;
  v_legacy_synced int := 0;
begin
  -- Sources ayant réussi une ingestion récente. Garde-fou : sans run récent,
  -- l'absence d'une offre dans le flux ne prouve rien.
  create temporary table if not exists tmp_live_sources (id uuid primary key) on commit drop;
  delete from tmp_live_sources;
  insert into tmp_live_sources (id)
  select distinct r.job_source_id
  from public.job_source_runs r
  where r.run_kind = 'ingest'
    and coalesce(r.ok, r.status = 'success')
    and coalesce(r.finished_at, r.started_at) >= v_now - interval '24 hours'
    and r.job_source_id is not null;

  create temporary table if not exists tmp_src_window (
    job_source_id uuid primary key,
    window_days numeric
  ) on commit drop;
  delete from tmp_src_window;
  insert into tmp_src_window (job_source_id, window_days)
  select job_source_id, window_days
  from private.jobradar_source_freshness_window();

  -- 1. Signal d'expiration explicite. Fait autorité quelle que soit la source.
  with target as (
    select j.id, j.job_status as from_status
    from public.jobs j
    where j.job_status <> 'expired'::public.job_lifecycle_status
      and (
        (j.expires_at is not null and j.expires_at < v_now)
        or (coalesce(j.is_expired, false) is true
            and (j.expires_at is null or j.expires_at < v_now))
      )
    limit p_batch
  ),
  upd as (
    update public.jobs j
    set job_status = 'expired'::public.job_lifecycle_status,
        job_status_changed_at = v_now,
        is_active = false, is_expired = true, updated_at = v_now
    from target t where j.id = t.id
    returning j.id, t.from_status
  ),
  logged as (
    insert into public.job_status_transitions (job_id, from_status, to_status, reason, triggered_at)
    select u.id, u.from_status, 'expired'::public.job_lifecycle_status, 'expiry_signal', v_now
    from upd u returning 1
  )
  select count(*) into v_expired_from_signal from upd;

  -- 2. Reprise : offre stale revue par sa source dans sa fenêtre.
  with target as (
    select j.id, j.job_status as from_status
    from public.jobs j
    join tmp_src_window w on w.job_source_id = j.job_source_id
    where j.job_status = 'stale'::public.job_lifecycle_status
      and coalesce(j.last_seen_at, j.scraped_at)
          >= v_now - (w.window_days * interval '1 day')
      and (j.expires_at is null or j.expires_at > v_now)
    limit p_batch
  ),
  upd as (
    update public.jobs j
    set job_status = 'active'::public.job_lifecycle_status,
        job_status_changed_at = v_now,
        is_active = true, is_expired = false, updated_at = v_now
    from target t where j.id = t.id
    returning j.id, t.from_status
  ),
  logged as (
    insert into public.job_status_transitions (job_id, from_status, to_status, reason, triggered_at)
    select u.id, u.from_status, 'active'::public.job_lifecycle_status, 'reseen_within_window', v_now
    from upd u returning 1
  )
  select count(*) into v_recovered from upd;

  -- 3. active -> stale : hors fenêtre, et seulement si la source tourne.
  with target as (
    select j.id, j.job_status as from_status
    from public.jobs j
    join tmp_src_window w on w.job_source_id = j.job_source_id
    where j.job_status = 'active'::public.job_lifecycle_status
      and coalesce(j.is_active, true) is true
      and coalesce(j.is_expired, false) is false
      and coalesce(j.last_seen_at, j.scraped_at, j.updated_at, j.created_at)
          < v_now - (w.window_days * interval '1 day')
      and j.job_source_id in (select id from tmp_live_sources)
    limit p_batch
  ),
  upd as (
    update public.jobs j
    set job_status = 'stale'::public.job_lifecycle_status,
        job_status_changed_at = v_now,
        is_active = true, is_expired = false, updated_at = v_now
    from target t where j.id = t.id
    returning j.id, t.from_status
  ),
  logged as (
    insert into public.job_status_transitions (job_id, from_status, to_status, reason, triggered_at)
    select u.id, u.from_status, 'stale'::public.job_lifecycle_status, 'unseen_beyond_source_window', v_now
    from upd u returning 1
  )
  select count(*) into v_staled from upd;

  -- 4. stale -> expired : source vivante uniquement, ou long-stop 60 jours.
  --    C'est le garde-fou central : on n'efface pas le catalogue parce qu'un
  --    crawler est tombé.
  with target as (
    select
      j.id, j.job_status as from_status,
      case
        when coalesce(j.job_status_changed_at, j.updated_at, j.created_at) < v_now - interval '60 days'
          then 'stale_longstop_60d' else 'stale_older_than_7d'
      end as reason
    from public.jobs j
    where j.job_status = 'stale'::public.job_lifecycle_status
      and coalesce(j.job_status_changed_at, j.updated_at, j.created_at) < v_now - interval '7 days'
      and (j.expires_at is null or j.expires_at < v_now)
      and (
        j.job_source_id in (select id from tmp_live_sources)
        or coalesce(j.job_status_changed_at, j.updated_at, j.created_at) < v_now - interval '60 days'
      )
    limit p_batch
  ),
  upd as (
    update public.jobs j
    set job_status = 'expired'::public.job_lifecycle_status,
        job_status_changed_at = v_now,
        is_active = false, is_expired = true, updated_at = v_now
    from target t where j.id = t.id
    returning j.id, t.from_status, t.reason
  ),
  logged as (
    insert into public.job_status_transitions (job_id, from_status, to_status, reason, triggered_at)
    select u.id, u.from_status, 'expired'::public.job_lifecycle_status, u.reason, v_now
    from upd u returning 1
  )
  select count(*) into v_expired_from_stale from upd;

  -- Offres gelées en stale parce que leur source ne tourne plus : on alerte
  -- au lieu de supprimer.
  select count(*) into v_frozen
  from public.jobs j
  where j.job_status = 'stale'::public.job_lifecycle_status
    and coalesce(j.job_status_changed_at, j.updated_at, j.created_at) < v_now - interval '7 days'
    and j.job_source_id not in (select id from tmp_live_sources);

  if v_frozen > 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'jobs_frozen_dead_source' and created_at > v_now - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'jobs_frozen_dead_source',
              jsonb_build_object('frozen_jobs', v_frozen, 'at', v_now));
    end if;
  end if;

  -- 5. Synchronisation des booléens legacy, bornée également.
  with target as (
    select j.id, j.job_status
    from public.jobs j
    where (
        j.job_status in ('active'::public.job_lifecycle_status, 'stale'::public.job_lifecycle_status)
        and (j.is_active is distinct from true or j.is_expired is distinct from false)
      )
      or (
        j.job_status = 'pending'::public.job_lifecycle_status
        and (j.is_active is distinct from false or j.is_expired is distinct from false)
      )
      or (
        j.job_status in ('expired'::public.job_lifecycle_status, 'tombstoned'::public.job_lifecycle_status)
        and (j.is_active is distinct from false or j.is_expired is distinct from true)
      )
    limit p_batch
  ),
  synced as (
    update public.jobs j
    set is_active = case
          when t.job_status in ('active'::public.job_lifecycle_status, 'stale'::public.job_lifecycle_status)
            then true else false end,
        is_expired = case
          when t.job_status in ('expired'::public.job_lifecycle_status, 'tombstoned'::public.job_lifecycle_status)
            then true else false end
    from target t where j.id = t.id
    returning 1
  )
  select count(*) into v_legacy_synced from synced;

  -- Reste à traiter, pour savoir si le lot suit la cadence.
  select count(*) into v_backlog
  from public.jobs j
  join tmp_src_window w on w.job_source_id = j.job_source_id
  where j.job_status = 'stale'::public.job_lifecycle_status
    and coalesce(j.last_seen_at, j.scraped_at) >= v_now - (w.window_days * interval '1 day')
    and (j.expires_at is null or j.expires_at > v_now);

  return jsonb_build_object(
    'ok', true,
    'batch', p_batch,
    'expired_from_signal', v_expired_from_signal,
    'recovered_reseen', v_recovered,
    'staled', v_staled,
    'expired_from_stale', v_expired_from_stale,
    'frozen_dead_source', v_frozen,
    'recovery_backlog', v_backlog,
    'legacy_synced', v_legacy_synced,
    'adaptive_window', true,
    'guard_dead_source', true
  );
end;
$function$;

commit;
