-- Cron canary Projobivoire RSS.
--
-- Cree un cron tres limite pour observer Projobivoire en production
-- sans activer la source et sans import massif.
--
-- Important :
-- - Le job est cree puis force active=false a la fin de la migration.
-- - Activation manuelle uniquement apres verification post-deploy.
-- - Volume borne : limit=15, max_pages=2.
-- - Chemin applicatif dedie : controlled_cron_probe.

begin;

do $$
declare
  v_jobid int;
begin
  -- En local ou sur un environnement sans pg_cron, ne rien faire.
  if to_regclass('cron.job') is not null then
    -- Idempotence : remplacer uniquement le job Projobivoire canary du meme nom.
    select jobid into v_jobid
    from cron.job
    where jobname = 'jobradar-projobivoire-rss-canary-12h'
    limit 1;

    if v_jobid is not null then
      perform cron.unschedule(v_jobid);
    end if;

    -- Frequence canary : 06h00 et 18h00 UTC.
    -- Le job est volontairement desactive apres creation.
    -- Auth Edge Function :
    -- - x-cron-secret utilise private.app_secrets.key = 'CRON_SECRET'
    -- - Authorization utilise vault.decrypted_secrets.name = 'supabase_service_role_key'
    perform cron.schedule(
      'jobradar-projobivoire-rss-canary-12h',
      '0 6,18 * * *',
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
          'source_code', 'projobivoire_rss',
          'dry_run', false,
          'allow_import', true,
          'trigger', 'controlled_cron_probe',
          'run_kind', 'controlled_cron_probe',
          'limit', 15,
          'max_pages', 2
        ),
        timeout_milliseconds := 120000
      );
      $cmd$
    );

    -- Securite : la migration cree le cron mais ne l'active pas.
    update cron.job
    set active = false
    where jobname = 'jobradar-projobivoire-rss-canary-12h';
  end if;
end;
$$;

commit;
