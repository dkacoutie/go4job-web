-- Retire l'execution publique de 5 fonctions SECURITY DEFINER qui n'auraient
-- jamais du etre exposees a l'API REST (anon / authenticated).
--
-- Contexte (audit du 23/07/2026, advisors Supabase "security", niveau WARN
-- "anon_security_definer_function_executable") : ces 5 fonctions ont ete
-- creees directement en base (aucune migration versionnee ne les cree --
-- meme travers deja documente pour le schema billing dans MIGRATION_PLAN.md),
-- sans le `revoke all ... from public` + grant selectif applique partout
-- ailleurs dans ce projet. Postgres accorde EXECUTE a PUBLIC par defaut sur
-- une fonction nouvellement creee, donc PostgREST les expose telles quelles
-- sur /rest/v1/rpc/<nom> a n'importe quel appelant, y compris non authentifie.
--
-- Deux autres fonctions du meme rapport d'advisor (`admin_grant_admin_access`,
-- `activate_pass_from_payment`) ont ete verifiees et exclues de cette
-- migration : elles ont deja leur propre garde interne
-- (`auth.role() <> 'service_role' and not is_super_admin()` /
-- `auth.role() <> 'service_role'`) et leur acces `authenticated` est requis
-- par une fonctionnalite legitime (promotion d'admin depuis l'UI). Aucune
-- action necessaire sur ces deux-la.
--
-- 1) public.has_active_pass(p_user_id uuid)
--    Aucune garde interne, accepte n'importe quel p_user_id. Un appelant non
--    authentifie peut interroger le statut d'abonnement de n'importe quel
--    utilisateur (fuite d'information, IDOR). Verifie : uniquement utilisee
--    par supabase/functions/send_digest (deja identifiee comme code mort,
--    plus appelee par aucun cron ni migration -- cf audit du 22/07). Aucun
--    appel depuis le frontend (grep sur src/). Retirer l'acces public ne
--    casse rien de connu.
--
-- 2) public.jobradar_monitor_sources()
-- 3) public.jobradar_source_health_maintenance()
-- 4) public.jobradar_reactivate_min_sources()
-- 5) public.jobradar_monitor_alert_email()
--    Quatre fonctions de maintenance/monitoring JobRadar, destinees au seul
--    cron (pg_cron execute en tant que postgres, non concerne par ce
--    REVOKE). Aucune garde interne, aucun appel depuis le frontend (grep sur
--    src/). La plus sensible : jobradar_reactivate_min_sources() permet a
--    n'importe quel appelant anonyme de forcer la reactivation de sources
--    d'ingestion desactivees, en dehors de tout cycle de cron.
--
-- Dry-run recommande avant application (verifie les grants actuels) :
--   select routine_name, grantee, privilege_type
--   from information_schema.routine_privileges
--   where routine_schema = 'public'
--     and routine_name in (
--       'has_active_pass', 'jobradar_monitor_sources',
--       'jobradar_source_health_maintenance', 'jobradar_reactivate_min_sources',
--       'jobradar_monitor_alert_email'
--     )
--     and grantee in ('anon', 'authenticated', 'PUBLIC');
--
-- Idempotent : REVOKE sur un privilege deja absent est un no-op sans erreur.

begin;

revoke execute on function public.has_active_pass(uuid) from public, anon, authenticated;
revoke execute on function public.jobradar_monitor_sources() from public, anon, authenticated;
revoke execute on function public.jobradar_source_health_maintenance() from public, anon, authenticated;
revoke execute on function public.jobradar_reactivate_min_sources() from public, anon, authenticated;
revoke execute on function public.jobradar_monitor_alert_email() from public, anon, authenticated;

commit;

-- Note d'execution : postgres (proprietaire) et service_role conservent
-- l'acces (non concernes par ce REVOKE, et de toute facon non soumis aux
-- grants sur une fonction dont ils sont proprietaires/superuser). Le cron
-- (pg_cron, execute en tant que postgres) continue de fonctionner sans
-- changement. Aucune Edge Function legitime n'appelle ces 5 fonctions via
-- l'API REST (send_digest, seule consommatrice de has_active_pass, est du
-- code mort non deploye/appele -- cf audit du 22/07/2026).
