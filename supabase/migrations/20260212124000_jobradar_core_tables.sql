-- JobRadar core tables + save_job RPC
-- Idempotent and safe on existing local DB.

-- alerts (user-defined keyword alerts)
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  keywords text[] not null default '{}',
  country text,
  countries text[],
  frequency text not null default 'daily',
  channels text[] not null default '{email}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists alerts_user_id_idx on public.alerts (user_id);

-- applications (user saves/applies to jobs)
create table if not exists public.applications (
  id bigserial primary key,
  user_id uuid not null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  status text not null default 'saved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create index if not exists applications_user_id_idx on public.applications (user_id);
create index if not exists applications_job_id_idx on public.applications (job_id);

-- job_feedback (if missing in earlier migration)
create table if not exists public.job_feedback (
  id bigserial primary key,
  user_id uuid not null,
  job_id uuid not null,
  action text not null,
  created_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create index if not exists job_feedback_user_id_idx on public.job_feedback (user_id);
create index if not exists job_feedback_job_id_idx on public.job_feedback (job_id);

-- save_job RPC used by the frontend
create or replace function public.save_job(p_job_id uuid)
returns table (status text)
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.applications (user_id, job_id, status)
  values (v_user, p_job_id, 'saved')
  on conflict (user_id, job_id)
  do update set status = excluded.status,
                updated_at = now();

  return query select 'saved'::text as status;
end;
$$;
