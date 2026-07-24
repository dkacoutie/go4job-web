-- Corrige un bug de production reproduit et diagnostique le 24/07/2026 :
-- la recherche texte du feed JobRadar (/jobradar/feed) echouait avec
-- "Erreur : Une erreur temporaire est survenue" pour de nombreux termes
-- (ex: "analyst", "comptable"), a la fois pour un compte payant et pour un
-- compte gratuit fraichement cree.
--
-- Cause racine identifiee via EXPLAIN ANALYZE en reproduisant exactement le
-- role d'execution reel (authenticated, RLS active, via
-- set_config('request.jwt.claim.sub', ...) + set local role authenticated) :
--
-- La policy RLS jobs_select_active_not_expired ajoute (is_active = true AND
-- is_expired = false), qui duplique une condition deja presente dans la
-- requete du client (meme predicat, ecrit deux fois par Postgres une fois
-- la policy fusionnee). Cette duplication fait sous-estimer fortement la
-- selectivite combinee (Postgres traite par defaut des predicats repetes
-- comme independants), ce qui pousse le planificateur a choisir
-- jobs_feed_gate_idx (btree sur is_active, is_expired, quality_status, sans
-- ordre de date) au lieu de jobs_digest_feed_sort_idx (trie par date,
-- permet un arret anticipe avec LIMIT). Resultat observe : scan de
-- ~275 000 lignes + tri complet, jusqu'a 13+ secondes d'execution reelle,
-- au-dela du statement_timeout du role authenticated (8s) -> erreur 500
-- "canceling statement due to statement timeout" cote PostgREST, affichee
-- a l'utilisateur comme "Erreur : Une erreur temporaire est survenue".
--
-- Important : ce comportement n'apparaissait PAS lors d'un simple test SQL
-- via un role bypassant RLS (postgres / role d'audit), qui obtient
-- naturellement le bon plan -> d'ou la necessite de rejouer le test dans
-- le contexte exact du role authenticated pour le reproduire.
--
-- Correctif : statistiques etendues (CREATE STATISTICS ... (dependencies))
-- sur (is_active, is_expired, job_status), qui indiquent explicitement au
-- planificateur que ces colonnes sont correlees. Cela restaure une
-- estimation correcte du nombre de lignes et fait a nouveau choisir
-- jobs_digest_feed_sort_idx. Verifie apres application : meme requete
-- (EXPLAIN ANALYZE, role authenticated, RLS active) passee de 13 341 ms a
-- 571 ms ; 5 termes de recherche varies retestes en conditions reelles
-- (fetch direct sur l'API REST production, compte de test gratuit) tous
-- passes de 500/timeout a 200 OK en 397-820 ms.
--
-- Aucune donnee modifiee. Aucun index supprime. Aucune policy RLS
-- modifiee. Reversible via : drop statistics if exists
-- public.jobs_active_expired_status_stats;

begin;

create statistics if not exists public.jobs_active_expired_status_stats (dependencies)
  on is_active, is_expired, job_status
  from public.jobs;

analyze public.jobs;

commit;
