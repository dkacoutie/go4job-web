-- =============================================================================
-- JobRadar — Pause de Novojob CI, external_id instable
--
-- CONSTAT
--
-- Après réactivation du 30/07 (migration précédente), Novojob a produit des
-- doublons à chaque passage du cron jobradar-ci-ingest-8h : deux imports
-- réels identiques ont chacun inséré 20 lignes (inserted=20, updated=0 les
-- deux fois), alors que Go Africa Online, réactivé le même jour, est resté
-- parfaitement idempotent (inserted=0, updated=150 au second passage).
--
-- CAUSE RACINE
--
-- novojob_portal.ts construit l'external_id à partir du chemin complet de
-- l'URL normalisée. Or Novojob sert la même offre sous deux formes de chemin
-- selon le flux RSS qui répond ce jour-là :
--
--   /cote-d-ivoire/offres-d-emploi/offre-d-emploi/cote-d-ivoire/abidjan/136783-...
--   /offres-d-emploi/offre-d-emploi/cote-d-ivoire/abidjan/136783-...
--
-- Même identifiant numérique (136783), même entreprise, même date de
-- publication à la seconde près, mais deux external_id différents. Confirmé
-- en base : 19 identifiants numériques Novojob existent chacun deux fois
-- (136753, 136754, 136757, 136758, 136764 à 136777, 136782, 136783).
--
-- La clé d'upsert (onConflict: "external_id") fonctionne correctement, c'est
-- la valeur qui l'alimente qui est instable pour cette source précise.
--
-- DÉCISION
--
-- Retrait de Novojob du cron jobradar-ci-ingest-8h (jobid 41) et pause de la
-- source, en attendant un correctif dans novojob_portal.ts qui bâtit
-- l'external_id à partir du seul identifiant numérique final de l'URL,
-- invariant quelle que soit la forme de chemin servie par le site.
--
-- Go Africa Online reste dans le cron sans changement : rien dans ses
-- données n'indique le même défaut, et son idempotence est vérifiée.
--
-- Réversible : simple drapeau is_active + cron.alter_job. Aucune donnée
-- supprimée. Le nettoyage des 19 doublons déjà en base est traité séparément,
-- après validation explicite du porteur du projet (marquage tombstoned
-- plutôt que suppression).
-- =============================================================================

begin;

update public.job_sources
set is_active = false,
    active = false,
    health_status = 'paused',
    health_status_reason = 'duplicate_external_id_pending_fix_2026_07_30',
    disabled_reason = 'duplicate_external_id_dual_url_form',
    disabled_at = now(),
    updated_at = now()
where code = 'novojob_portal';

insert into public.jobradar_health_events(level, code, details)
values (
  'info',
  'novojob_portal_paused_duplicate_bug',
  jsonb_build_object(
    'reason', 'external_id built from full URL path; novojob serves same job under two path forms (with/without leading /cote-d-ivoire/)',
    'duplicate_pairs_found', 19,
    'at', now()
  )
);

commit;

-- -----------------------------------------------------------------------------
-- Modification de cron appliquée séparément (cron.job appartient à
-- supabase_admin, jamais d'UPDATE direct) :
--
--   select cron.alter_job(41, command := $CRON$
--     -- Source 1 : Educarriere CI (inchangé)
--     -- Source 2 : Go Africa Online CI (inchangé)
--     -- Source 3 : Novojob CI retirée temporairement, cf. commentaire ci-dessus
--   $CRON$);
--
-- Appliqué le 30/07/2026.
-- -----------------------------------------------------------------------------
