-- Corrige le timeout intermittent de la recherche par mot-clé sur le fil
-- d'offres (/jobradar/feed?q=...).
--
-- Diagnostic (05/08/2026, EXPLAIN ANALYZE en lecture seule sur prod) :
-- la requête de recherche (buildJobSearchTextAndQualityFilter dans
-- JobRadarFeedPage.tsx) filtre sur is_active/is_expired/job_status ET sur
-- un OU de 4 colonnes en ILIKE (title/company_name/location/country). Le
-- planificateur choisit un BitmapAnd entre les ~424 000 lignes actives de
-- jobs_digest_feed_sort_idx et le petit bitmap trigram des colonnes
-- recherchées. Construire le bitmap des 424 000 lignes coûte ~1,3s à lui
-- seul (lecture disque, cache froid), ce qui dépasse régulièrement le
-- statement_timeout de 8s du rôle "authenticated" (cf. pg_roles.rolconfig)
-- sous charge réelle — d'où les erreurs "Une erreur temporaire est
-- survenue" observées côté utilisateur, qui se résolvent au réessai
-- suivant (quand le cache est chaud ou la charge plus faible).
--
-- Correctif : un index trigram partiel par colonne recherchée, restreint
-- aux lignes déjà éligibles (is_active/is_expired/job_status). Comme
-- l'éligibilité est encodée dans la clause WHERE de l'index lui-même, le
-- planificateur n'a plus besoin d'intersecter avec le grand index pour la
-- prouver : il peut satisfaire toute la condition via le seul bitmap
-- trigram, nettement plus petit.
--
-- Purement additif (CREATE INDEX ... CONCURRENTLY, IF NOT EXISTS) :
-- aucune donnée ni index existant modifié, aucune réécriture de table,
-- verrou minimal (ACCESS SHARE) compatible avec les écritures continues de
-- l'ingestion. Réversible via DROP INDEX CONCURRENTLY IF EXISTS.
--
-- CREATE INDEX CONCURRENTLY ne peut pas s'exécuter dans un bloc de
-- transaction explicite (begin;/commit;) : chaque instruction ci-dessous
-- s'exécute donc dans sa propre transaction implicite, par nécessité
-- technique Postgres, et non par écart à la règle habituelle du projet.

create index concurrently if not exists jobs_title_trgm_eligible_idx
  on public.jobs using gin (title gin_trgm_ops)
  where is_active = true and is_expired = false and job_status in ('active', 'stale');

create index concurrently if not exists jobs_company_name_trgm_eligible_idx
  on public.jobs using gin (company_name gin_trgm_ops)
  where is_active = true and is_expired = false and job_status in ('active', 'stale');

create index concurrently if not exists jobs_location_trgm_eligible_idx
  on public.jobs using gin (location gin_trgm_ops)
  where is_active = true and is_expired = false and job_status in ('active', 'stale');

create index concurrently if not exists jobs_country_trgm_eligible_idx
  on public.jobs using gin (country gin_trgm_ops)
  where is_active = true and is_expired = false and job_status in ('active', 'stale');
