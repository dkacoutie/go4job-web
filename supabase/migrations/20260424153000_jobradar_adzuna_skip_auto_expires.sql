begin;

create or replace function public.set_job_expires_at()
returns trigger
language plpgsql
as $func$
declare
  v_ttl_days integer;
  v_source_code text;
begin
  if new.expires_at is not null then
    return new;
  end if;

  select js.code, js.ttl_days
    into v_source_code, v_ttl_days
  from public.job_sources js
  where js.id = new.job_source_id;

  -- Adzuna does not expose a reliable supplier expiration date in our payload.
  -- Keep expires_at null for adzuna_api unless the ingest layer provided an
  -- explicit supplier expiration, and let Adzuna freshness/visibility be driven
  -- by lifecycle rules based on publication recency instead of ttl_days.
  if v_source_code = 'adzuna_api' then
    return new;
  end if;

  if v_ttl_days is null then
    return new;
  end if;

  new.expires_at := coalesce(
    new.published_at,
    new.posted_at,
    new.scraped_at,
    new.created_at,
    now()
  ) + make_interval(days => v_ttl_days);

  return new;
end;
$func$;

commit;
