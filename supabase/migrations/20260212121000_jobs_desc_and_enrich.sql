-- Jobs: description enrichment status + job_enrich snapshot fields
-- Idempotent: safe to run on existing local DB.

alter table public.jobs
  add column if not exists official_desc text,
  add column if not exists desc_status text default 'pending',
  add column if not exists desc_last_error text,
  add column if not exists desc_updated_at timestamptz,
  add column if not exists degree_required text,
  add column if not exists enriched_at timestamptz,
  add column if not exists enrich_version int,
  add column if not exists enrichment_id bigint;

-- Backfill status for existing rows
update public.jobs
set desc_status = case
  when desc_status is not null then desc_status
  when description_text is not null or description_html is not null then 'done'
  else 'pending'
end
where desc_status is null;

create index if not exists jobs_desc_status_idx on public.jobs (desc_status);
