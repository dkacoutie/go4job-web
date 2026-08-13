-- Bataille prioritaire #1 de l'audit du 12/08/2026 : plafond dur de 24
-- offres par page de listing, sans pagination, sur /offres et les 8 pages
-- pays/ville. Decision produit prise avec le porteur du projet (13/08/2026) :
-- pagination BORNEE plutot qu'illimitee -- /offres et les pages pays/ville
-- restent un aper�u qui pousse a la creation de compte (pas d'acces gratuit
-- a la totalite du catalogue), mais le maillage interne et le parcours
-- passent de 24 a 240 offres (10 pages de 24) au lieu d'etre bloques a 24.
-- La decouverte des 353k pages d'offres individuelles reste de toute fa�on
-- assuree independamment par le sitemap dynamique (deploye plus tot cette
-- nuit), donc cette pagination sert le maillage/UX, pas la decouvrabilite
-- brute.
--
-- p_page est borne cote serveur a [1, 10] (jamais confiance au client) --
-- 10 * 24 = 240, la fenetre validee. Au-dela, la fonction retourne
-- simplement la derniere page autorisee plutot qu'une erreur.
--
-- Perf verifiee en EXPLAIN ANALYZE avant application (page 10, le cas le
-- plus profond) :
-- - jobradar_public_jobs_preview (global, sans filtre pays) : necessitait
--   un nouvel index, voir 20260813050000_jr_seo_fix_public_preview_timeout.sql
--   (deploye juste avant celle-ci, root cause d'un 500 deja en production
--   sur /offres independamment de la pagination) -- 21s -> 0,2ms.
-- - jobradar_public_jobs_by_location (France, le pays le plus volumineux) :
--   40ms a la page 10 -- l'echantillon interne de 3000 lignes (deja en place
--   depuis le hotfix du 13/08 matin) suffit largement a couvrir la fenetre
--   de pagination sans changement d'index supplementaire.
--
-- DROP FUNCTION necessaire (pas CREATE OR REPLACE seul) : l'ajout de p_page
-- change la signature (nombre de parametres), donc "or replace" creerait un
-- second overload ambigu au lieu de remplacer l'existant.

begin;

drop function if exists public.jobradar_public_jobs_preview(int);

create function public.jobradar_public_jobs_preview(
  p_limit int default 24,
  p_page int default 1
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
  limit least(greatest(coalesce(p_limit, 24), 1), 24)
  offset (least(greatest(coalesce(p_page, 1), 1), 10) - 1) * least(greatest(coalesce(p_limit, 24), 1), 24);
$$;

revoke all on function public.jobradar_public_jobs_preview(int, int) from public;
grant execute on function public.jobradar_public_jobs_preview(int, int) to anon, authenticated;

drop function if exists public.jobradar_public_jobs_by_location(text[], text, int);

create function public.jobradar_public_jobs_by_location(
  p_countries text[] default null,
  p_location_pattern text default null,
  p_limit int default 24,
  p_page int default 1
)
returns table (
  id uuid, title text, company_name text, location text, country_codes text[],
  remote_type text, contract_type text, seniority text, salary_min numeric,
  salary_max numeric, salary_currency text, salary_period text, job_family text,
  posted_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  select t.id, t.title, t.company_name, t.location, t.country_codes, t.remote_type,
         t.contract_type, t.seniority, t.salary_min, t.salary_max, t.salary_currency,
         t.salary_period, t.job_family, t.posted_at
  from (
    select j.*
    from jobs j
    where j.is_active = true
      and j.is_expired = false
      and (j.quality_status = 'ok' or j.quality_status is null)
      and (p_countries is null or j.country = any(p_countries))
      and (p_location_pattern is null or j.location ilike p_location_pattern)
    limit 3000
  ) t
  order by coalesce(t.sort_at, t.posted_at, t.created_at) desc
  limit least(greatest(coalesce(p_limit, 24), 1), 24)
  offset (least(greatest(coalesce(p_page, 1), 1), 10) - 1) * least(greatest(coalesce(p_limit, 24), 1), 24);
end;
$$;

revoke all on function public.jobradar_public_jobs_by_location(text[], text, int, int) from public;
grant execute on function public.jobradar_public_jobs_by_location(text[], text, int, int) to anon, authenticated;

commit;
