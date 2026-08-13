-- JR-SEO-audit-20260812, suite : jobradar_job_lifecycle_maintenance (cron
-- jobid=36, hourly "20 * * * *") echoue a 100% depuis le 28/07/2026 (539
-- echecs consecutifs constates le 13/08/2026), toujours avec la meme erreur
-- "57014 canceling statement due to statement timeout".
--
-- Diagnostic (lecture seule, EXPLAIN ANALYZE dans begin/rollback, aucune
-- ecriture conservee) :
-- - statement_timeout de la base = 2 min ; le cron s'execute sous le role
--   postgres, sans timeout specifique -- donc 2 min de budget pour l'appel
--   entier de la fonction.
-- - La table jobs porte 40+ index. Les colonnes modifiees par cette fonction
--   (job_status, is_active, is_expired, job_status_changed_at, updated_at)
--   sont couvertes par plusieurs index -> chaque UPDATE est un update
--   non-HOT, qui doit reinserer une entree dans chacun des 40+ index.
-- - Mesure sur 100 lignes reelles (etape 1, expiry_signal) : 779 ms au
--   total, dont seulement 33 ms de scan -- le reste (~7,8 ms/ligne) est la
--   maintenance des index.
-- - p_batch par defaut = 15000, et la fonction enchaine jusqu'a 5 UPDATE
--   sequentiels (chacun plafonne a p_batch) dans un seul appel, donc un
--   seul budget de 2 min pour l'ensemble. 15000 lignes a 7,8 ms/ligne =
--   ~117s rien que pour l'etape 1 -- et un vrai backlog existe (156 125
--   lignes en attente pour l'etape 1 seule au 13/08/2026), donc l'etape 1
--   consomme tres probablement tout son quota a chaque execution.
--
-- Correctif : reduire p_batch par defaut a 1500. Avec la marge mesuree,
-- meme si les 5 etapes tournent a plein regime : 5 x 1500 x 7,8ms ~= 58s,
-- confortablement sous les 2 min. Le backlog se resorbera progressivement
-- sur plusieurs jours au rythme horaire actuel (~104 executions pour
-- ecouler 156k lignes). Aucune autre logique modifiee.
--
-- Non traite ici, note pour plus tard : plusieurs index sur jobs ont un
-- idx_scan proche de 0 depuis toujours (ex. jobs_desc_status_idx, 18 Mo,
-- 0 scan) -- un nettoyage de ces index reduirait structurellement le cout
-- de 7,8 ms/ligne, mais necessite sa propre verification (usage reel,
-- contraintes) et sort du perimetre de ce hotfix.

begin;

create or replace function public.jobradar_job_lifecycle_maintenance(p_batch integer default 1500)
returns jsonb
language plpgsql
as $$
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

  -- 1. Signal d'expiration explicite.
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

  -- 2. Reprise des offres revues dans leur fenetre.
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

  -- 3. active -> stale.
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

  -- 4. stale -> expired, source vivante ou long-stop 60 jours.
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

  -- 5. Booleens legacy, borne aussi.
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

  -- Reste a traiter, pour savoir si le lot suit la cadence.
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
$$;

commit;

-- Rend le batch explicite dans l'appel du cron (au lieu de dependre
-- implicitement du defaut de la fonction), via cron.alter_job() --
-- jamais d'UPDATE direct sur cron.job (proprietaire supabase_admin).
select cron.alter_job(
  job_id := 36,
  command := 'select public.jobradar_job_lifecycle_maintenance(1500);'
);
