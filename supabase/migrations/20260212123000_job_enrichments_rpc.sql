-- Job enrichments table + RPC used by job_enrich edge function
-- Idempotent and safe on existing local DB.

create table if not exists public.job_enrichments (
  id bigserial primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  version int not null default 1,
  is_latest boolean not null default true,
  job_family text,
  job_skills text[],
  required_skills text[],
  optional_skills text[],
  degree_required text,
  experience_years_min int,
  experience_years_max int,
  enrichment jsonb,
  meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_enrichments_job_id_idx on public.job_enrichments (job_id);
create index if not exists job_enrichments_is_latest_idx on public.job_enrichments (is_latest);
create unique index if not exists job_enrichments_latest_uq
  on public.job_enrichments (job_id)
  where is_latest is true;

create or replace function public.insert_job_enrichment(
  p_job_id uuid,
  p_enrichment jsonb,
  p_meta jsonb
)
returns table (enrichment_id bigint, version int)
language plpgsql
as $$
declare
  v_version int;
  v_enrichment_id bigint;
  v_job_skills text[];
  v_required_skills text[];
  v_optional_skills text[];
  v_exp_min int;
  v_exp_max int;
begin
  -- Next version per job
  select coalesce(max(version), 0) + 1
    into v_version
  from public.job_enrichments
  where job_id = p_job_id;

  -- Mark previous latest as not latest
  update public.job_enrichments
  set is_latest = false,
      updated_at = now()
  where job_id = p_job_id
    and is_latest = true;

  -- Extract arrays safely
  if jsonb_typeof(p_enrichment->'job_skills') = 'array' then
    select array_agg(value)
      into v_job_skills
    from jsonb_array_elements_text(p_enrichment->'job_skills') as t(value);
  end if;

  if jsonb_typeof(p_enrichment->'required_skills') = 'array' then
    select array_agg(value)
      into v_required_skills
    from jsonb_array_elements_text(p_enrichment->'required_skills') as t(value);
  end if;

  if jsonb_typeof(p_enrichment->'optional_skills') = 'array' then
    select array_agg(value)
      into v_optional_skills
    from jsonb_array_elements_text(p_enrichment->'optional_skills') as t(value);
  end if;

  -- Extract ints safely
  if (p_enrichment->>'experience_years_min') ~ '^\d+$' then
    v_exp_min := (p_enrichment->>'experience_years_min')::int;
  end if;

  if (p_enrichment->>'experience_years_max') ~ '^\d+$' then
    v_exp_max := (p_enrichment->>'experience_years_max')::int;
  end if;

  -- Insert new enrichment
  insert into public.job_enrichments (
    job_id,
    version,
    is_latest,
    job_family,
    job_skills,
    required_skills,
    optional_skills,
    degree_required,
    experience_years_min,
    experience_years_max,
    enrichment,
    meta
  ) values (
    p_job_id,
    v_version,
    true,
    p_enrichment->>'job_family',
    v_job_skills,
    v_required_skills,
    v_optional_skills,
    p_enrichment->>'degree_required',
    v_exp_min,
    v_exp_max,
    p_enrichment,
    p_meta
  )
  returning id into v_enrichment_id;

  -- Update jobs snapshot
  update public.jobs
  set job_family = p_enrichment->>'job_family',
      job_skills = v_job_skills,
      required_skills = v_required_skills,
      optional_skills = v_optional_skills,
      degree_required = p_enrichment->>'degree_required',
      experience_years_min = v_exp_min,
      experience_years_max = v_exp_max,
      enriched_at = now(),
      enrich_version = v_version,
      enrichment_id = v_enrichment_id
  where id = p_job_id;

  return query select v_enrichment_id, v_version;
end;
$$;
