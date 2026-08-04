-- Reactivation controlee de Go Africa Online CI et Novojob CI.
--
-- Constat du 30/07/2026 :
-- - les connecteurs goafricaonline_ci_portal et novojob_portal existent deja
--   dans ingest_source et repondent en dry-run depuis Supabase ;
-- - ils avaient ete pauses par la revue 48h car aucun cron actif ne les
--   appelait reellement ;
-- - le cron jobradar-ingest-africa-scrapers-6h ne traite pas ingest_method =
--   'scrape', donc le rallumer ne suffirait pas ;
-- - emploi_ci__dup__17d5574e (portail Emploi.ci) renvoie 403 et ne doit plus
--   etre appele par le cron CI tant qu'un acces legitime n'est pas retabli.
--
-- Cette migration reactive les deux sources validees et remplace le cron CI 8h
-- par Educarriere + Go Africa Online CI + Novojob CI. Elle utilise
-- cron.alter_job(), jamais d'UPDATE direct sur cron.job.

begin;

update public.job_sources
set is_active = true,
    active = true,
    status = coalesce(nullif(status, ''), 'ready'),
    ingest_status = 'ready',
    health_status = 'healthy',
    health_status_reason = 'reactivated_after_dry_run_2026_07_30',
    disabled_reason = null,
    disabled_note = null,
    disabled_at = null,
    auto_disabled = false,
    consecutive_failures = 0,
    updated_at = now()
where code in ('goafricaonline_ci_portal', 'novojob_portal');

update public.job_sources
set health_status = 'paused',
    health_status_reason = 'blocked_by_site_403_2026_07_30',
    disabled_reason = 'blocked_by_site_403',
    disabled_note = 'Portail Emploi.ci retire du cron CI : HTTP 403 persistant, sans contournement Cloudflare/CAPTCHA/IP.',
    disabled_at = coalesce(disabled_at, now()),
    updated_at = now()
where code = 'emploi_ci__dup__17d5574e';

do $$
declare
  v_jobid int;
begin
  if to_regclass('cron.job') is not null then
    select jobid into v_jobid
    from cron.job
    where jobname = 'jobradar-ci-ingest-8h'
    limit 1;

    if v_jobid is null then
      raise exception 'cron job jobradar-ci-ingest-8h not found';
    end if;

    perform cron.alter_job(
      v_jobid,
      schedule := '0 */8 * * *',
      active := true,
      command := $cmd$
      -- Source 1 : Educarriere CI.
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
          'source_code', 'emploi_ci',
          'limit', 200,
          'dry_run', false,
          'trigger', 'cron',
          'run_kind', 'ingest'
        ),
        timeout_milliseconds := 120000
      );

      -- Source 2 : Go Africa Online CI.
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
          'source_code', 'goafricaonline_ci_portal',
          'limit', 150,
          'max_pages', 6,
          'dry_run', false,
          'allow_import', true,
          'confirm', 'IMPORT_GOAFRICAONLINE_CI_PORTAL_LIMIT_150',
          'trigger', 'cron',
          'run_kind', 'ingest'
        ),
        timeout_milliseconds := 120000
      );

      -- Source 3 : Novojob CI.
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
          'source_code', 'novojob_portal',
          'limit', 50,
          'dry_run', false,
          'allow_import', true,
          'confirm', 'IMPORT_NOVOJOB_PORTAL',
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

insert into public.jobradar_health_events(level, code, details)
values (
  'info',
  'ci_sources_goafrica_novojob_reactivated',
  jsonb_build_object(
    'sources', jsonb_build_array('goafricaonline_ci_portal', 'novojob_portal'),
    'removed_from_ci_cron', 'emploi_ci__dup__17d5574e',
    'cron', 'jobradar-ci-ingest-8h',
    'at', now()
  )
);

commit;
