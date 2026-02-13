-- Production cron: auto-fill job descriptions via Edge Function
-- Safe: does NOT run locally unless you execute it manually in prod.
-- Requires extensions: pg_cron + pg_net (enabled on Supabase hosted).
-- Stores secrets in Vault to avoid hardcoding.

-- 1) Store secrets (run once)
-- Replace values before running.
-- Example project_url: https://<project-ref>.supabase.co
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_CRON_SECRET', 'cron_secret');

-- 2) Schedule the Edge Function call (every 5 minutes)
select
  cron.schedule(
    'job-enrich-description-5min',
    '*/5 * * * *',
    $$
    select
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/job_enrich_description?limit=5',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        )
      ) as request_id;
    $$
  );

-- 3) Verify job is registered
-- select * from cron.job order by jobid desc;

-- 4) If you need to remove the job:
-- select cron.unschedule('job-enrich-description-5min');
