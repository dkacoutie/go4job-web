begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typnamespace = 'public'::regnamespace
      and typname = 'job_lifecycle_status'
  ) then
    create type public.job_lifecycle_status as enum (
      'pending',
      'active',
      'stale',
      'expired',
      'tombstoned'
    );
  end if;
end $$;

alter table public.jobs
  add column if not exists job_status public.job_lifecycle_status,
  add column if not exists job_status_changed_at timestamptz;

alter table public.jobs
  alter column job_status set default 'active'::public.job_lifecycle_status;

alter table public.jobs
  alter column job_status_changed_at set default now();

update public.jobs
set job_status = case
  when coalesce(is_expired, false) is true then 'expired'::public.job_lifecycle_status
  else 'active'::public.job_lifecycle_status
end
where job_status is null;

update public.jobs
set job_status_changed_at = coalesce(
  job_status_changed_at,
  expires_at,
  last_seen_at,
  updated_at,
  created_at,
  now()
)
where job_status_changed_at is null;

alter table public.jobs
  alter column job_status set not null;

alter table public.jobs
  alter column job_status_changed_at set not null;

create index if not exists jobs_job_status_idx
  on public.jobs (job_status);

create index if not exists jobs_job_status_last_seen_idx
  on public.jobs (job_status, last_seen_at desc);

create index if not exists jobs_job_status_changed_at_idx
  on public.jobs (job_status, job_status_changed_at desc);

create table if not exists public.job_status_transitions (
  id bigserial primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  from_status public.job_lifecycle_status not null,
  to_status public.job_lifecycle_status not null,
  reason text not null,
  triggered_at timestamptz not null default now()
);

create index if not exists job_status_transitions_job_id_triggered_idx
  on public.job_status_transitions (job_id, triggered_at desc);

create index if not exists job_status_transitions_triggered_idx
  on public.job_status_transitions (triggered_at desc);

create or replace function public.jobradar_job_lifecycle_maintenance()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  v_now timestamptz := now();
  v_expired_from_signal int := 0;
  v_staled int := 0;
  v_expired_from_stale int := 0;
  v_legacy_synced int := 0;
begin
  with target as (
    select
      j.id,
      j.job_status as from_status
    from public.jobs j
    where j.job_status <> 'expired'::public.job_lifecycle_status
      and (
        (j.expires_at is not null and j.expires_at < v_now)
        or coalesce(j.is_expired, false) is true
      )
  ),
  upd as (
    update public.jobs j
    set
      job_status = 'expired'::public.job_lifecycle_status,
      job_status_changed_at = v_now,
      is_active = false,
      is_expired = true,
      updated_at = v_now
    from target t
    where j.id = t.id
    returning j.id, t.from_status
  ),
  logged as (
    insert into public.job_status_transitions (
      job_id,
      from_status,
      to_status,
      reason,
      triggered_at
    )
    select
      u.id,
      u.from_status,
      'expired'::public.job_lifecycle_status,
      'expiry_signal',
      v_now
    from upd u
    returning 1
  )
  select count(*) into v_expired_from_signal
  from upd;

  with target as (
    select
      j.id,
      j.job_status as from_status
    from public.jobs j
    where j.job_status = 'active'::public.job_lifecycle_status
      and coalesce(j.is_active, true) is true
      and coalesce(j.is_expired, false) is false
      and coalesce(j.last_seen_at, j.scraped_at, j.updated_at, j.created_at) < v_now - interval '72 hours'
      and exists (
        select 1
        from public.job_source_runs r
        where r.job_source_id = j.job_source_id
          and r.run_kind = 'ingest'
          and coalesce(r.ok, r.status = 'success')
          and coalesce(r.finished_at, r.started_at) >= v_now - interval '24 hours'
      )
  ),
  upd as (
    update public.jobs j
    set
      job_status = 'stale'::public.job_lifecycle_status,
      job_status_changed_at = v_now,
      is_active = true,
      is_expired = false,
      updated_at = v_now
    from target t
    where j.id = t.id
    returning j.id, t.from_status
  ),
  logged as (
    insert into public.job_status_transitions (
      job_id,
      from_status,
      to_status,
      reason,
      triggered_at
    )
    select
      u.id,
      u.from_status,
      'stale'::public.job_lifecycle_status,
      'last_seen_older_than_72h',
      v_now
    from upd u
    returning 1
  )
  select count(*) into v_staled
  from upd;

  with target as (
    select
      j.id,
      j.job_status as from_status
    from public.jobs j
    where j.job_status = 'stale'::public.job_lifecycle_status
      and coalesce(j.job_status_changed_at, j.updated_at, j.created_at) < v_now - interval '7 days'
  ),
  upd as (
    update public.jobs j
    set
      job_status = 'expired'::public.job_lifecycle_status,
      job_status_changed_at = v_now,
      is_active = false,
      is_expired = true,
      updated_at = v_now
    from target t
    where j.id = t.id
    returning j.id, t.from_status
  ),
  logged as (
    insert into public.job_status_transitions (
      job_id,
      from_status,
      to_status,
      reason,
      triggered_at
    )
    select
      u.id,
      u.from_status,
      'expired'::public.job_lifecycle_status,
      'stale_older_than_7d',
      v_now
    from upd u
    returning 1
  )
  select count(*) into v_expired_from_stale
  from upd;

  with synced as (
    update public.jobs j
    set
      is_active = case
        when j.job_status in ('active'::public.job_lifecycle_status, 'stale'::public.job_lifecycle_status)
          then true
        else false
      end,
      is_expired = case
        when j.job_status in ('expired'::public.job_lifecycle_status, 'tombstoned'::public.job_lifecycle_status)
          then true
        else false
      end
    where
      (
        j.job_status in ('active'::public.job_lifecycle_status, 'stale'::public.job_lifecycle_status)
        and (
          j.is_active is distinct from true
          or j.is_expired is distinct from false
        )
      )
      or (
        j.job_status = 'pending'::public.job_lifecycle_status
        and (
          j.is_active is distinct from false
          or j.is_expired is distinct from false
        )
      )
      or (
        j.job_status in ('expired'::public.job_lifecycle_status, 'tombstoned'::public.job_lifecycle_status)
        and (
          j.is_active is distinct from false
          or j.is_expired is distinct from true
        )
      )
    returning 1
  )
  select count(*) into v_legacy_synced
  from synced;

  return jsonb_build_object(
    'ok', true,
    'expired_from_signal', v_expired_from_signal,
    'staled', v_staled,
    'expired_from_stale', v_expired_from_stale,
    'legacy_synced', v_legacy_synced
  );
