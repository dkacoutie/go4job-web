begin;

insert into public.job_sources
  (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select
  'france_travail_api',
  'France Travail API',
  'api_france_travail',
  'ready',
  jsonb_build_object(
    'search_url', 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search',
    'token_url', 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire',
    'scope', 'api_offresdemploiv2 o2dsoffre',
    'limit', 5,
    'range_step', 5,
    'max_pages', 1,
    'staging_only', true,
    'subset_label', 'staging_small_subset',
    'refresh_hours', 24,
    'search_params', jsonb_build_object()
  ),
  false,
  'France',
  'France',
  69
where not exists (
  select 1
  from public.job_sources
  where code = 'france_travail_api'
);

update public.job_sources
set
  name = 'France Travail API',
  ingest_method = 'api_france_travail',
  ingest_status = 'ready',
  ingest_config = jsonb_build_object(
    'search_url', 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search',
    'token_url', 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire',
    'scope', 'api_offresdemploiv2 o2dsoffre',
    'limit', 5,
    'range_step', 5,
    'max_pages', 1,
    'staging_only', true,
    'subset_label', 'staging_small_subset',
    'refresh_hours', 24,
    'search_params', jsonb_build_object()
  ),
  is_active = false,
  country = 'France',
  region = 'France',
  priority = 69
where code = 'france_travail_api';

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
      set base_url = 'https://api.francetravail.io'
      where code = 'france_travail_api'
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
      set url = 'https://francetravail.io/produits-partages/catalogue/offres-emploi'
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      set notes = 'Staging only. France Travail Offres API. Small subset preview. Keep source inactive by default and validate cross-source dedup before broader activation.'
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
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
      where code = 'france_travail_api'
    $sql$;
  end if;
end
$$;

commit;
