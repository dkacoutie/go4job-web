-- Aperçu public des offres (visiteurs non connectés).
--
-- Contexte : la table public.jobs (274 734 offres actives au 24/07/2026) n'est
-- lisible que par le rôle authenticated (policy jobs_select_active_not_expired).
-- La clé anon n'a aucun GRANT dessus, donc aucun visiteur non connecté ne peut
-- aujourd'hui voir la moindre offre — y compris le compteur affiché sur
-- /landing, qui échoue silencieusement pour un visiteur anonyme et retombe
-- sur le texte générique "Des milliers d'offres disponibles".
--
-- Plutôt que d'ouvrir un GRANT SELECT direct sur jobs à anon (ce qui
-- permettrait d'aspirer en pagination libre la totalité du catalogue agrégé
-- via l'API PostgREST publique), on expose deux fonctions SECURITY DEFINER
-- volontairement restreintes :
--   - jobradar_public_jobs_count() : uniquement un compte agrégé, déjà une
--     donnée affichée publiquement sur la landing page.
--   - jobradar_public_jobs_preview(p_limit) : un échantillon plafonné (24
--     lignes maximum, pas de paramètre offset donc pas de pagination
--     possible) avec uniquement des colonnes "vitrine" (titre, entreprise,
--     localisation, contrat, séniorité, salaire, date). Ni description
--     (description_html/text, official_desc, ai_description), ni apply_url,
--     ni source_url, ni champs internes (dedupe_identity_key,
--     cross_source_fingerprint, job_json, quality_status, etc.) ne sont
--     exposés. La description complète et la candidature restent réservées
--     aux comptes connectés.
--
-- La table jobs elle-même n'est pas modifiée : aucun GRANT ajouté dessus,
-- aucune policy touchée, donc aucun risque de régression sur le flux
-- authentifié existant (/jobradar/feed, /jobradar/jobs/:id).

begin;

create or replace function public.jobradar_public_jobs_count()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(*)
  from jobs
  where is_active = true
    and is_expired = false;
$$;

create or replace function public.jobradar_public_jobs_preview(p_limit int default 24)
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
  order by coalesce(j.sort_at, j.posted_at, j.created_at) desc
  limit least(greatest(coalesce(p_limit, 24), 1), 24);
$$;

revoke all on function public.jobradar_public_jobs_count() from public;
revoke all on function public.jobradar_public_jobs_preview(int) from public;

grant execute on function public.jobradar_public_jobs_count() to anon, authenticated;
grant execute on function public.jobradar_public_jobs_preview(int) to anon, authenticated;

commit;
