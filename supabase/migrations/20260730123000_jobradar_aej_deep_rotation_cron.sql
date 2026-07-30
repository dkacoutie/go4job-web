-- Rotation profonde AEJ CI.
--
-- Le cron existant jobradar-aej-ci-ingest-12h reste volontairement limite aux
-- premieres pages pour la fraicheur. Ce job complementaire parcourt une
-- fenetre profonde via runtime_state.aej_deep_rotation.next_start_page afin de
-- maintenir la couverture globale sans importer toute la pagination en un run.

begin;

do $$
declare
  v_jobid int;
begin
  if to_regclass('cron.job') is not null then
    select jobid into v_jobid
    from cron.job
    where jobname = 'jobradar-aej-ci-deep-rotation'
    limit 1;

    if v_jobid is not null then
      perform cron.unschedule(v_jobid);
    end if;

    perform cron.schedule(
      'jobradar-aej-ci-deep-rotation',
      '30 2 * * *',
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
          'limit', 120,
          'max_pages', 10,
          'delay_ms', 0,
          'dry_run', false,
          'allow_import', true,
          'confirm', 'IMPORT_AEJ_CI_V2',
          'use_runtime_rotation', true,
          'run_kind', 'deep_rotation',
          'trigger', 'cron'
        ),
        timeout_milliseconds := 180000
      );
      $cmd$
    );
  end if;
end;
$$;

commit;
