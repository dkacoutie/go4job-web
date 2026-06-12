create table if not exists public.cv_ats_leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  email text not null,
  email_normalized text generated always as (lower(trim(email))) stored,
  source text not null default 'cv_ats_landing',
  status text not null default 'captured',
  job_search_status text null,
  utm_source text null,
  utm_medium text null,
  utm_campaign text null,
  utm_content text null,
  utm_term text null,
  meta_fbp text null,
  meta_fbc text null,
  referrer text null,
  user_agent text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_submitted_at timestamptz null,
  submit_count integer not null default 1,
  guide_email_sent_at timestamptz null,
  guide_email_error text null,
  qualification_completed_at timestamptz null,

  constraint cv_ats_leads_status_check check (status = 'captured'),
  constraint cv_ats_leads_submit_count_check check (submit_count >= 1),
  constraint cv_ats_leads_job_search_status_check check (
    job_search_status is null
    or job_search_status in (
      'active_search',
      'new_graduate',
      'employed_better_opportunity',
      'career_change',
      'watching_opportunities'
    )
  )
);

create unique index if not exists cv_ats_leads_email_source_uidx
  on public.cv_ats_leads(email_normalized, source);

create index if not exists cv_ats_leads_created_at_idx
  on public.cv_ats_leads(created_at desc);

create index if not exists cv_ats_leads_source_created_idx
  on public.cv_ats_leads(source, created_at desc);

drop trigger if exists trg_cv_ats_leads_updated_at
  on public.cv_ats_leads;

create trigger trg_cv_ats_leads_updated_at
before update on public.cv_ats_leads
for each row
execute function public.set_updated_at_timestamp();

alter table public.cv_ats_leads enable row level security;

comment on table public.cv_ats_leads is
  'CapCarriere CV ATS guide leads. Frontend access is intentionally through Edge Functions using the service role only.';

comment on column public.cv_ats_leads.status is
  'Reserved for future lifecycle usage. V1 keeps captured only.';
