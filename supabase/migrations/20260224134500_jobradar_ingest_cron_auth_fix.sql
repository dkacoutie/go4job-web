-- Fix cron ingest auth: avoid Authorization header (Invalid JWT) and use x-cron-secret only
create or replace function private.cron_ingest_active_sources()
returns void
language plpgsql
security definer
set search_path to 'public', 'private'
as $func$
declare
  v_secret text;
  r record;
  v_url text;
  v_body jsonb;
  v_now timestamptz := now();
  v_unsupported int := 0;
  v_api int := 0;
begin
  select value into v_secret
  from private.app_secrets
  where key = 'CRON_SECRET';

  if v_secret is null or length(v_secret) = 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'cron_secret_missing' and created_at > v_now - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'cron_secret_missing', jsonb_build_object('at', v_now));
    end if;
    raise exception 'CRON_SECRET missing in private.app_secrets';
  end if;

  select count(*) into v_unsupported
  from public.job_sources
  where is_active is true
    and ingest_status = 'ready'
    and code is not null
    and lower(code) <> 'remotive'
    and coalesce(lower(ingest_method), '') not in ('rss_generic','rss','aej_html','');

  if v_unsupported > 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'unsupported_ingest_method_active' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('warning', 'unsupported_ingest_method_active', jsonb_build_object('count', v_unsupported));
    end if;
  end if;

  select count(*) into v_api
  from public.job_sources
  where is_active is true
    and ingest_status = 'ready'
    and coalesce(lower(ingest_method), '') = 'api';

  if v_api > 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'api_sources_skipped' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('info', 'api_sources_skipped', jsonb_build_object('count', v_api));
    end if;
  end if;

  for r in
    select distinct on (lower(code))
      lower(code) as code,
      coalesce(lower(ingest_method),'') as ingest_method
    from public.job_sources
    where is_active = true
      and ingest_status = 'ready'
      and coalesce(is_api_only,false) = false
      and code is not null
      and (
        lower(code) = 'remotive'
        or coalesce(lower(ingest_method),'') in ('rss_generic','rss','aej_html','')
      )
    order by lower(code), priority desc, code asc
  loop
    if r.code = 'remotive' then
      v_url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/ingest_remotive';
      v_body := jsonb_build_object(
        'limit', 200,
        'trigger', 'cron',
        'run_kind', 'ingest'
      );
    else
      v_url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/ingest_source';
      v_body := jsonb_build_object(
        'source_code', r.code,
        'limit', 50,
        'trigger', 'cron',
        'run_kind', 'ingest'
      );
    end if;

    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'x-cron-secret', v_secret,
        'Content-Type', 'application/json'
      ),
      body := v_body,
      timeout_milliseconds := 60000
    );
  end loop;
end;
$func$;
