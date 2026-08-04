-- =============================================================================
-- JobRadar — ReliefWeb API, activation après vérification + cron dédié
--
-- Suite de la migration 20260730240000 (création de reliefweb_api en draft).
-- Depuis :
--
--   1. Dry-run réel post-correctif country_codes : lecture du secret
--      RELIEFWEB_APPNAME confirmée (aucun appname passé en paramètre),
--      country_codes correctement peuplés (BF, NG, GN, CI...).
--   2. Premier import réel (limit 67, tout le catalogue courant sur les 10
--      pays) : inserted=67, updated=0. 64/67 avec country_codes (95,5%),
--      67/67 avec company_name (employeurs réels : Helen Keller
--      International, Danish Refugee Council, OIM, Fairtrade Africa...).
--   3. Second import réel identique : inserted=0, updated=67 — idempotence
--      confirmée, même méthode que les autres sources ajoutées aujourd'hui.
--
-- ReliefWeb couvre 10 pays (Côte d'Ivoire + 9 voisins), pas seulement la CI :
-- source hors du cron jobradar-ci-ingest-8h, cron dédié comme Himalayas
-- (jobid 40), cadence 6h.
-- =============================================================================

begin;

update public.job_sources
set is_active = true,
    active = true,
    ingest_status = 'ready',
    health_status = 'healthy',
    health_status_reason = 'dry_run_and_idempotence_verified_2026_07_30',
    updated_at = now()
where code = 'reliefweb_api';

insert into public.jobradar_health_events(level, code, details)
values (
  'info',
  'reliefweb_api_activated_after_verification',
  jsonb_build_object(
    'dry_run_parsed', 67,
    'first_import_inserted', 67,
    'first_import_country_codes_coverage', '64/67',
    'second_import_inserted', 0,
    'second_import_updated', 67,
    'reason', 'idempotence verified, country_codes fix confirmed, dedicated 6h cron created',
    'at', now()
  )
);

do $$
declare
  v_jobid bigint;
begin
  if to_regclass('cron.job') is not null then
    select jobid into v_jobid
    from cron.job
    where jobname = 'jobradar-reliefweb-api-6h'
    limit 1;

    if v_jobid is not null then
      perform cron.unschedule(v_jobid);
    end if;

    v_jobid := cron.schedule(
      'jobradar-reliefweb-api-6h',
      '0 */6 * * *',
      $cmd$
      select net.http_post(
        url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/ingest_source',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            select value
            from private.app_secrets
            where key = 'CRON_SECRET'
          ),
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'supabase_service_role_key'
          )
        ),
        body := jsonb_build_object(
          'source_code', 'reliefweb_api',
          'dry_run', false,
          'allow_import', true,
          'confirm', 'IMPORT_RELIEFWEB_API',
          'limit', 100,
          'trigger', 'cron',
          'run_kind', 'ingest'
        ),
        timeout_milliseconds := 120000
      );
      $cmd$
    );
  end if;
end;
$$;

commit;
