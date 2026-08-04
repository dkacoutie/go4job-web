-- =============================================================================
-- JobRadar — Nettoyage des doublons Novojob CI (external_id instable)
--
-- Complète la migration 20260730170000 (pause de la source). Corrige le
-- correctif de code (novojob_portal.ts, external_id fondé sur l'identifiant
-- numérique final de l'URL au lieu du chemin complet), reste à faire dans un
-- déploiement séparé de la fonction edge ingest_source.
--
-- Cette migration ne touche que les données déjà en base : 19 offres
-- identifiées comme doublons exacts (même identifiant numérique Novojob,
-- même entreprise, même date de publication à la seconde près), présentes
-- deux fois avec un external_id différent selon la forme d'URL servie par
-- le site le jour de la collecte.
--
-- Aucune suppression. La copie la plus ancienne par identifiant numérique
-- reste en l'état (active si elle l'était) ; la copie la plus récente,
-- strictement redondante, passe à job_status = 'tombstoned' et is_active =
-- false. Réversible : aucune ligne perdue, seul le statut change.
-- =============================================================================

begin;

with extrait as (
  select id,
         row_number() over (
           partition by (regexp_match(source_url, '/(\d+)-[^/]+$'))[1]
           order by created_at asc
         ) as rang,
         (regexp_match(source_url, '/(\d+)-[^/]+$'))[1] as novojob_numeric_id
  from public.jobs
  where job_source_id = '51aafbf6-c004-482d-b035-14ad5d14f5d9'
)
update public.jobs j
set job_status = 'tombstoned'::job_lifecycle_status,
    is_active = false,
    updated_at = now()
from extrait e
where j.id = e.id
  and e.novojob_numeric_id is not null
  and e.rang > 1;

insert into public.jobradar_health_events(level, code, details)
values (
  'info',
  'novojob_portal_duplicates_tombstoned',
  jsonb_build_object('rows', 19, 'reason', 'duplicate_external_id_dual_url_form', 'at', now())
);

commit;

-- Vérifié après application : 19 lignes tombstoned, 21 restent actives/expirées
-- normalement sur les 40 collectées par les deux imports du 30/07/2026.