end;
$func$;

do $guard$
declare
  v_jobid int;
begin
  if to_regclass('cron.job') is not null then
    select jobid into v_jobid
    from cron.job
    where jobname = 'jobradar-job-lifecycle-hourly'
    limit 1;

    if v_jobid is not null then
      perform cron.unschedule(v_jobid);
    end if;

    perform cron.schedule(
      'jobradar-job-lifecycle-hourly',
      '0 * * * *',
      'select public.jobradar_job_lifecycle_maintenance();'
    );
  end if;
end $guard$;

create or replace view public.jobradar_health_view as
select
  now() as as_of,
  (select count(*) from public.job_sources where is_active is true and ingest_status = 'ready') as active_sources,
  (select count(*) from public.job_sources where is_active is false and ingest_status = 'ready') as ready_inactive_sources,
  (select count(*) from public.jobs where is_active is true and is_expired is false) as jobs_active,
  (select count(*) from public.jobs where published_at >= now() - interval '24 hours') as jobs_24h,
  (select count(*) from public.jobs where published_at >= now() - interval '7 days') as jobs_7d,
  (select count(*) from public.jobs where published_at >= now() - interval '30 days') as jobs_30d,
  (select count(*) from public.jobs where desc_updated_at >= now() - interval '24 hours') as enrich_24h,
  (select count(*) from public.job_source_runs where run_kind = 'ingest' and started_at >= now() - interval '24 hours') as ingest_runs_24h,
  (select count(*) from public.job_source_runs where run_kind = 'ingest'
     and coalesce(ok, status = 'success')
     and finished_at >= now() - interval '24 hours') as ingest_success_24h,
  (
    select count(*)
    from public.jobs j
    where j.job_status = 'active'::public.job_lifecycle_status
      and coalesce(j.last_seen_at, j.scraped_at, j.updated_at, j.created_at) < now() - interval '72 hours'
      and exists (
        select 1
        from public.job_source_runs r
        where r.job_source_id = j.job_source_id
          and r.run_kind = 'ingest'
          and coalesce(r.ok, r.status = 'success')
          and coalesce(r.finished_at, r.started_at) >= now() - interval '24 hours'
      )
  ) as zombie_jobs_count,
  (
    select coalesce(
      round((stale_jobs * 100.0) / nullif(visible_jobs, 0), 2),
      0
    )
    from (
      select
        count(*) filter (where job_status = 'stale'::public.job_lifecycle_status)::numeric as stale_jobs,
        count(*) filter (
          where job_status in (
            'active'::public.job_lifecycle_status,
            'stale'::public.job_lifecycle_status
          )
        )::numeric as visible_jobs
      from public.jobs
    ) metrics
  ) as stale_ratio_pct;

commit;
