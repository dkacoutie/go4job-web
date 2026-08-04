-- =============================================================================
-- JobRadar — EBURKA CI, activation après vérification complète
--
-- Suite de la migration 20260730200000 (création de la source, dry-run
-- only). Depuis :
--
--   1. Correctif d'extraction du nom d'entreprise depuis le slug de l'URL
--      (extractEburkaCompanyFromSlug dans eburka_portal.ts), déployé.
--   2. Dry-run réel post-correctif : 35 offres parsées, 0 rejet, company_name
--      peuplé sur l'échantillon vérifié (Eburka Conseils, Cabinet Eburka
--      Conseils, Bidi Group Cote Divoire, Look Du Jour Boutique).
--   3. Premier import réel (limit 30) : inserted=30, updated=0. Vérifié en
--      base : 30 lignes, 27/30 avec company_name renseigné (90%).
--   4. Second import réel identique : inserted=0, updated=30. Total toujours
--      30 lignes en base — idempotence confirmée, même méthode que
--      Go Africa Online et Novojob.
--
-- EBURKA rejoint donc jobradar-ci-ingest-8h (jobid 41) comme Source 4,
-- aux côtés d'Educarrière, Go Africa Online et Novojob (cron.alter_job
-- appliqué séparément, cron.job appartenant à supabase_admin).
-- =============================================================================

begin;

update public.job_sources
set is_active = true,
    active = true,
    ingest_status = 'ready',
    health_status = 'healthy',
    health_status_reason = 'dry_run_and_idempotence_verified_2026_07_30',
    updated_at = now()
where code = 'eburka_portal';

insert into public.jobradar_health_events(level, code, details)
values (
  'info',
  'eburka_portal_activated_after_verification',
  jsonb_build_object(
    'dry_run_parsed', 35,
    'first_import_inserted', 30,
    'first_import_company_name_coverage', '27/30',
    'second_import_inserted', 0,
    'second_import_updated', 30,
    'reason', 'idempotence verified, company name extracted from URL slug, joining jobradar-ci-ingest-8h as Source 4',
    'at', now()
  )
);

commit;

-- -----------------------------------------------------------------------------
-- Cron modifié séparément (cron.job appartient à supabase_admin) :
--
--   select cron.alter_job(41, command := $CRON$ ... Source 4 : EBURKA CI ... $CRON$);
--
-- Appliqué le 30/07/2026, limit 30 par passage (aligné sur le catalogue
-- borné ~50 offres et sur la limite validée par les deux imports réels).
-- -----------------------------------------------------------------------------
