-- CV upload + profile/applications/alerts tables (idempotent)

create extension if not exists pgcrypto;

-- PROFILES
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  location text,
  headline text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists location text,
  add column if not exists headline text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- USER_CVS
create table if not exists public.user_cvs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  cv_text text,
  cv_json jsonb,
  skills text[],
  skills_by_category jsonb,
  contact jsonb,
  file_path text,
  file_name text,
  file_size int,
  mime_type text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_cvs
  add column if not exists label text,
  add column if not exists cv_text text,
  add column if not exists cv_json jsonb,
  add column if not exists skills text[],
  add column if not exists skills_by_category jsonb,
  add column if not exists contact jsonb,
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size int,
  add column if not exists mime_type text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists user_cvs_user_id_idx on public.user_cvs (user_id);
create index if not exists user_cvs_active_idx on public.user_cvs (user_id, is_active);

-- ALERTS
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  keywords text[] not null default '{}'::text[],
  country text,
  countries text[],
  frequency text,
  channels text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.alerts
  add column if not exists name text,
  add column if not exists keywords text[] not null default '{}'::text[],
  add column if not exists country text,
  add column if not exists countries text[],
  add column if not exists frequency text,
  add column if not exists channels text[] not null default '{}'::text[],
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

create index if not exists alerts_user_id_idx on public.alerts (user_id);

-- APPLICATIONS
create table if not exists public.applications (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  status text not null default 'saved',
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  error_message text
);

alter table public.applications
  add column if not exists status text not null default 'saved',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists submitted_at timestamptz,
  add column if not exists error_message text;

create unique index if not exists applications_user_job_uq on public.applications (user_id, job_id);

-- JOB_FEEDBACK: add action column used by feed
alter table public.job_feedback add column if not exists action text;

-- STORAGE BUCKET FOR CVS
insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', false)
on conflict (id) do nothing;

-- RLS: PROFILES
alter table public.profiles enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_select_own'
  ) then
    create policy profiles_select_own on public.profiles for select using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_insert_own'
  ) then
    create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_update_own'
  ) then
    create policy profiles_update_own on public.profiles for update using (auth.uid() = user_id);
  end if;
end $$;

-- RLS: USER_CVS
alter table public.user_cvs enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_cvs' and policyname='user_cvs_select_own'
  ) then
    create policy user_cvs_select_own on public.user_cvs for select using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_cvs' and policyname='user_cvs_insert_own'
  ) then
    create policy user_cvs_insert_own on public.user_cvs for insert with check (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_cvs' and policyname='user_cvs_update_own'
  ) then
    create policy user_cvs_update_own on public.user_cvs for update using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_cvs' and policyname='user_cvs_delete_own'
  ) then
    create policy user_cvs_delete_own on public.user_cvs for delete using (auth.uid() = user_id);
  end if;
end $$;

-- RLS: ALERTS
alter table public.alerts enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='alerts' and policyname='alerts_select_own'
  ) then
    create policy alerts_select_own on public.alerts for select using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='alerts' and policyname='alerts_insert_own'
  ) then
    create policy alerts_insert_own on public.alerts for insert with check (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='alerts' and policyname='alerts_update_own'
  ) then
    create policy alerts_update_own on public.alerts for update using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='alerts' and policyname='alerts_delete_own'
  ) then
    create policy alerts_delete_own on public.alerts for delete using (auth.uid() = user_id);
  end if;
end $$;

-- RLS: APPLICATIONS
alter table public.applications enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_select_own'
  ) then
    create policy applications_select_own on public.applications for select using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_insert_own'
  ) then
    create policy applications_insert_own on public.applications for insert with check (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_update_own'
  ) then
    create policy applications_update_own on public.applications for update using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='applications' and policyname='applications_delete_own'
  ) then
    create policy applications_delete_own on public.applications for delete using (auth.uid() = user_id);
  end if;
end $$;

-- STORAGE RLS (cvs bucket)
alter table storage.objects enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cvs_objects_select_own'
  ) then
    create policy cvs_objects_select_own on storage.objects
      for select using (bucket_id = 'cvs' and owner = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cvs_objects_insert_own'
  ) then
    create policy cvs_objects_insert_own on storage.objects
      for insert with check (bucket_id = 'cvs' and owner = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cvs_objects_update_own'
  ) then
    create policy cvs_objects_update_own on storage.objects
      for update using (bucket_id = 'cvs' and owner = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cvs_objects_delete_own'
  ) then
    create policy cvs_objects_delete_own on storage.objects
      for delete using (bucket_id = 'cvs' and owner = auth.uid());
  end if;
end $$;
