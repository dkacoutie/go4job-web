-- Phase 1: zero "column does not exist" + core tables for JobRadar
-- Idempotent and safe on existing local DB.

-- 1) Jobs: ensure composite unique for upserts (job_source_id, external_id)
do $$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'jobs_external_id_uq'
  ) then
    execute 'drop index if exists public.jobs_external_id_uq';
  end if;
end $$;

create unique index if not exists jobs_job_source_external_id_uq
  on public.jobs (job_source_id, external_id);

-- 2) Applications: columns used by UI
alter table public.applications
  add column if not exists submitted_at timestamptz,
  add column if not exists error_message text;

-- 3) Job feedback: add action used by UI (dismissed / up / down)
alter table public.job_feedback
  add column if not exists action text;

-- 4) Profiles (used by UI + admin checks)
create table if not exists public.profiles (
  user_id uuid primary key,
  full_name text,
  phone text,
  location text,
  headline text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5) Admin users (fallback for admin checks)
create table if not exists public.admin_users (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

-- 6) User CVs (used by MyCvPage)
create table if not exists public.user_cvs (
  id bigserial primary key,
  user_id uuid not null,
  label text,
  cv_text text,
  cv_json jsonb,
  skills text[],
  contact jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_cvs_user_id_idx on public.user_cvs (user_id);
create unique index if not exists user_cvs_active_uq on public.user_cvs (user_id) where is_active is true;

-- 7) RLS minimal (own data only)
alter table public.profiles enable row level security;
alter table public.alerts enable row level security;
alter table public.applications enable row level security;
alter table public.job_feedback enable row level security;
alter table public.user_cvs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_select_own'
  ) then
    execute 'create policy profiles_select_own on public.profiles for select using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_insert_own'
  ) then
    execute 'create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_update_own'
  ) then
    execute 'create policy profiles_update_own on public.profiles for update using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='alerts' and policyname='alerts_select_own'
  ) then
    execute 'create policy alerts_select_own on public.alerts for select using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='alerts' and policyname='alerts_insert_own'
  ) then
    execute 'create policy alerts_insert_own on public.alerts for insert with check (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='alerts' and policyname='alerts_update_own'
  ) then
    execute 'create policy alerts_update_own on public.alerts for update using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='alerts' and policyname='alerts_delete_own'
  ) then
    execute 'create policy alerts_delete_own on public.alerts for delete using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_select_own'
  ) then
    execute 'create policy applications_select_own on public.applications for select using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_insert_own'
  ) then
    execute 'create policy applications_insert_own on public.applications for insert with check (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_update_own'
  ) then
    execute 'create policy applications_update_own on public.applications for update using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_delete_own'
  ) then
    execute 'create policy applications_delete_own on public.applications for delete using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='job_feedback' and policyname='job_feedback_select_own'
  ) then
    execute 'create policy job_feedback_select_own on public.job_feedback for select using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='job_feedback' and policyname='job_feedback_insert_own'
  ) then
    execute 'create policy job_feedback_insert_own on public.job_feedback for insert with check (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='job_feedback' and policyname='job_feedback_update_own'
  ) then
    execute 'create policy job_feedback_update_own on public.job_feedback for update using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='job_feedback' and policyname='job_feedback_delete_own'
  ) then
    execute 'create policy job_feedback_delete_own on public.job_feedback for delete using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_cvs' and policyname='user_cvs_select_own'
  ) then
    execute 'create policy user_cvs_select_own on public.user_cvs for select using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_cvs' and policyname='user_cvs_insert_own'
  ) then
    execute 'create policy user_cvs_insert_own on public.user_cvs for insert with check (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_cvs' and policyname='user_cvs_update_own'
  ) then
    execute 'create policy user_cvs_update_own on public.user_cvs for update using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_cvs' and policyname='user_cvs_delete_own'
  ) then
    execute 'create policy user_cvs_delete_own on public.user_cvs for delete using (auth.uid() = user_id)';
  end if;
end $$;
