-- JR-0135 : pages publiques pays/ville (teaser SEO, ex. /offres/cote-divoire, /offres/abidjan).
--
-- Même famille de sécurité que jobradar_public_jobs_preview (20260724060000) et
-- jobradar_public_job_detail (20260811090000) : pas de GRANT direct sur jobs à anon,
-- fonctions SECURITY DEFINER volontairement restreintes à des colonnes "vitrine",
-- échantillon plafonné à 24 lignes, pas de description ni de lien de candidature.
--
-- Filtre par pays (liste exacte de libellés, ex. ARRAY['CI','Côte d''Ivoire']) et,
-- optionnellement, par motif de localisation (ILIKE, ex. '%abidjan%') pour cibler une
-- ville — le champ jobs.location n'est pas normalisé (nombreuses variantes de casse et
-- de quartier), d'où l'usage d'ILIKE plutôt qu'une égalité stricte.

begin;

create or replace function public.jobradar_public_jobs_by_location(
  p_countries text[] default null,
  p_location_pattern text default null,
  p_limit int default 24
)
returns table (
  id uuid,
  title text,
  company_name text,
  location text,
  country_codes text[],
  remote_type text,
  contract_type text,
  seniority text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period text,
  job_family text,
  posted_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    j.id,
    j.title,
    j.company_name,
    j.location,
    j.country_codes,
    j.remote_type,
    j.contract_type,
    j.seniority,
    j.salary_min,
    j.salary_max,
    j.salary_currency,
    j.salary_period,
    j.job_family,
    j.posted_at
  from jobs j
  where j.is_active = true
    and j.is_expired = false
    and (j.quality_status = 'ok' or j.quality_status is null)
    and (p_countries is null or j.country = any(p_countries))
    and (p_location_pattern is null or j.location ilike p_location_pattern)
  order by coalesce(j.sort_at, j.posted_at, j.created_at) desc
  limit least(greatest(coalesce(p_limit, 24), 1), 24);
$$;

create or replace function public.jobradar_public_jobs_by_location_count(
  p_countries text[] default null,
  p_location_pattern text default null
)
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(*)
  from jobs j
  where j.is_active = true
    and j.is_expired = false
    and (j.quality_status = 'ok' or j.quality_status is null)
    and (p_countries is null or j.country = any(p_countries))
    and (p_location_pattern is null or j.location ilike p_location_pattern);
$$;

revoke all on function public.jobradar_public_jobs_by_location(text[], text, int) from public;
revoke all on function public.jobradar_public_jobs_by_location_count(text[], text) from public;

grant execute on function public.jobradar_public_jobs_by_location(text[], text, int) to anon, authenticated;
grant execute on function public.jobradar_public_jobs_by_location_count(text[], text) to anon, authenticated;

commit;
