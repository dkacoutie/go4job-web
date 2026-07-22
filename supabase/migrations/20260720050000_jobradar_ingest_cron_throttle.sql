-- Throttle du fan-out de private.cron_ingest_active_sources().
--
-- Diagnostic du 20/07/2026 : depuis la reactivation du cron le 10/07/2026
-- (migration 20260710180000), private.cron_ingest_active_sources() declenche
-- jusqu'a ~58 appels net.http_post() vers ingest_source dans une boucle serree,
-- sans aucun delai entre chaque dispatch. Observe en production : des dizaines
-- de requetes concurrentes vers l'edge function en quelques secondes (jusqu'a
-- 69s d'execution sur l'une d'elles), saturation des connexions Postgres,
-- deadlocks et "canceling statement due to statement timeout" en boucle sur
-- les tables public.jobs / public.job_sources.
--
-- Consequence en cascade : admin_health_v1_overview() (qui scanne ces memes
-- tables) timeout et renvoie une erreur 500 (health_rpc_failed) ; le
-- chargement public des offres echoue pour la meme raison (contention sur
-- public.jobs).
--
-- Fix : espacer chaque dispatch de 3 secondes. Sur ~58 sources actives, le
-- cycle complet dure environ 3 minutes, largement sous la fenetre de 10
-- minutes entre deux executions du cron (*/10 * * * *). Comportement
-- fonctionnel inchange : toutes les sources actives sont toujours ingerees
-- a chaque cycle, seul le rythme de declenchement change. Aucune autre
-- modification du corps de la fonction (copie conforme de la version
-- 20260224135500_jobradar_ingest_cron_jwt_fix.sql, sleep ajoute dans la
-- boucle uniquement).

begin;

create or replace function private.cron_ingest_active_sources()
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'vault'
as $func$
declare
  v_secret text;
  v_jwt text;
  r record;
  v_url text;
  v_body jsonb;
  v_now timestamptz := now();
  v_unsupported int := 0;
  v_api int := 0;
  v_is_first boolean := true;
begin
  select value into v_secret
  from private.app_secrets
  where key = 'CRON_SECRET';

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
  from vault.decrypted_secrets
  where name = 'supabase_service_role_key';

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

  select count(*) into v_unsupported
  from public.job_sources
  where is_active is true
    and ingest_status = 'ready'
    and code is not null
    and lower(code) <> 'remotive'
    and coalesce(lower(ingest_method), '') not in ('rss_generic','rss','aej_html','');

  if v_unsupported > 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'unsupported_ingest_method_active' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('warning', 'unsupported_ingest_method_active', jsonb_build_object('count', v_unsupported));
    end if;
  end if;

  select count(*) into v_api
  from public.job_sources
  where is_active is true
    and ingest_status = 'ready'
    and coalesce(lower(ingest_method), '') = 'api';

  if v_api > 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'api_sources_skipped' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('info', 'api_sources_skipped', jsonb_build_object('count', v_api));
    end if;
  end if;

  for r in
    select distinct on (lower(code))
      lower(code) as code,
      coalesce(lower(ingest_method),'') as ingest_method
    from public.job_sources
    where is_active = true
      and ingest_status = 'ready'
      and coalesce(is_api_only,false) = false
      and code is not null
      and (
        lower(code) = 'remotive'
        or coalesce(lower(ingest_method),'') in ('rss_generic','rss','aej_html','')
      )
    order by lower(code), priority desc, code asc
  loop
    if not v_is_first then
      perform pg_sleep(3);
    end if;
    v_is_first := false;

    if r.code = 'remotive' then
      v_url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/ingest_remotive';
      v_body := jsonb_build_object(
        'limit', 200,
        'trigger', 'cron',
        'run_kind', 'ingest'
      );
    else
      v_url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/ingest_source';
      v_body := jsonb_build_object(
        'source_code', r.code,
        'limit', 50,
        'trigger', 'cron',
        'run_kind', 'ingest'
      );
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
  end loop;
end;
$func$;

commit;
