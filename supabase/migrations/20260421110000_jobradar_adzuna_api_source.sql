begin;

insert into public.job_sources
  (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select
  'adzuna_api',
  'Adzuna (API/Partner)',
  'api_adzuna',
  'ready',
  jsonb_build_object(
    'search_url_template', 'https://api.adzuna.com/v1/api/jobs/{country}/search/{page}',
    'default_country', 'fr',
    'fallback_country', 'gb',
    'results_per_page', 10,
    'max_pages', 1,
    'staging_only', true,
    'subset_label', 'staging_small_subset',
    'refresh_hours', 24,
    'default_params', jsonb_build_object()
  ),
  false,
  null,
  'Africa/Global',
  67
where not exists (
  select 1
  from public.job_sources
  where code = 'adzuna_api'
);

update public.job_sources
set
  name = 'Adzuna (API/Partner)',
  ingest_method = 'api_adzuna',
  ingest_status = 'ready',
  ingest_config = jsonb_build_object(
    'search_url_template', 'https://api.adzuna.com/v1/api/jobs/{country}/search/{page}',
    'default_country', 'fr',
    'fallback_country', 'gb',
    'results_per_page', 10,
    'max_pages', 1,
    'staging_only', true,
    'subset_label', 'staging_small_subset',
    'refresh_hours', 24,
    'default_params', jsonb_build_object()
  ),
  is_active = false,
  country = null,
  region = 'Africa/Global',
  priority = 67
where code = 'adzuna_api';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'base_url'
  ) then
    execute $sql$
      update public.job_sources
      set base_url = 'https://api.adzuna.com'
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'url'
  ) then
    execute $sql$
      update public.job_sources
      set url = 'https://www.adzuna.com/'
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'max_job_age_days'
  ) then
    execute $sql$
      update public.job_sources
      set max_job_age_days = 30
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'ttl_days'
  ) then
    execute $sql$
      update public.job_sources
      set ttl_days = 30
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'active'
  ) then
    execute $sql$
      update public.job_sources
      set active = false
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'auto_disable_enabled'
  ) then
    execute $sql$
      update public.job_sources
      set auto_disable_enabled = true
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'auto_disabled'
  ) then
    execute $sql$
      update public.job_sources
      set auto_disabled = false
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'min_offers_7d'
  ) then
    execute $sql$
      update public.job_sources
      set min_offers_7d = 20
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'volume_window_days'
  ) then
    execute $sql$
      update public.job_sources
      set volume_window_days = 7
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'grace_days'
  ) then
    execute $sql$
      update public.job_sources
      set grace_days = 2
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'max_consecutive_failures'
  ) then
    execute $sql$
      update public.job_sources
      set max_consecutive_failures = 3
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'fail_rate_window'
  ) then
    execute $sql$
      update public.job_sources
      set fail_rate_window = 10
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'max_fail_rate_10'
  ) then
    execute $sql$
      update public.job_sources
      set max_fail_rate_10 = 0.5
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'is_api_only'
  ) then
    execute $sql$
      update public.job_sources
      set is_api_only = true
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'notes'
  ) then
    execute $sql$
      update public.job_sources
      set notes = 'Staging only. Adzuna partner API. Seeded for step 2 ingestion wiring. Keep source inactive by default until API flow and dedup validation are ready.'
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'source_tier'
  ) then
    execute $sql$
      update public.job_sources
      set source_tier = 'extended'
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'health_status'
  ) then
    execute $sql$
      update public.job_sources
      set health_status = 'paused'
      where code = 'adzuna_api'
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'health_status_reason'
  ) then
    execute $sql$
      update public.job_sources
      set health_status_reason = 'staging_only_inactive'
      where code = 'adzuna_api'
    $sql$;
  end if;
end
$$;

commit;
