-- =============================================================================
-- JobRadar — Novojob CI, remise en rotation après correctif
--
-- Suite des migrations 20260730170000 (pause) et 20260730180000 (nettoyage
-- des doublons). Le correctif de novojob_portal.ts (external_id fondé sur
-- l'identifiant numérique final de l'URL) a été déployé, puis vérifié par
-- deux dry-runs manuels successifs.
--
-- Preuve retenue : l'offre SOLIBRA "Technicien Méthode junior H/F" (id
-- Novojob 136783) est ressortie sous les deux formes d'URL déjà observées
-- (avec puis sans le préfixe /cote-d-ivoire/) selon le flux RSS qui a
-- répondu à chaque appel, mais avec le même external_id
-- (novojob_portal:136783) dans les deux cas. Même constat sur 136782. C'est
-- exactement le scénario qui produisait des doublons avant le correctif.
--
-- Novojob rejoint donc à nouveau le cron jobradar-ci-ingest-8h (jobid 41),
-- aux côtés d'Educarrière et Go Africa Online.
-- =============================================================================

begin;

update public.job_sources
set is_active = true,
    active = true,
    health_status = 'healthy',
    health_status_reason = 'fix_verified_stable_external_id_2026_07_30',
    disabled_reason = null,
    disabled_at = null,
    updated_at = now()
where code = 'novojob_portal';

insert into public.jobradar_health_events(level, code, details)
values (
  'info',
  'novojob_portal_reactivated_after_fix',
  jsonb_build_object(
    'fix', 'external_id now keyed on numeric id, verified stable across two dry-runs with different URL forms (136783, 136782 identical external_id both times)',
    'at', now()
  )
);

commit;

-- -----------------------------------------------------------------------------
-- Cron modifié séparément (cron.job appartient à supabase_admin) :
--
--   select cron.alter_job(41, command := $CRON$ ... Source 3 : Novojob CI ... $CRON$);
--
-- Appliqué le 30/07/2026. Le prochain passage réel (toutes les 8h) sera la
-- vérification finale : inserted devrait tomber à 0 (ou proche) et updated
-- monter au passage suivant celui-ci, comme pour Go Africa Online.
-- -----------------------------------------------------------------------------
