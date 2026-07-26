-- Corrige une cause probable des echecs systematiques de jobradar_match_feed
-- (500, 8-14s, observes en continu depuis au moins le 24/07/2026).
--
-- Constat (cron.job_run_details + logs postgres, 26/07/2026) : plusieurs
-- crons touchant lourdement la table public.jobs (1.2M lignes) demarrent
-- exactement a la meme minute :
--   - jobid 13 ingest_active_sources            */10 * * * *  -> :00,:10,:20,:30,:40,:50
--   - jobid 55 jobradar_admin_health_overview_refresh */15 * * * * -> :00,:15,:30,:45
--   - jobid 25 jobradar_health_guard            */30 * * * *  -> :00,:30
--   - jobid 5  (nettoyage job_source_runs bloques) */30 * * * * -> :00,:30
--   - jobid 36 jobradar-job-lifecycle-hourly     0 * * * *     -> :00
--
-- A :00 (top de chaque heure), 5 jobs demarrent simultanement, dont 3 qui
-- prennent chacun 10 a 50 secondes en conditions normales (mesure dans les
-- logs : jobradar_admin_health_overview_refresh ~14s, jobradar_health_guard
-- ~12s, jobradar_job_lifecycle_maintenance jusqu'a 54s). A :30, 4 jobs
-- collisionnent. Verifie en reproduisant l'appel reel a jobradar_match_feed
-- au moment precis d'une de ces collisions (cron.job_run_details) : le
-- statement_timeout de la requete interne coincide avec la fenetre de
-- collision.
--
-- Correctif : etaler ces 5 jobs sur des minutes differentes, sans changer
-- leur frequence ni leur logique. Purement une question d'horaire.
-- Non destructif, entierement reversible via cron.alter_job (jamais
-- d'UPDATE direct sur cron.job, conformement a la regle du projet).

begin;

select cron.alter_job(13, schedule := '2-59/10 * * * *');   -- ingest_active_sources : :02,:12,:22,:32,:42,:52
select cron.alter_job(55, schedule := '5-59/15 * * * *');   -- admin_health_overview_refresh : :05,:20,:35,:50
select cron.alter_job(5,  schedule := '8,38 * * * *');       -- nettoyage job_source_runs bloques : :08,:38
select cron.alter_job(25, schedule := '12,42 * * * *');      -- jobradar_health_guard : :12,:42
select cron.alter_job(36, schedule := '20 * * * *');         -- jobradar-job-lifecycle-hourly : :20

commit;
