create extension if not exists pgcrypto;

create table if not exists public.job_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),

  job_source_id uuid not null references public.job_sources(id) on delete restrict,
  external_id text not null,

  title text,
  company_name text,

  location text,
  country text,
  remote_type text,

  contract_type text,
  seniority text,

  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period text,

  description_html text,
  description_text text,

  apply_url text,
  source_url text,
  tags text,

  posted_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz,

  scraped_at timestamptz,
  updated_at timestamptz,
  last_seen_at timestamptz,
  sort_at timestamptz,

  is_active boolean not null default true,
  is_expired boolean not null default false,

  job_json jsonb,

  created_at timestamptz not null default now()
);

create unique index if not exists jobs_external_id_uq on public.jobs (external_id);
create index if not exists jobs_job_source_id_idx on public.jobs (job_source_id);
create index if not exists jobs_sort_at_idx on public.jobs (sort_at);
