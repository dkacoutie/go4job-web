-- Hardening: enrich cron + health view
begin;

-- 1) Health view doit suivre desc_updated_at (pas ai_description_*)
create or replace view public.jobradar_health_view as
select
  now() as as_of,
  (select count(*) from job_sources where is_active is true and ingest_status = 'ready') as active_sources,
  (select count(*) from job_sources where is_active is false and ingest_status = 'ready') as ready_inactive_sources,
  (select count(*) from jobs where is_active is true and is_expired is false) as jobs_active,
  (select count(*) from jobs where published_at >= now() - interval '24 hours') as jobs_24h,
  (select count(*) from jobs where published_at >= now() - interval '7 days') as jobs_7d,
  (select count(*) from jobs where published_at >= now() - interval '30 days') as jobs_30d,
  (select count(*) from jobs where desc_updated_at >= now() - interval '24 hours') as enrich_24h,
  (select count(*) from job_source_runs where run_kind = 'ingest' and started_at >= now() - interval '24 hours') as ingest_runs_24h,
  (select count(*) from job_source_runs where run_kind = 'ingest' and coalesce(ok, status = 'success') and finished_at >= now() - interval '24 hours') as ingest_success_24h;

-- 2) Cron enrich : x-cron-secret + Authorization (JWT)
do $guard$
declare v_jobid int;
begin
  -- Skip if pg_cron is not available (e.g., local without cron schema)
  if to_regclass('cron.job') is not null then
    select jobid into v_jobid from cron.job where jobname = 'job-enrich-description-2min' limit 1;
    if v_jobid is not null then
      perform cron.unschedule(v_jobid);
    end if;

    perform cron.schedule(
      'job-enrich-description-2min',
      '*/2 * * * *',
      $cmd$
      select net.http_post(
        url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/job_enrich_description?limit=10',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select value from private.app_secrets where key = 'CRON_SECRET'),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_service_role_key')
        ),
        timeout_milliseconds := 25000
      );
      $cmd$
    );
  end if;
end;
$guard$;

commit;
