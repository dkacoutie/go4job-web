-- Cron AEJ CI maintenance front-pages.
--
-- AEJ CI est volontairement separe du cron Afrique existant.
-- Ce job ne parcourt que les premieres pages de maintenance reguliere
-- (sans pagination de backfill) afin de verifier et rafraichir les offres recentes.

begin;

do $$
declare
  v_jobid int;
begin
  -- En local ou sur un environnement sans pg_cron, ne rien faire.
  if to_regclass('cron.job') is not null then
    -- Idempotence : remplacer uniquement le job AEJ du meme nom.
    select jobid into v_jobid
    from cron.job
    where jobname = 'jobradar-aej-ci-ingest-12h'
    limit 1;

    if v_jobid is not null then
      perform cron.unschedule(v_jobid);
    end if;

    -- Frequence : toutes les 12 heures, decalee du cron CI existant
    -- jobradar-ci-ingest-8h ('0 */8 * * *').
    -- Auth Edge Function :
    -- - x-cron-secret utilise private.app_secrets.key = 'CRON_SECRET'
    -- - Authorization utilise vault.decrypted_secrets.name = 'supabase_service_role_key'
    perform cron.schedule(
      'jobradar-aej-ci-ingest-12h',
      '0 7,19 * * *',
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
          'source_code', 'aej_ci',
          'limit', 50,
          'max_pages', 2,
          'delay_ms', 2000,
          'dry_run', false,
          'allow_import', true,
          'confirm', 'IMPORT_AEJ_CI_V2',
          'trigger', 'cron',
          'run_kind', 'maintenance'
        ),
        timeout_milliseconds := 120000
      );
      $cmd$
    );
  end if;
end;
$$;

commit;
