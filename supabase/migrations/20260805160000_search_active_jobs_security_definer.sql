-- Suite et clôture du correctif du timeout de recherche (voir
-- 20260805150000_jobs_search_trgm_eligible_partial_indexes.sql et
-- 20260805153000_search_active_jobs_rpc.sql).
--
-- Root cause trouvée le 05/08/2026 en testant la fonction avec
-- "set role authenticated" (le rôle réel utilisé par PostgREST), au lieu de
-- se fier à execute_sql qui se connecte en tant que postgres (superuser,
-- rolbypassrls=true) : la validation précédente par EXPLAIN était donc
-- invalide pour le chemin de production réel. Voir note de gouvernance
-- ci-dessous.
--
-- Sous le rôle authenticated, la policy RLS jobs_select_active_not_expired
-- (USING (is_active = true AND is_expired = false)) s'ajoute à la requête.
-- PostgreSQL traite les qualifications RLS comme des "security barrier
-- quals" : elles ne peuvent pas être librement fusionnées/réordonnées avec
-- les conditions de la requête pour construire un plan combiné optimal
-- (comportement documenté de Postgres, pas un bug). Résultat observé :
-- quel que soit le remaniement de la requête (CTE MATERIALIZED, UNION par
-- colonne, avec ou sans conditions explicites redondantes), le
-- planificateur refuse d'utiliser les index trigram sous le rôle
-- authenticated et retombe sur un balayage de jobs_feed_gate_idx ou
-- jobs_digest_feed_sort_idx, avec un coût 5 à 20x supérieur (jusqu'à
-- cost=77857 mesuré) et un vrai statement_timeout (8s) en production.
-- Confirmé : la MEME requête, sans RLS (session postgres), choisit
-- correctement un BitmapAnd sur les index trigram (cost=9778).
--
-- Correctif : passer la fonction en SECURITY DEFINER plutôt que SECURITY
-- INVOKER. Ceci retire la fonction du chemin RLS (elle s'exécute avec les
-- droits du propriétaire, qui est superuser/bypassrls), ce qui restaure le
-- plan optimal.
--
-- Analyse de sécurité (pourquoi c'est sûr ici) : la policy RLS qu'on
-- contourne est jobs_select_active_not_expired, dont la condition est
-- USING (is_active = true AND is_expired = false) — une condition globale,
-- identique pour tous les utilisateurs authentifiés, qui ne référence ni
-- auth.uid() ni aucune donnée propre à l'appelant. Elle ne fait donc pas
-- d'isolation par utilisateur : deux utilisateurs authentifiés voient
-- exactement le même ensemble d'offres actives. La fonction reproduit cette
-- même condition en dur dans son propre WHERE (is_active = true and
-- is_expired = false and job_status in ('active','stale')), donc elle ne
-- retourne jamais plus de lignes que ce que RLS aurait autorisé : aucune
-- élévation de privilège, aucune fuite de données. search_path est fixé
-- explicitement (bonne pratique obligatoire pour toute fonction SECURITY
-- DEFINER, empêche le détournement de recherche de schéma). Accès toujours
-- restreint au rôle authenticated (revoke public/anon, grant authenticated
-- uniquement).
--
-- Note de gouvernance (à l'attention du porteur du projet) : en creusant ce
-- bug, j'ai constaté que l'outil execute_sql (MCP Supabase) que j'utilise
-- pour les audits en lecture seule se connecte en tant que postgres
-- (superuser), et non claude_readonly_audit comme prévu par CLAUDE.md. Sans
-- gravité pour ce correctif précis (je m'en suis servi pour diagnostiquer,
-- pas pour modifier), mais ça signifie que mes futurs audits "lecture
-- seule" via cet outil ne sont pas soumis aux mêmes limites que le rôle
-- prévu, et que toute validation par EXPLAIN faite avec cet outil doit être
-- rejouée avec "set role authenticated" pour être représentative de la
-- prod — comme ça a été le cas ici. À corriger côté configuration MCP si
-- vous voulez que l'outil respecte strictement claude_readonly_audit.

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
security definer
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
