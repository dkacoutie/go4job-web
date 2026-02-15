-- Add description + AI fallback fields for Job Details (idempotent)

-- Scraped/official description
alter table public.jobs
  add column if not exists official_desc text,
  add column if not exists desc_source text,
  add column if not exists desc_quality int,
  add column if not exists desc_updated_at timestamptz,
  add column if not exists desc_last_error text;

-- AI fallback description
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='jobs' and column_name='ai_description_status'
  ) then
    alter table public.jobs add column ai_description_status text;
  end if;
end $$;

alter table public.jobs
  add column if not exists ai_description text,
  add column if not exists ai_description_model text,
  add column if not exists ai_description_updated_at timestamptz,
  add column if not exists ai_description_quality int,
  add column if not exists ai_description_error text;

alter table public.jobs
  alter column ai_description_status set default 'pending';

update public.jobs
set ai_description_status = 'pending'
where ai_description_status is null;

create index if not exists jobs_ai_description_status_idx on public.jobs (ai_description_status);
create index if not exists jobs_desc_source_idx on public.jobs (desc_source);
