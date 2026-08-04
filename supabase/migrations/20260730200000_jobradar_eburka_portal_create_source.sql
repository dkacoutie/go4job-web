-- =============================================================================
-- JobRadar — Création de la source EBURKA JOB (job.eburka-ci.net)
--
-- CONTEXTE
--
-- Suite à la décision du porteur du projet ("doc on fera EBURKA puis Fed"),
-- audit du 30/07/2026 : petit job board WordPress dédié à la Côte d'Ivoire,
-- ~50 offres actives, 8 pages, catalogue borné (pas d'archive fantôme comme
-- CIFIP), robots.txt permissif, sitemap déclaré. /feed et /emploi/feed
-- répondent en application/rss+xml (vérifié).
--
-- Le connecteur supabase/functions/ingest_source/sources/eburka_portal.ts a
-- été écrit sur le modèle exact de jobwebghana_portal.ts (framework commun
-- west_africa_source_common.ts), vérifié par tsc --noEmit, et wiré dans
-- index.ts (dry-run + import réel gardé par allow_import/confirm), sur le
-- même modèle que novojob_portal et jobwebghana_portal.
--
-- L'extraction du nom d'entreprise depuis le flux RSS est une estimation
-- best-effort non confirmée (impossible d'inspecter le XML brut avant le
-- premier dry-run réel) : health_status_reason le documente explicitement.
--
-- ÉTAT INITIAL
--
-- is_active = false, ingest_status = 'draft', health_status = 'paused',
-- health_status_reason = 'pending_dry_run_validation' : la source existe en
-- base mais reste hors cron et hors import réel tant qu'un dry-run réel n'a
-- pas confirmé le fonctionnement du connecteur (en particulier l'extraction
-- entreprise). Aucune donnée n'est importée par cette migration.
--
-- Suite prévue (hors de cette migration, après validation explicite) :
-- déploiement de la fonction edge, dry-run réel, vérification idempotence
-- par deux imports réels successifs, puis seulement intégration au cron
-- jobradar-ci-ingest-8h (jobid 41) via cron.alter_job.
-- =============================================================================

begin;

insert into public.job_sources (
  code,
  name,
  base_url,
  country,
  is_active,
  region,
  priority,
  ingest_method,
  is_api_only,
  notes,
  ingest_config,
  ingest_status,
  status,
  active,
  source_tier,
  health_status,
  health_status_reason
)
values (
  'eburka_portal',
  'Eburka Job Côte d''Ivoire',
  'https://job.eburka-ci.net',
  'Cote d''Ivoire',
  false,
  'GLOBAL',
  50,
  'scrape',
  false,
  'Job board WordPress, Cote d''Ivoire uniquement. Audite le 30/07/2026 : 50 offres actives, 8 pages. Extraction entreprise best-effort depuis le flux RSS, a confirmer au premier dry-run reel.',
  jsonb_build_object(
    'country', 'Cote d''Ivoire',
    'base_url', 'https://job.eburka-ci.net',
    'source_family', 'eburka_portal',
    'dry_run_validated', false,
    'real_import_guarded', true,
    'max_first_import_limit', 50
  ),
  'draft',
  null,
  false,
  'extended',
  'paused',
  'pending_dry_run_validation'
);

insert into public.jobradar_health_events(level, code, details)
values (
  'info',
  'eburka_portal_source_created',
  jsonb_build_object(
    'reason', 'connector written and wired, awaiting first real dry-run before deploy validation and cron integration',
    'at', now()
  )
);

commit;
