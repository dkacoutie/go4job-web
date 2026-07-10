-- Fix broken cron authentication for adzuna_api and france_travail_api.
--
-- Contexte : depuis le 08/07/2026 ~08h, les deux fonctions cron
-- private.cron_ingest_adzuna_api() et private.cron_ingest_france_travail_api()
-- echouent systematiquement en 401 (UNAUTHORIZED_INVALID_JWT_FORMAT) au niveau
-- de la passerelle Supabase Edge Functions, avant meme d'atteindre le code de
-- ingest_source/index.ts. Cause : le header Authorization envoyait
-- 'Bearer ' || CRON_SECRET (private.app_secrets), alors que CRON_SECRET n'est
-- pas un JWT valide -- il est concu pour etre lu via le header custom
-- x-cron-secret par le code applicatif, pas pour authentifier la passerelle.
--
-- Correctif : aligner ces deux fonctions sur le meme pattern que tous les
-- autres crons fonctionnels (ex. jobradar-ci-ingest-8h, jobradar-aej-ci-
-- ingest-12h) : Authorization: Bearer <supabase_service_role_key> (vault),
-- en conservant x-cron-secret: CRON_SECRET pour la verification applicative
-- interne, inchangee.
--
-- Impact avant correctif : ~55h sans aucune collecte sur ces deux sources
-- (habituellement ~600 offres/heure pour adzuna_api, ~1000/heure pour
-- france_travail_api).

begin;

create or replace function private.cron_ingest_adzuna_api()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'vault'
as $function$
declare
  v_secret text;
  v_service_key text;
begin
  select value into v_secret
  from private.app_secrets
  where key = 'CRON_SECRET';

  if v_secret is null or length(v_secret) = 0 then
    raise exception 'CRON_SECRET missing in private.app_secrets';
  end if;

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'supabase_service_role_key';

  if v_service_key is null or length(v_service_key) = 0 then
    raise exception 'supabase_service_role_key missing in vault';
  end if;

  perform net.http_post(
    url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/ingest_source',
    headers := jsonb_build_object(
      'x-cron-secret', v_secret,
      'Authorization', 'Bearer ' || v_service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'source_code', 'adzuna_api',
      'limit', 1000,
      'trigger', 'cron',
      'run_kind', 'ingest'
    ),
    timeout_milliseconds := 180000
  );
end;
$function$;

create or replace function private.cron_ingest_france_travail_api()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'private', 'vault'
as $function$
declare
  v_secret text;
  v_service_key text;
begin
  select value into v_secret
  from private.app_secrets
  where key = 'CRON_SECRET';

  if v_secret is null or length(v_secret) = 0 then
    raise exception 'CRON_SECRET missing in private.app_secrets';
  end if;

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'supabase_service_role_key';

  if v_service_key is null or length(v_service_key) = 0 then
    raise exception 'supabase_service_role_key missing in vault';
  end if;

  perform net.http_post(
    url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/ingest_source',
    headers := jsonb_build_object(
      'x-cron-secret', v_secret,
      'Authorization', 'Bearer ' || v_service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'source_code', 'france_travail_api',
      'limit', 100,
      'trigger', 'cron',
      'run_kind', 'ingest'
    ),
    timeout_milliseconds := 120000
  );
end;
$function$;

commit;
