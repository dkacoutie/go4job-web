-- Add Projobivoire RSS as an inactive/draft source.
-- Safety:
-- - no cron creation
-- - no import
-- - no jobs write
-- - no job_source_runs write
-- - source remains inactive

insert into public.job_sources (
  code,
  name,
  base_url,
  url,
  country,
  region,
  is_active,
  active,
  ingest_method,
  ingest_status,
  source_type,
  status,
  priority,
  max_job_age_days,
  ttl_days,
  is_api_only,
  notes,
  ingest_config
)
values (
  'projobivoire_rss',
  'Projobivoire RSS',
  'https://projobivoire.com',
  'https://projobivoire.com/jobs/feed/',
  'CI',
  'CI',
  false,
  false,
  'projobivoire_rss',
  'draft',
  'rss',
  'inactive',
  50,
  45,
  30,
  false,
  'Source Projobivoire RSS créée inactive après validation dry-run uniquement. Aucun import réel, aucun cron, aucune activation.',
  jsonb_build_object(
    'mode', 'dry_run_only',
    'rss_url', 'https://projobivoire.com/jobs/feed/',
    'pagination', '?paged=N',
    'safety_note', 'dry_run=false reste bloqué côté ingest_source pour projobivoire_rss',
    'cron_enabled', false,
    'default_limit', 50,
    'import_enabled', false,
    'created_inactive', true,
    'default_max_pages', 5,
    'validated_dry_run_commit', '96c2912'
  )
)
on conflict (code) do nothing;
