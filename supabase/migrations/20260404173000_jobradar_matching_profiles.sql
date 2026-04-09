begin;

create table if not exists public.jobradar_matching_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  desired_role text,
  desired_role_fallback text,
  alert_keywords_raw text[] not null default '{}'::text[],
  alert_keywords_norm text[] not null default '{}'::text[],
  alert_countries text[] not null default '{}'::text[],
  remote_preference text not null default 'any'
    check (remote_preference in ('any', 'remote', 'hybrid', 'onsite')),
  cv_skills text[] not null default '{}'::text[],
  profile_skills text[] not null default '{}'::text[],
  experience_years_profile int,
  experience_years_cv_min int,
  experience_years_cv_max int,
  experience_years_effective int,
  experience_level text,
  employment_types text[] not null default '{}'::text[],
  country_codes_onboarding text[] not null default '{}'::text[],
  work_modes_onboarding text[] not null default '{}'::text[],
  sectors_onboarding text[] not null default '{}'::text[],
  signal_flags jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  source_hash text not null default '',
  profile_version int not null default 1 check (profile_version >= 1),
  schema_version int not null default 1 check (schema_version >= 1),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.jobradar_matching_profiles is
  'Profil de matching JobRadar normalise et versionne. Base shadow backend V1.';
comment on column public.jobradar_matching_profiles.desired_role is
  'Signal fort: role cible explicite issu en priorite de jobradar_onboarding.profile.desiredRole.';
comment on column public.jobradar_matching_profiles.desired_role_fallback is
  'Signal faible: fallback derive du headline quand aucun desired_role fort n est disponible.';
comment on column public.jobradar_matching_profiles.signal_flags is
  'Resume des signaux disponibles et de leur qualite pour debug et fallback.';
comment on column public.jobradar_matching_profiles.source_snapshot is
  'Snapshot JSONB des sources brutes retenues pour reconstruire et expliquer le profil.';
comment on column public.jobradar_matching_profiles.source_hash is
  'Hash stable du snapshot source. Sert a detecter les changements de profil.';

create index if not exists jobradar_matching_profiles_generated_at_idx
  on public.jobradar_matching_profiles (generated_at desc);

create index if not exists jobradar_matching_profiles_source_hash_idx
  on public.jobradar_matching_profiles (source_hash);

create or replace function public.jobradar_matching_profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_jobradar_matching_profiles_set_updated_at on public.jobradar_matching_profiles;

create trigger trg_jobradar_matching_profiles_set_updated_at
before update on public.jobradar_matching_profiles
for each row
execute function public.jobradar_matching_profiles_set_updated_at();

alter table public.jobradar_matching_profiles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jobradar_matching_profiles'
      and policyname = 'jobradar_matching_profiles_select_own'
  ) then
    create policy jobradar_matching_profiles_select_own
      on public.jobradar_matching_profiles
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jobradar_matching_profiles'
      and policyname = 'jobradar_matching_profiles_insert_own'
  ) then
    create policy jobradar_matching_profiles_insert_own
      on public.jobradar_matching_profiles
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jobradar_matching_profiles'
      and policyname = 'jobradar_matching_profiles_update_own'
  ) then
    create policy jobradar_matching_profiles_update_own
      on public.jobradar_matching_profiles
      for update
      using (auth.uid() = user_id);
  end if;
end
$$;

commit;
