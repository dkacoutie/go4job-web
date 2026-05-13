-- Version MyJobMag NG/GH XML feed source registry rows.
-- Idempotent: update existing rows by code, then insert missing rows.
-- Does not touch public.jobs, cron, or historical success timestamps.

begin;

create temp table myjobmag_source_registry_flags on commit drop as
select
  exists (
    select 1 from public.job_sources where code = 'myjobmag_ng_portal'
  ) as ng_existed,
  exists (
    select 1 from public.job_sources where code = 'myjobmag_gh_portal'
  ) as gh_existed;

update public.job_sources
set
  name = 'MyJobMag Nigeria XML Feed',
  base_url = 'https://www.myjobmag.com',
  url = 'https://www.myjobmag.com/jobsxml.xml',
  country = 'NG',
  region = 'WA',
  is_active = false,
  active = false,
  ingest_status = 'ready',
  health_status = 'healthy',
  ingest_method = 'scrape',
  source_tier = 'extended',
  priority = 50,
  ttl_days = 30,
  max_job_age_days = 120,
  ingest_config = jsonb_build_object(
    'country', 'NG',
    'base_url', 'https://www.myjobmag.com',
    'source_kind', 'xml_feed',
    'jobs_feed_url', 'https://www.myjobmag.com/jobsxml.xml',
    'enrichment_feed_url', 'https://www.myjobmag.com/jobsxml_by_categories.xml',
    'source_family', 'myjobmag_xml_feed',
    'dry_run_validated', true,
    'real_import_guarded', true,
    'real_import_confirm', 'IMPORT_MYJOBMAG_NG_PORTAL',
    'max_real_import_limit', 60,
    'recommended_first_import_limit', 50,
    'stale_max_age_days', 120,
    'latest_remote_dry_run_fetched_count', 80,
    'latest_remote_dry_run_enrichment_matched_count', 46
  ),
  updated_at = now()
where code = 'myjobmag_ng_portal';

insert into public.job_sources (
  id,
  code,
  name,
  base_url,
  url,
  country,
  region,
  is_active,
  active,
  ingest_status,
  health_status,
  ingest_method,
  source_tier,
  priority,
  ttl_days,
  max_job_age_days,
  ingest_config,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  'myjobmag_ng_portal',
  'MyJobMag Nigeria XML Feed',
  'https://www.myjobmag.com',
  'https://www.myjobmag.com/jobsxml.xml',
  'NG',
  'WA',
  false,
  false,
  'ready',
  'healthy',
  'scrape',
  'extended',
  50,
  30,
  120,
  jsonb_build_object(
    'country', 'NG',
    'base_url', 'https://www.myjobmag.com',
    'source_kind', 'xml_feed',
    'jobs_feed_url', 'https://www.myjobmag.com/jobsxml.xml',
    'enrichment_feed_url', 'https://www.myjobmag.com/jobsxml_by_categories.xml',
    'source_family', 'myjobmag_xml_feed',
    'dry_run_validated', true,
    'real_import_guarded', true,
    'real_import_confirm', 'IMPORT_MYJOBMAG_NG_PORTAL',
    'max_real_import_limit', 60,
    'recommended_first_import_limit', 50,
    'stale_max_age_days', 120,
    'latest_remote_dry_run_fetched_count', 80,
    'latest_remote_dry_run_enrichment_matched_count', 46
  ),
  now(),
  now()
where not exists (
  select 1
  from public.job_sources
  where code = 'myjobmag_ng_portal'
);

update public.job_sources
set
  name = 'MyJobMag Ghana XML Feed',
  base_url = 'https://www.myjobmagghana.com',
  url = 'https://www.myjobmagghana.com/jobsxml.xml',
  country = 'GH',
  region = 'WA',
  is_active = false,
  active = false,
  ingest_status = 'draft',
  health_status = 'paused',
  ingest_method = 'scrape',
  source_tier = 'extended',
  priority = 90,
  ttl_days = 30,
  max_job_age_days = 120,
  ingest_config = jsonb_build_object(
    'country', 'GH',
    'base_url', 'https://www.myjobmagghana.com',
    'source_kind', 'xml_feed',
    'jobs_feed_url', 'https://www.myjobmagghana.com/jobsxml.xml',
    'enrichment_feed_url', 'https://www.myjobmagghana.com/jobsxml_by_categories.xml',
    'source_family', 'myjobmag_xml_feed',
    'dry_run_validated', true,
    'real_import_guarded', false,
    'watchlist_only', true,
    'stale_max_age_days', 120,
    'latest_remote_dry_run_fetched_count', 1,
    'latest_remote_dry_run_skipped_stale_count', 88
  ),
  updated_at = now()
where code = 'myjobmag_gh_portal';

insert into public.job_sources (
  id,
  code,
  name,
  base_url,
  url,
  country,
  region,
  is_active,
  active,
  ingest_status,
  health_status,
  ingest_method,
  source_tier,
  priority,
  ttl_days,
  max_job_age_days,
  ingest_config,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  'myjobmag_gh_portal',
  'MyJobMag Ghana XML Feed',
  'https://www.myjobmagghana.com',
  'https://www.myjobmagghana.com/jobsxml.xml',
  'GH',
  'WA',
  false,
  false,
  'draft',
  'paused',
  'scrape',
  'extended',
  90,
  30,
  120,
  jsonb_build_object(
    'country', 'GH',
    'base_url', 'https://www.myjobmagghana.com',
    'source_kind', 'xml_feed',
    'jobs_feed_url', 'https://www.myjobmagghana.com/jobsxml.xml',
    'enrichment_feed_url', 'https://www.myjobmagghana.com/jobsxml_by_categories.xml',
    'source_family', 'myjobmag_xml_feed',
    'dry_run_validated', true,
    'real_import_guarded', false,
    'watchlist_only', true,
    'stale_max_age_days', 120,
    'latest_remote_dry_run_fetched_count', 1,
    'latest_remote_dry_run_skipped_stale_count', 88
  ),
  now(),
  now()
where not exists (
  select 1
  from public.job_sources
  where code = 'myjobmag_gh_portal'
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'notes'
  ) then
    execute $sql$
      update public.job_sources
      set notes = case code
        when 'myjobmag_ng_portal' then 'MyJobMag Nigeria XML feed. Dry-run validated. Real import manually gated with allow_import + confirm. No cron.'
        when 'myjobmag_gh_portal' then 'MyJobMag Ghana XML feed. Technically valid but weak fresh stock currently: parsed_count=1, skipped_stale_count=88. Keep watchlist/dry-run only.'
        else notes
      end
      where code in ('myjobmag_ng_portal', 'myjobmag_gh_portal')
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'consecutive_failures'
  ) then
    execute $sql$
      update public.job_sources
      set consecutive_failures = 0
      from myjobmag_source_registry_flags f
      where (
        (code = 'myjobmag_ng_portal' and not f.ng_existed)
        or (code = 'myjobmag_gh_portal' and not f.gh_existed)
      )
    $sql$;
  end if;
end;
$$;

commit;
