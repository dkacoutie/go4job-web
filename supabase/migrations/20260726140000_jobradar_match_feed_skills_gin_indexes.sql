-- Corrige une DEUXIEME cause reelle d'echecs de jobradar_match_feed,
-- decouverte le 26/07/2026 apres coup : le correctif precedent (migration
-- 20260726120000, index trigram sur job_family) ne couvrait que le chemin
-- "role_title" (recherche par titre/poste). Un utilisateur repassant sur le
-- feed avec un compte a profil riche (CV + competences extraites) a
-- redeclenche un 500 en ~8.7-9.5s (constate en direct dans les logs edge
-- function et reproduit via une capture d'ecran DevTools), preuve que le
-- bug n'etait que partiellement corrige.
--
-- Cause racine : fetchJobsByArrayOverlap (supabase/functions/_shared/
-- jobradar_match_core.ts), utilisee pour le chemin "skills_meta", filtre
-- sur required_skills && [...] et optional_skills && [...] (operateur
-- overlap sur colonnes tableau). Seule job_skills avait un index GIN
-- (jobs_job_skills_gin) ; required_skills et optional_skills n'en avaient
-- aucun. Resultat mesure (EXPLAIN ANALYZE, requete exacte avec des termes
-- realistes) : 38 039 ms, scan quasi complet de la table (Index Scan sur
-- jobs_match_feed_sort_idx puis filtre ligne a ligne, 263 356 lignes
-- rejetees) — trois requetes de ce type sont lancees en parallele
-- (required_skills, optional_skills, job_skills) pour tout profil avec CV
-- ou competences renseignees, donc n'importe laquelle des deux premieres
-- suffisait a declencher le timeout.
--
-- Correctif : deux index GIN symetriques a celui deja present sur
-- job_skills. Verifie apres application (meme requete EXPLAIN ANALYZE) :
-- 38 039 ms -> 448 ms sur required_skills. Reteste ensuite en conditions
-- reelles via l'edge function, sur un compte avec CV et competences
-- renseignees (le type de profil qui echouait) : 500/timeout -> 200 OK,
-- generateCandidates passe de (timeout) a 1026 ms.
--
-- CREATE INDEX CONCURRENTLY sur une colonne tableau (~1,2M lignes) prend
-- plus de temps que le timeout de l'outil d'execution SQL utilise pour
-- appliquer cette migration en direct (2 min) : la construction reelle en
-- production a ete faite via un job pg_cron ponctuel (cree puis supprime
-- immediatement apres succes), qui n'a pas cette limite. Cette migration
-- documente et rejoue le meme DDL pour que le depot reste la source de
-- verite ; si tu la rejoues telle quelle sur un environnement ou l'index
-- n'existe pas encore, prevois un peu de temps (build mesure : ~25s par
-- index sur 1,2M lignes au moment de l'ecriture, plus si la table a
-- grossi depuis).
--
-- Non destructif. Aucune donnee modifiee, aucun index existant supprime.
-- Reversible via :
--   drop index concurrently if exists public.jobs_required_skills_gin;
--   drop index concurrently if exists public.jobs_optional_skills_gin;

create index concurrently if not exists jobs_required_skills_gin
  on public.jobs using gin (required_skills);

create index concurrently if not exists jobs_optional_skills_gin
  on public.jobs using gin (optional_skills);
