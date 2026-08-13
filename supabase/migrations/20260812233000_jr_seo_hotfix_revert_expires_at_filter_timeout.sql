-- HOTFIX urgent, meme soiree que 20260812230000 : la condition expires_at
-- ajoutee aux 4 fonctions publiques rendait la requete trop lente pour le
-- statement_timeout de 3s du role anon. Verifie en direct dans le navigateur :
-- /offres/cote-divoire et les pages similaires renvoyaient une erreur 500
-- ("57014 canceling statement due to statement timeout") au lieu d'afficher
-- les offres.
--
-- Retire uniquement la condition expires_at, restaure le comportement exact
-- d'avant la migration 20260812230000 (offres actives non expirees selon
-- is_expired, comme avant). Le probleme des offres actives avec expires_at
-- deja depasse (cron jobradar_job_lifecycle_maintenance en echec, cf. rapport
-- SEO du 12/08/2026) reste reel mais non traite ici -- necessitait une
-- refonte des index et des fonctions, faite dans la migration suivante
-- (20260813000000).

begin;

create or replace function public.jobradar_public_jobs_preview(
  p_limit int default 24
)
returns table (
  id uuid, title text, company_name text, location text, country_codes text[],
  remote_type text, contract_type text, seniority text, salary_min numeric,
  salary_max numeric, salary_currency text, salary_period text, job_family text,
  posted_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    j.id, j.title, j.company_name, j.location, j.country_codes, j.remote_type,
    j.contract_type, j.seniority, j.salary_min, j.salary_max, j.salary_currency,
    j.salary_period, j.job_family, j.posted_at
  from jobs j
  where j.is_active = true
    and j.is_expired = false
    and (j.quality_status = 'ok' or j.quality_status is null)
  order by coalesce(j.sort_at, j.posted_at, j.created_at) desc
  limit least(greatest(coalesce(p_limit, 24), 1), 24);
$$;

create or replace function public.jobradar_public_job_detail(p_id uuid)
returns table (
  id uuid, title text, company_name text, location text, country text,
  country_codes text[], remote_type text, contract_type text, seniority text,
  salary_min numeric, salary_max numeric, salary_currency text, salary_period text,
  job_family text, posted_at timestamptz, description_excerpt text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    j.id, j.title, j.company_name, j.location, j.country, j.country_codes,
    j.remote_type, j.contract_type, j.seniority, j.salary_min, j.salary_max,
    j.salary_currency, j.salary_period, j.job_family, j.posted_at,
    nullif(
      left(regexp_replace(coalesce(j.description_text, j.official_desc, ''), '\s+', ' ', 'g'), 280),
      ''
    ) as description_excerpt
  from jobs j
  where j.id = p_id
    and j.is_active = true
    and j.is_expired = false
    and (j.quality_status = 'ok' or j.quality_status is null)
  limit 1;
$$;

-- jobradar_public_jobs_by_location et jobradar_public_jobs_by_location_count
-- sont egalement revenues a leur comportement sans filtre expires_at ici,
-- mais ont ete re-ecrites une seconde fois dans la migration suivante
-- (passage en plpgsql + bornage des gros volumes) -- pas la peine de les
-- recreer dans un etat intermediaire, la migration suivante part directement
-- de leur definition d'avant le 12/08.

commit;
