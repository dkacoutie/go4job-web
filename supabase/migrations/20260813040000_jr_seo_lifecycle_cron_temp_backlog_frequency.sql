-- JR-SEO-audit-20260812 : acceleration temporaire du rattrapage du backlog
-- cree par les 16 jours d'echec du cron jobradar_job_lifecycle_maintenance
-- (voir 20260813010000_jr_seo_fix_lifecycle_cron_batch_timeout.sql pour le
-- diagnostic complet du timeout et la reduction p_batch 15000 -> 1500).
--
-- Constat (13/08/2026, apres la premiere execution automatique reussie a
-- 01:20 UTC, 1500 lignes traitees en 1min45s) : le backlog restant est
-- important -- 150 174 lignes rien que pour l'etape 1 (signal d'expiration
-- explicite). A raison de 1500 lignes/etape/execution horaire, le
-- rattrapage complet prendrait environ 100 heures (~4 jours). Le detail par
-- ligne montre que chaque execution a 1500/etape reste tres en dessous du
-- statement_timeout de 2 minutes (1min45s mesure, marge confortable) --
-- passer a une frequence plus elevee ne change pas la charge par execution,
-- seulement le nombre d'executions par heure.
--
-- Changement : passage de "20 * * * *" (une fois par heure) a
-- "*/15 * * * *" (4 fois par heure), sans toucher a p_batch=1500 deja
-- valide. Chaque execution prend ~1min45s, largement en dessous de
-- l'intervalle de 15 minutes -- aucun risque de chevauchement entre deux
-- executions.
--
-- Effet attendu : ~6000 lignes/heure traitees a l'etape 1 au lieu de 1500,
-- ramenant le rattrapage du backlog actuel a environ 25 heures au lieu de
-- 100.
--
-- TEMPORAIRE : a repasser a "20 * * * *" (cron.alter_job) une fois le
-- backlog resorbe (verifier via le compteur de lignes en attente
-- d'expiration -- voir requete de suivi dans le rapport de mission). Note
-- laissee dans "Ce qui reste ouvert" du rapport pour ne pas l'oublier.
--
-- jamais d'UPDATE direct sur cron.job (proprietaire supabase_admin) --
-- cron.alter_job() uniquement.
begin;

select cron.alter_job(
  job_id := 36,
  schedule := '*/15 * * * *'
);

commit;
