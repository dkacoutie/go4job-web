-- JR-0131 : fiche offre publique (teaser SEO / Google for Jobs).
--
-- Même logique de sécurité que jobradar_public_jobs_preview (migration
-- 20260724060000) : pas de GRANT direct sur jobs à anon, une fonction
-- SECURITY DEFINER volontairement restreinte à une seule ligne, avec un
-- extrait de description tronqué (280 caractères) et jamais la description
-- complète, ni official_desc/ai_description en entier, ni apply_url/
-- source_url. Le texte intégral et la candidature restent réservés au
-- compte connecté (JobDetailsPage.tsx, inchangé).

begin;

create or replace function public.jobradar_public_job_detail(p_id uuid)
returns table (
  id uuid,
  title text,
  company_name text,
  location text,
  country text,
  country_codes text[],
  remote_type text,
  contract_type text,
  seniority text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period text,
  job_family text,
  posted_at timestamptz,
  description_excerpt text
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
    j.country,
    j.country_codes,
    j.remote_type,
    j.contract_type,
    j.seniority,
    j.salary_min,
    j.salary_max,
    j.salary_currency,
    j.salary_period,
    j.job_family,
    j.posted_at,
    nullif(
      left(
        regexp_replace(coalesce(j.description_text, j.official_desc, ''), '\s+', ' ', 'g'),
        280
      ),
      ''
    ) as description_excerpt
  from jobs j
  where j.id = p_id
    and j.is_active = true
    and j.is_expired = false
    and (j.quality_status = 'ok' or j.quality_status is null)
  limit 1;
$$;

revoke all on function public.jobradar_public_job_detail(uuid) from public;
grant execute on function public.jobradar_public_job_detail(uuid) to anon, authenticated;

commit;
