-- Add Emploi Senegal portal source for controlled manual imports.
-- This source is intentionally inactive and not cron-enabled.
-- It was first created manually in production on 2026-05-09.

begin;

do $$
begin
  if not exists (
    select 1
    from public.job_sources
    where code = 'emploisenegal_portal'
  ) then
    insert into public.job_sources (
      id,
      code,
      name,
      base_url,
      country,
      is_active,
      active,
      max_job_age_days,
      ttl_days,
      region,
      priority,
      ingest_method,
      is_api_only,
      ingest_config,
      ingest_status,
      auto_disable_enabled,
      auto_disabled,
      disabled_reason,
      disabled_note,
      min_offers_7d,
      volume_window_days,
      grace_days,
      max_consecutive_failures,
      fail_rate_window,
      max_fail_rate_10,
      source_tier,
      health_status,
      health_status_reason,
      created_at,
      updated_at
    )
    values (
      '6775c10b-ca04-4139-968b-0c9ab96b1a68',
      'emploisenegal_portal',
      'Emploi Sénégal',
      'https://www.emploisenegal.com',
      'SN',
      false,
      false,
      45,
      45,
      'WA',
      100,
      'scrape',
      false,
      '{}'::jsonb,
      'ready',
      true,
      true,
      'manual_pilot',
      'Pilote Sénégal créé pour import manuel contrôlé uniquement; aucun cron actif.',
      20,
      7,
      2,
      3,
      10,
      0.5,
      'extended',
      'paused',
      'manual_pilot',
      now(),
      now()
    );
  end if;
end;
$$;

commit;
