-- Cron canary MyJobMag Nigeria (myjobmag_ng_portal) et JobWeb Ghana (jobwebghana_portal).
--
-- Meme modele que la migration 20260609220000_add_projobivoire_rss_canary_cron.sql :
-- cree un cron tres limite pour observer chaque source en production
-- sans activer de collecte massive.
--
-- Important :
-- - Chaque job est cree puis force active=false a la fin de la migration.
-- - Activation manuelle uniquement apres verification post-deploy.
-- - Volume borne : limit=20 pour chaque source (plafonds respectifs : 60 pour
--   myjobmag_ng_portal, 50 pour jobwebghana_portal).
-- - Chemin applicatif dedie : controlled_cron_probe.
-- - country_codes est desormais renseigne par le connecteur (fix commit c40ba10) :
--   ce canary sert a verifier que la collecte reelle produit bien ["NG"] / ["GH"]
--   avant d'envisager une activation is_active + cron permanent.

begin;

do $$
declare
  v_jobid bigint;
begin
  -- En local ou sur un environnement sans pg_cron, ne rien faire.
  if to_regclass('cron.job') is not null then

    -- === MyJobMag Nigeria ===
    select jobid into v_jobid
    from cron.job
    where jobname = 'jobradar-myjobmag-ng-portal-canary-12h'
    limit 1;

    if v_jobid is not null then
      perform cron.unschedule(v_jobid);
    end if;

    v_jobid := cron.schedule(
      'jobradar-myjobmag-ng-portal-canary-12h',
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
          'source_code', 'myjobmag_ng_portal',
          'dry_run', false,
          'allow_import', true,
          'confirm', 'IMPORT_MYJOBMAG_NG_PORTAL',
          'trigger', 'controlled_cron_probe',
          'run_kind', 'controlled_cron_probe',
          'limit', 20
        ),
        timeout_milliseconds := 120000
      );
      $cmd$
    );

    -- cron.job appartient a supabase_admin : un UPDATE direct est refuse
    -- (42501 permission denied for table job) au role utilise par le SQL
    -- Editor / la CLI. cron.alter_job() est la fonction officielle pour
    -- changer "active" sans toucher la table.
    perform cron.alter_job(v_jobid, active => false);

    -- === JobWeb Ghana ===
    select jobid into v_jobid
    from cron.job
    where jobname = 'jobradar-jobwebghana-portal-canary-12h'
    limit 1;

    if v_jobid is not null then
      perform cron.unschedule(v_jobid);
    end if;

    v_jobid := cron.schedule(
      'jobradar-jobwebghana-portal-canary-12h',
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
          'source_code', 'jobwebghana_portal',
          'dry_run', false,
          'allow_import', true,
          'confirm', 'IMPORT_JOBWEBGHANA_PORTAL',
          'trigger', 'controlled_cron_probe',
          'run_kind', 'controlled_cron_probe',
          'limit', 20
        ),
        timeout_milliseconds := 120000
      );
      $cmd$
    );

    -- Meme raison que ci-dessus : cron.alter_job() au lieu d'un UPDATE direct.
    perform cron.alter_job(v_jobid, active => false);

  end if;
end;
$$;

commit;
