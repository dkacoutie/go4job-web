-- =============================================================================
-- JobRadar — Cron d'ingestion : rotation par lot de taille fixe
-- Incident du 2026-07-28. État final consolidé.
--
-- Cause racine de l'incident
-- --------------------------
-- private.cron_ingest_active_sources() bouclait sur toutes les sources
-- éligibles avec un pg_sleep(3) entre chacune. Durée d'exécution
-- proportionnelle au nombre de sources : à 60 sources, la boucle réclamait
-- 3 minutes de sommeil et se faisait tuer par le statement_timeout.
--
--   ERROR: canceling statement due to statement timeout
--   CONTEXT: SQL statement "SELECT pg_sleep(3)"
--   PL/pgSQL function cron_ingest_active_sources() line 93 at PERFORM
--
-- 1 105 exécutions échouées sur 14 jours (55 % du cron). Seules survivaient
-- les 9 sources disposant d'un cron dédié. Les 61 autres étaient à l'arrêt
-- depuis le 2026-07-20 05:10 UTC.
--
-- Le pg_sleep était en prime inutile : net.http_post est asynchrone, il met
-- la requête en file et n'espace donc rien.
--
-- Correction
-- ----------
-- Rotation par lot de taille fixe. Chaque passage prend les N sources les
-- moins récemment sollicitées, les met en file, puis s'arrête. Durée constante
-- quel que soit le nombre de sources. Ajouter une source ne coûte rien : la
-- cadence d'appels est fixée par le lot, seul le temps de cycle s'allonge.
--
-- Cadence : cron toutes les 10 min x 16 sources = 96 créneaux/heure.
--
-- Appliqué en production le 2026-07-28.
-- =============================================================================

begin;

-- Curseur de rotation.
alter table public.job_sources
  add column if not exists last_enqueued_at timestamptz;

create index if not exists job_sources_last_enqueued_at_idx
  on public.job_sources (last_enqueued_at nulls first);

-- L'ancienne signature sans argument (returns void) rendrait l'appel
-- private.cron_ingest_active_sources() ambigu face à la nouvelle
-- (p_batch int default 12), et donc le cron jobid 13 inopérant.
drop function if exists private.cron_ingest_active_sources();

create or replace function private.cron_ingest_active_sources(p_batch int default 12)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'vault'
as $function$
declare
  v_secret text;
  v_jwt text;
  r record;
  v_url text;
  v_body jsonb;
  v_now timestamptz := now();
  v_sent int := 0;
  v_eligible int := 0;
  v_starving int := 0;
begin
  select value into v_secret from private.app_secrets where key = 'CRON_SECRET';
  if v_secret is null or length(v_secret) = 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'cron_secret_missing' and created_at > v_now - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'cron_secret_missing', jsonb_build_object('at', v_now));
    end if;
    raise exception 'CRON_SECRET missing in private.app_secrets';
  end if;

  select decrypted_secret into v_jwt
  from vault.decrypted_secrets where name = 'supabase_service_role_key';
  if v_jwt is null or length(v_jwt) = 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'service_role_key_missing' and created_at > v_now - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'service_role_key_missing', jsonb_build_object('at', v_now));
    end if;
    raise exception 'supabase_service_role_key missing in vault.decrypted_secrets';
  end if;

  -- Lot tournant : les sources les moins récemment sollicitées d'abord.
  --
  -- Le distinct on (code) impose que l'ORDER BY commence par code. Trier
  -- directement par last_enqueued_at dans la même clause était donc sans
  -- effet : le lot reprenait toujours les mêmes sources par ordre
  -- alphabétique et les autres n'étaient jamais servies. On déduplique
  -- d'abord, on trie par ancienneté ensuite.
  for r in
    with dedup as (
      select distinct on (lower(s.code))
        s.id,
        lower(s.code) as code,
        s.last_enqueued_at,
        s.priority
      from public.job_sources s
      where s.is_active = true
        and s.ingest_status = 'ready'
        and coalesce(s.is_api_only, false) = false
        and s.code is not null
        and (
          lower(s.code) = 'remotive'
          or coalesce(lower(s.ingest_method), '') in ('rss_generic', 'rss', 'aej_html', '')
        )
      order by lower(s.code), s.priority desc
    )
    select d.id, d.code
    from dedup d
    order by d.last_enqueued_at asc nulls first, d.priority desc
    limit p_batch
  loop
    if r.code = 'remotive' then
      v_url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/ingest_remotive';
      v_body := jsonb_build_object('limit', 200, 'trigger', 'cron', 'run_kind', 'ingest');
    else
      v_url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/ingest_source';
      v_body := jsonb_build_object('source_code', r.code, 'limit', 50,
                                   'trigger', 'cron', 'run_kind', 'ingest');
    end if;

    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'x-cron-secret', v_secret,
        'Authorization', 'Bearer ' || v_jwt,
        'Content-Type', 'application/json'
      ),
      body := v_body,
      timeout_milliseconds := 60000
    );

    update public.job_sources set last_enqueued_at = v_now where id = r.id;
    v_sent := v_sent + 1;
  end loop;

  select count(*) into v_eligible
  from public.job_sources s
  where s.is_active = true and s.ingest_status = 'ready'
    and coalesce(s.is_api_only, false) = false and s.code is not null
    and (lower(s.code) = 'remotive'
         or coalesce(lower(s.ingest_method), '') in ('rss_generic', 'rss', 'aej_html', ''));

  -- Supervision par l'absence. Une source éligible non sollicitée depuis 6 h
  -- signale que le lot ne suit pas la cadence, ou que le cron est cassé.
  -- C'est la contrepartie de la leçon de l'incident : une source jamais
  -- appelée n'échoue jamais, donc surveiller les échecs ne suffit pas.
  select count(*) into v_starving
  from public.job_sources s
  where s.is_active = true and s.ingest_status = 'ready'
    and coalesce(s.is_api_only, false) = false and s.code is not null
    and (lower(s.code) = 'remotive'
         or coalesce(lower(s.ingest_method), '') in ('rss_generic', 'rss', 'aej_html', ''))
    and (s.last_enqueued_at is null or s.last_enqueued_at < v_now - interval '6 hours');

  if v_starving > 0 and v_eligible > 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'ingest_rotation_starving' and created_at > v_now - interval '3 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'ingest_rotation_starving',
              jsonb_build_object('starving', v_starving, 'eligible', v_eligible,
                                 'batch', p_batch, 'at', v_now));
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'enqueued', v_sent, 'batch', p_batch,
    'eligible', v_eligible, 'starving_over_6h', v_starving
  );
end;
$function$;

commit;

-- -----------------------------------------------------------------------------
-- Modifications de planification appliquées séparément (cron.job appartient à
-- supabase_admin, jamais d'UPDATE direct) :
--
--   select cron.alter_job(13, command := $$select private.cron_ingest_active_sources(16);$$);
--   select cron.schedule('jobradar_refresh_freshness_window', '10 * * * *',
--                        $$select private.refresh_source_freshness_window();$$);
--   select cron.alter_job(31, active := true);          -- email d'alerte, était coupé
--   select cron.alter_job(39, schedule := '15,45 * * * *');  -- France Travail, 2x/h
--   select cron.alter_job(40, schedule := '35 * * * *');     -- Himalayas, 6h -> 1h
-- -----------------------------------------------------------------------------
