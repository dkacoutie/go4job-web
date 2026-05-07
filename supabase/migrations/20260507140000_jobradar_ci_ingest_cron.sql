-- Cron Afrique V2 CI minimal.
-- Scope volontairement limite aux deux sources Cote d'Ivoire validees :
-- - emploi_ci (Educarriere Emploi CI)
-- - emploi_ci__dup__17d5574e (Emploi.ci portail)
--
-- Cette migration programme un job pg_cron dedie qui appelle l'Edge Function
-- ingest_source toutes les 8 heures avec une limite de 200 offres par source.
-- Elle ne modifie pas active/is_active et ne generalise pas aux autres pays.

begin;

do $$
declare
  v_jobid int;
begin
  -- En local ou sur un environnement sans pg_cron, ne rien faire.
  if to_regclass('cron.job') is not null then
    -- Idempotence : remplacer le job s'il existe deja.
    select jobid into v_jobid
    from cron.job
    where jobname = 'jobradar-ci-ingest-8h'
    limit 1;

    if v_jobid is not null then
      perform cron.unschedule(v_jobid);
    end if;

    -- Frequence : toutes les 8 heures.
    -- Auth Edge Function :
    -- - x-cron-secret utilise private.app_secrets.key = 'CRON_SECRET'
    -- - Authorization utilise vault.decrypted_secrets.name = 'supabase_service_role_key'
    perform cron.schedule(
      'jobradar-ci-ingest-8h',
      '0 */8 * * *',
      $cmd$
      -- Source 1 : Educarriere Emploi CI.
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

      -- Source 2 : Emploi.ci portail.
      -- Le garde-fou applicatif reste explicite : allow_import + confirm.
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
          'source_code', 'emploi_ci__dup__17d5574e',
          'limit', 200,
          'dry_run', false,
          'allow_import', true,
          'confirm', 'IMPORT_EMPLOI_CI_PORTAL',
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
