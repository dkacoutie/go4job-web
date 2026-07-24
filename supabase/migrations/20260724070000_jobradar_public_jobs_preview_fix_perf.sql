-- Correctif performance : jobradar_public_jobs_preview() (introduite dans
-- 20260724060000) timeout systématiquement en production ("canceling
-- statement due to statement timeout", code 57014), testé en conditions
-- réelles avec la clé anon juste après application de la migration
-- précédente.
--
-- Cause : le ORDER BY coalesce(sort_at, posted_at, created_at) desc combiné
-- au filtre quality_status ne correspond à aucun index existant sur jobs
-- (274 734 lignes actives) — la précédente version forçait un tri complet
-- de la table à chaque appel.
--
-- Correctif : aligner le filtre et le tri de la fonction sur l'index
-- jobs_digest_feed_sort_idx déjà en place et déjà utilisé par le digest
-- existant :
--   CREATE INDEX jobs_digest_feed_sort_idx ON jobs
--     (published_at DESC NULLS LAST, posted_at DESC NULLS LAST,
--      scraped_at DESC NULLS LAST, created_at DESC NULLS LAST)
--   WHERE is_active = true AND (is_expired = false OR is_expired IS NULL)
--     AND job_status IN ('active','stale')
-- Vérifié par EXPLAIN ANALYZE : Index Scan, 1.4 ms d'exécution (vs timeout
-- avant correctif). Aucun nouvel index créé, aucune écriture sur jobs.
-- La colonne quality_status n'est plus filtrée ici (elle ne l'est pas non
-- plus dans le digest existant qui utilise le même index) ; l'aperçu public
-- reste un échantillon de vitrine, pas une source de vérité exhaustive.

begin;

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
    and (j.is_expired = false or j.is_expired is null)
    and j.job_status = any (array['active','stale']::job_lifecycle_status[])
  order by j.published_at desc nulls last,
           j.posted_at desc nulls last,
           j.scraped_at desc nulls last,
           j.created_at desc nulls last
  limit least(greatest(coalesce(p_limit, 24), 1), 24);
$$;

commit;
