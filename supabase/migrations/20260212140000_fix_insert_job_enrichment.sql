-- Fix ambiguity in insert_job_enrichment (version output vs column)
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
  select coalesce(max(e.version), 0) + 1
    into v_version
  from public.job_enrichments e
  where e.job_id = p_job_id;

  update public.job_enrichments
  set is_latest = false,
      updated_at = now()
  where job_id = p_job_id
    and is_latest = true;

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

  if (p_enrichment->>'experience_years_min') ~ '^\\d+$' then
    v_exp_min := (p_enrichment->>'experience_years_min')::int;
  end if;

  if (p_enrichment->>'experience_years_max') ~ '^\\d+$' then
    v_exp_max := (p_enrichment->>'experience_years_max')::int;
  end if;

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
