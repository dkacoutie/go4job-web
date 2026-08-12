-- JR-SEO-audit-20260812 : les fonctions publiques (jobradar_public_jobs_preview,
-- jobradar_public_jobs_by_location, jobradar_public_job_detail) filtrent sur
-- is_active/is_expired/quality_status, mais pas sur expires_at.
--
-- Vérifié par requête SQL en lecture seule le 12/08/2026 : 7019 offres actives
-- (is_active=true, is_expired=false) ont un expires_at déjà dépassé au moment de
-- la requête. Elles restent donc visibles sur les pages publiques et dans le
-- JSON-LD JobPosting (jobPostingSchema.ts) comme si elles étaient toujours
-- ouvertes, alors que leur propre date d'expiration est passée -- cf. mission
-- "une offre expirée ne doit pas rester éternellement présentée comme active"
-- et politique Google JobPosting (validThrough dépassé = offre à retirer).
--
-- Cette migration NE modifie AUCUNE donnée. Elle resserre uniquement le filtre
-- des 3 fonctions publiques déjà en SECURITY DEFINER pour exclure toute ligne
-- dont expires_at est dans le passé, en plus des filtres existants. Correction
-- immédiate côté vitrine ; la cause racine (pourquoi is_expired reste false une
-- fois expires_at dépassé -- cron jobradar_job_lifecycle_maintenance à
-- ré-auditer) reste à traiter séparément, cf. rapport SEO du 12/08/2026.
--
-- PROPOSÉ, PAS ENCORE APPLIQUÉ : en attente de validation avant exécution
-- (apply_migration) sur le projet Supabase de production.

begin;

create or replace function public.jobradar_public_jobs_preview(
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
    j.id, j.title, j.company_name, j.location, j.country_codes, j.remote_type,
    j.contract_type, j.seniority, j.salary_min, j.salary_max, j.salary_currency,
    j.salary_period, j.job_family, j.posted_at
  from jobs j
  where j.is_active = true
    and j.is_expired = false
    and (j.quality_status = 'ok' or j.quality_status is null)
    and (j.expires_at is null or j.expires_at > now())
  order by coalesce(j.sort_at, j.posted_at, j.created_at) desc
  limit least(greatest(coalesce(p_limit, 24), 1), 24);
$$;

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
    j.id, j.title, j.company_name, j.location, j.country_codes, j.remote_type,
    j.contract_type, j.seniority, j.salary_min, j.salary_max, j.salary_currency,
    j.salary_period, j.job_family, j.posted_at
  from jobs j
  where j.is_active = true
    and j.is_expired = false
    and (j.quality_status = 'ok' or j.quality_status is null)
    and (j.expires_at is null or j.expires_at > now())
    and (p_countries is null or j.country = any(p_countries))
    and (p_location_pattern is null or j.location ilike p_location_pattern)
  order by coalesce(j.sort_at, j.posted_at, j.created_at) desc
  limit least(greatest(coalesce(p_limit, 24), 1), 24);
$$;

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
    and (j.expires_at is null or j.expires_at > now())
  limit 1;
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
    and (j.expires_at is null or j.expires_at > now())
    and (p_countries is null or j.country = any(p_countries))
    and (p_location_pattern is null or j.location ilike p_location_pattern);
$$;

commit;
