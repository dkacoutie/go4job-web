-- Suite du correctif du timeout de recherche (voir migration
-- 20260805150000_jobs_search_trgm_eligible_partial_indexes.sql).
--
-- Les 4 index trigram partiels ajoutés dans la migration précédente
-- suffisent pour certains termes (ex. "project", plan vérifié : coût passé
-- de 2362 à 151) mais pas pour tous. Pour un terme fréquent comme
-- "manager" (~19 000 lignes correspondantes), le planificateur Postgres
-- choisit un plan différent et plus fragile : un parcours de
-- jobs_digest_feed_sort_idx trié par date, en espérant trouver 80 lignes
-- correspondantes avant d'avoir à parcourir tout l'index. Ce choix dépend
-- de la fréquence du terme cherché et n'est pas fiable : reproduit et
-- confirmé en direct sur prod le 05/08/2026 (recherche "chef de projet"
-- toujours en échec après la migration précédente).
--
-- Correctif définitif : une fonction RPC dédiée à la recherche, avec une
-- CTE MATERIALIZED comme barrière d'optimisation. Cela empêche Postgres de
-- fusionner le filtre de recherche avec le ORDER BY/LIMIT externe et de
-- retomber sur le plan fragile ci-dessus : la partie recherche (filtrée par
-- les index trigram) s'exécute et se matérialise intégralement avant le tri
-- final, quel que soit le terme recherché. Vérifié via EXPLAIN sur "manager"
-- avant application : retour au plan BitmapOr sur les index trigram.
--
-- SECURITY INVOKER : la fonction s'exécute avec les droits de l'appelant,
-- donc soumise aux mêmes politiques RLS que l'appel direct .from("jobs")
-- qu'elle remplace. Aucune élévation de privilège. Accès restreint au rôle
-- authenticated (la recherche du fil d'offres n'est utilisée que connecté).

create or replace function public.search_active_jobs(
  search_term text,
  result_limit integer default 80
)
returns table (
  id uuid,
  title text,
  company_name text,
  location text,
  country text,
  remote_type text,
  contract_type text,
  job_family text,
  apply_url text,
  source_url text,
  published_at timestamptz,
  posted_at timestamptz,
  scraped_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  tags text[],
  job_skills text[],
  required_skills text[],
  optional_skills text[],
  experience_years_min integer,
  experience_years_max integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with matched as materialized (
    select
      j.id, j.title, j.company_name, j.location, j.country, j.remote_type,
      j.contract_type, j.job_family, j.apply_url, j.source_url, j.published_at,
      j.posted_at, j.scraped_at, j.created_at, j.updated_at, j.tags, j.job_skills,
      j.required_skills, j.optional_skills, j.experience_years_min, j.experience_years_max
    from public.jobs j
    where j.is_active = true
      and j.is_expired = false
      and j.job_status in ('active', 'stale')
      and (j.quality_status = 'ok' or j.quality_status is null)
      and (
        j.title ilike '%' || search_term || '%'
        or j.company_name ilike '%' || search_term || '%'
        or j.location ilike '%' || search_term || '%'
        or j.country ilike '%' || search_term || '%'
      )
  )
  select *
  from matched
  order by published_at desc nulls last, scraped_at desc nulls last, created_at desc nulls last
  limit greatest(1, least(coalesce(result_limit, 80), 200));
$$;

revoke all on function public.search_active_jobs(text, integer) from public;
revoke all on function public.search_active_jobs(text, integer) from anon;
grant execute on function public.search_active_jobs(text, integer) to authenticated;
