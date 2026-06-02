-- Persist the JobRadar lifecycle guard already applied manually in production.
-- The lifecycle must never auto-expire an offer while expires_at is still in the future.

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
      and (j.expires_at is null or j.expires_at <= v_now)
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
      and (j.expires_at is null or j.expires_at <= v_now)
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
        when j.job_status = 'pending'::public.job_lifecycle_status
          and (j.expires_at is null or j.expires_at <= v_now)
          then false
        when j.job_status in ('expired'::public.job_lifecycle_status, 'tombstoned'::public.job_lifecycle_status)
          and (j.expires_at is null or j.expires_at <= v_now)
          then false
        else j.is_active
      end,
      is_expired = case
        when j.job_status in ('expired'::public.job_lifecycle_status, 'tombstoned'::public.job_lifecycle_status)
          and (j.expires_at is null or j.expires_at <= v_now)
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
        and (j.expires_at is null or j.expires_at <= v_now)
        and (
          j.is_active is distinct from false
          or j.is_expired is distinct from false
        )
      )
      or (
        j.job_status in ('expired'::public.job_lifecycle_status, 'tombstoned'::public.job_lifecycle_status)
        and (j.expires_at is null or j.expires_at <= v_now)
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
    'guard_future_expires_at', true,
    'expired_from_signal', v_expired_from_signal,
    'staled', v_staled,
    'expired_from_stale', v_expired_from_stale,
    'legacy_synced', v_legacy_synced
  );
end;
$func$;
