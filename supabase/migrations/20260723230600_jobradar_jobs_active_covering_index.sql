-- Suite de l'audit du 23/07/2026, apres application de la migration
-- 20260723213500 et d'un VACUUM (ANALYZE) manuel sur public.jobs.
--
-- Mesure apres vacuum : les comptages filtres sur (is_active, is_expired) seuls
-- sont tombes de plusieurs secondes a ~200-270 ms (idx_jobs_feed_gate_idx sert
-- un Index Only Scan). Mais deux requetes internes a
-- private.jobradar_admin_health_overview_refresh() restent lentes (14,27 s et
-- 14,29 s mesures par EXPLAIN ANALYZE) car elles ont besoin de lire, pour
-- chaque ligne active, des colonnes qui ne sont pas dans jobs_feed_gate_idx
-- (apply_url, source_url, country) : Postgres doit alors faire un Index Scan
-- classique (pas "Index Only"), donc retourner sur le disque pour chaque ligne
-- ("Buffers: read=94026" / "read=94132" dans les plans mesures).
--
-- Correctif : un index couvrant, limite aux lignes actives et non expirees
-- (~275 000 lignes sur 1,19M, donc rapide a construire et a maintenir), qui
-- inclut les colonnes necessaires pour que ces deux requetes deviennent aussi
-- des Index Only Scan.
--
-- Additif, non destructif, reversible par un simple DROP INDEX.

create index concurrently if not exists idx_jobs_active_feed_covering
  on public.jobs (is_active, is_expired)
  include (country, apply_url, source_url)
  where is_active is true and is_expired is false;
