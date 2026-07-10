-- Reactivation du cron ingest_active_sources (jobid 13).
--
-- Contexte : ce cron orchestre la collecte de ~58 sources RSS/portails
-- (private.cron_ingest_active_sources()), prevu toutes les 10 minutes
-- (*/10 * * * *). Trouve desactive (active=false) lors de l'audit du
-- 10/07/2026 -- cause du gel exacte inconnue (cron.job ne garde pas
-- d'historique), mais la derniere execution reelle remonte au
-- 25/04/2026 ~21h40, interrompue en plein vol (certaines sources en
-- succes, d'autres bloquees en "running" puis auto-cleanees).
--
-- Test manuel du 10/07/2026 16h23 (select private.cron_ingest_active_sources())
-- confirme : 58/58 sources traitees avec succes, volumes coherents avec
-- l'historique d'avant l'arret. Fonction deja saine (utilise le bon pattern
-- d'authentification vault.decrypted_secrets, pas le bug CRON_SECRET/JWT
-- corrige plus tot pour adzuna_api/france_travail_api).
--
-- Reactivation via cron.alter_job() : cron.job appartient a supabase_admin,
-- un UPDATE direct est refuse (42501 permission denied for table job).

begin;

do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.alter_job(13, active => true);
  end if;
end;
$$;

commit;
