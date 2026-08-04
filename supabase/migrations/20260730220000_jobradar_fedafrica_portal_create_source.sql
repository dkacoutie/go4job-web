-- =============================================================================
-- JobRadar — Fed Africa : retrait de l'ancienne entree morte, creation de
-- fedafrica_portal
--
-- CONSTAT
--
-- L'entree job_sources existante (code='fedafrica', ingest_method=
-- 'scrape_fedafrica') n'a jamais eu de code fonctionnel : aucun fichier ni
-- bloc de dispatch dans index.ts ne traite 'scrape_fedafrica'. Tous les runs
-- historiques (le dernier le 17/04/2026) se sont soldes par un echec a 0
-- offre, sans message d'erreur exploitable. Cette entree est marquee comme
-- definitivement remplacee plutot que supprimee (aucune donnee n'est
-- effacee).
--
-- NOUVEAU CONNECTEUR
--
-- supabase/functions/ingest_source/sources/fedafrica_portal.ts, ecrit le
-- 30/07/2026 sur le cadre commun west_africa_source_common.ts avec un
-- parseur HTML personnalise (une seule page listing, pas de pagination
-- connue). Filtre applique : exclusion des offres marquees "Offre pourvue",
-- conservation des offres mentionnant "Abidjan" (proxy fiable pour Cote
-- d'Ivoire sur ce site, verifie sur l'audit du jour : 12 offres CI sur 20
-- affichees, toutes a Abidjan). Nom d'employeur non exploitable (mandats
-- confidentiels) : company_name fixe a "Fed Africa" (le cabinet).
--
-- Wire dans index.ts (dry-run + import reel garde par allow_import/confirm,
-- limite 30), sur le meme modele que eburka_portal. Verifie par
-- tsc --noEmit.
--
-- ETAT INITIAL DE fedafrica_portal
--
-- is_active = false, ingest_status = 'draft', health_status = 'paused',
-- health_status_reason = 'pending_dry_run_validation' : comme pour EBURKA,
-- rien n'est actif ni importe par cette migration. Le parseur HTML est un
-- best-effort (aucune inspection du HTML brut possible depuis cet
-- environnement) : a confirmer/ajuster au premier dry-run reel.
-- =============================================================================

begin;

update public.job_sources
set health_status = 'paused',
    health_status_reason = 'superseded_by_fedafrica_portal_2026_07_30',
    disabled_reason = 'dead_code_no_connector_ever_implemented',
    updated_at = now()
where code = 'fedafrica';

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
  'fedafrica_portal',
  'Fed Africa Cote d''Ivoire',
  'https://www.fedafrica.com',
  'Cote d''Ivoire',
  false,
  'GLOBAL',
  50,
  'scrape',
  false,
  'Cabinet de recrutement cadres/dirigeants, page listing unique tous pays. Audite le 30/07/2026 : 20 offres affichees, 12 ouvertes en Cote d''Ivoire (Abidjan), 7 "Offre pourvue" exclues. Employeur reel confidentiel : company_name = Fed Africa (le cabinet). Parseur HTML best-effort, a confirmer au premier dry-run reel.',
  jsonb_build_object(
    'country', 'Cote d''Ivoire',
    'base_url', 'https://www.fedafrica.com',
    'source_family', 'fedafrica_portal',
    'dry_run_validated', false,
    'real_import_guarded', true,
    'max_first_import_limit', 30,
    'supersedes', 'fedafrica'
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
  'fedafrica_portal_source_created',
  jsonb_build_object(
    'reason', 'connector written and wired, replaces dead fedafrica (scrape_fedafrica never implemented), awaiting first real dry-run',
    'at', now()
  )
);

commit;
