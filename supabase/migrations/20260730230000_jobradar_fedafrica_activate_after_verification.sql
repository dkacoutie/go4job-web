-- =============================================================================
-- JobRadar — Fed Africa CI, activation après vérification complète
--
-- Suite de la migration 20260730220000 (création de fedafrica_portal,
-- retrait de l'ancienne entrée morte fedafrica). Depuis :
--
--   1. Dry-run réel : 13 offres parsées, toutes à Abidjan, company_name =
--      "Fed Africa" (cabinet), aucune offre "Offre pourvue" ni hors CI.
--   2. Premier import réel (limit 20) : inserted=13, updated=0.
--   3. Second import réel identique : inserted=0, updated=13. Total stable
--      à 13 en base — idempotence confirmée, même méthode que EBURKA,
--      Go Africa Online et Novojob.
--
-- Fed Africa rejoint donc jobradar-ci-ingest-8h (jobid 41) comme Source 5,
-- aux côtés d'Educarrière, Go Africa Online, Novojob et EBURKA.
-- =============================================================================

begin;

update public.job_sources
set is_active = true,
    active = true,
    ingest_status = 'ready',
    health_status = 'healthy',
    health_status_reason = 'dry_run_and_idempotence_verified_2026_07_30',
    updated_at = now()
where code = 'fedafrica_portal';

insert into public.jobradar_health_events(level, code, details)
values (
  'info',
  'fedafrica_portal_activated_after_verification',
  jsonb_build_object(
    'dry_run_parsed', 13,
    'first_import_inserted', 13,
    'second_import_inserted', 0,
    'second_import_updated', 13,
    'reason', 'idempotence verified, custom HTML parser confirmed working, joining jobradar-ci-ingest-8h as Source 5',
    'at', now()
  )
);

commit;

-- -----------------------------------------------------------------------------
-- Cron modifié séparément (cron.job appartient à supabase_admin) :
--
--   select cron.alter_job(41, command := $CRON$ ... Source 5 : Fed Africa CI ... $CRON$);
--
-- Appliqué le 30/07/2026, limit 20 par passage.
-- -----------------------------------------------------------------------------
