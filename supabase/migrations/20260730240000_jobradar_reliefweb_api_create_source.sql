-- =============================================================================
-- JobRadar — Création de la source ReliefWeb Jobs API
--
-- CONTEXTE
--
-- Le connecteur supabase/functions/ingest_source/sources/reliefweb_api.ts
-- utilise la vraie API ReliefWeb (pas un flux RSS mort comme les tentatives
-- précédentes reliefweb_jobs/reliefweb_opportunities_rss, cf. audit du
-- 30/07/2026). Depuis le 1er novembre 2025, ReliefWeb exige un "appname"
-- pré-approuvé (revue manuelle par leur équipe). Le porteur du projet avait
-- déjà obtenu une approbation le 29/04/2026 (email confirmé) :
--   go4job-jobradar-jobs-dk2026HZ1dG2z1V
--
-- Vérifié par dry-run réel le 30/07/2026 : 67 offres au total sur les 10
-- pays cibles (Côte d'Ivoire + 9 pays voisins d'Afrique de l'Ouest),
-- employeurs réels et pertinents (Helen Keller International, Danish
-- Refugee Council, OIM, Fairtrade Africa...).
--
-- CORRECTIF APPLIQUÉ AVANT CETTE MIGRATION
--
-- Le connecteur ne posait pas country_codes par offre (même trou de
-- couverture que rss_ngojobsinafrica, cf. point de vigilance CLAUDE.md).
-- Corrigé : mapping direct nom de pays ReliefWeb -> ISO2 pour les 10 pays
-- filtrés, vérifié sur l'échantillon réel (Côte d'Ivoire, Burkina Faso,
-- Nigeria, Guinée tous correctement résolus).
--
-- L'import réel était bloqué en dur dans index.ts ("dry_run_only"), retiré
-- et remplacé par un garde-fou standard (allow_import + confirm), même
-- modèle que les sources CI ajoutées aujourd'hui.
--
-- ÉTAT INITIAL
--
-- is_active = false, is_api_only = true (source API dédiée, pas éligible au
-- cron générique RSS ni au cron CI 8h — nécessitera son propre cron, comme
-- Himalayas). ingest_status = 'draft', health_status = 'paused',
-- health_status_reason = 'pending_dry_run_validation_post_country_codes_fix'
-- : un nouveau dry-run doit confirmer le correctif country_codes avant tout
-- import réel ou activation.
--
-- L'appname n'est PAS stocké dans ingest_config (pas de secret dans une
-- migration versionnée) : à définir comme secret de fonction edge
-- (RELIEFWEB_APPNAME) via la CLI Supabase, séparément.
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
  'reliefweb_api',
  'ReliefWeb Jobs API',
  'https://api.reliefweb.int/v2/jobs',
  null,
  false,
  'GLOBAL',
  50,
  'api_reliefweb',
  true,
  'API officielle ReliefWeb (OCHA/ONU), offres ONG et institutions internationales. Filtre sur 10 pays Afrique de l''Ouest (CI + voisins). Appname pre-approuve le 29/04/2026, appname stocke en secret edge function (RELIEFWEB_APPNAME), pas en base. country_codes reconstruit par mapping nom->ISO2 (corrige le 30/07/2026, cf. trou connu sur rss_ngojobsinafrica).',
  jsonb_build_object(
    'source_family', 'reliefweb_api',
    'countries', array['Côte d''Ivoire','Senegal','Ghana','Nigeria','Benin','Togo','Burkina Faso','Mali','Guinea','Niger'],
    'dry_run_validated', false,
    'real_import_guarded', true,
    'max_import_limit', 100
  ),
  'draft',
  null,
  false,
  'extended',
  'paused',
  'pending_dry_run_validation_post_country_codes_fix'
);

insert into public.jobradar_health_events(level, code, details)
values (
  'info',
  'reliefweb_api_source_created',
  jsonb_build_object(
    'reason', 'real ReliefWeb API connector unblocked (appname approved 2026-04-29), country_codes coverage fix applied, awaiting fresh dry-run before real import',
    'at', now()
  )
);

commit;
