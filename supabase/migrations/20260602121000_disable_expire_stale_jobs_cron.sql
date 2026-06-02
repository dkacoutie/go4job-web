-- Permanently neutralize the unsafe stale-expiration cron path.
-- The previous implementation expired jobs from stale timestamps without respecting future expires_at.

create or replace function private.cron_expire_stale_jobs(p_default_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path to 'private', 'public', 'extensions'
as $func$
begin
  return jsonb_build_object(
    'ok', false,
    'disabled', true,
    'reason', 'function_disabled_pending_safe_patch',
    'called_at', now()
  );
end;
$func$;

do $guard$
declare
  v_jobid bigint;
begin
  if to_regclass('cron.job') is not null then
    select jobid
      into v_jobid
    from cron.job
    where jobname = 'jobradar_expire_stale_jobs'
    limit 1;

    if v_jobid is not null then
      perform cron.alter_job(v_jobid, active => false);
    end if;
  end if;
end $guard$;
