-- =============================================================================
-- JobRadar — Bilan à 48 h de la réactivation du 28/07, et coupe du poids mort
--
-- CE QUI EST MESURÉ
--
-- Le 28/07, 32 sources en pause ont été réactivées sur l'hypothèse « ajouter une
-- source ne coûte rien, la cadence d'appels est fixée par la taille du lot et
-- non par le nombre de sources ». L'hypothèse était vraie sur la cadence,
-- incomplète sur le coût : chaque source consomme un créneau de rotation et une
-- invocation de fonction edge, même quand elle ne rapporte rien.
--
-- Bilan après 48 heures de fonctionnement autonome :
--
--   Ont produit (129 offres au total)          -> conservées
--     SPIE (Join) 66, CFAO 27, AGL + AGL Afrique 24, AGL Côte d'Ivoire 6,
--     Bourbon et 4 autres 6
--
--   Maintiennent leur catalogue sans nouveauté -> conservées (12 sources)
--     AGL Sénégal 16 actives, Macopharma 13, Rawbank 12, Authentic Jobs 10,
--     AGL Afrique de l'Ouest 8, AGL Nigéria 4, CFAO Sénégal 3, Belambra 1
--
--   Zéro offre active, zéro offre collectée    -> désactivées ici (14 sources)
--     et pourtant crawlées 48 à 57 fois chacune
--
-- Trois des quatorze n'avaient jamais tourné : remotive,
-- goafricaonline_ci_portal, novojob_portal. Leur ingest_method n'est pas prise
-- en charge par le cron générique (qui traite rss_generic, rss, aej_html et le
-- cas vide), donc les réactiver était sans effet. Ce point n'avait pas été
-- vérifié avant la réactivation du 28/07.
--
-- POURQUOI C'EST IMPORTANT
--
-- L'enjeu principal n'est pas les ~550 invocations gaspillées en 48 h, c'est le
-- bruit. Ces sources produisaient à elles seules 39 avertissements
-- source_zero_fetch_5 et 18 source_no_ingest_24h en deux jours, maintenant la
-- supervision en 'warning' permanent.
--
-- Une alarme qui sonne toujours est une alarme que personne ne lit. C'est
-- exactement le mécanisme qui a permis à la panne d'ingestion de rester
-- invisible pendant huit jours. Rétablir le silence par défaut est une
-- condition pour que les alertes ajoutées le 28/07 servent à quelque chose.
--
-- Réversible : simple drapeau is_active. Les sources conservent leur
-- configuration, leur historique de runs et leurs offres passées.
--
-- État après application : 88 sources actives, 316 165 offres actives.
-- =============================================================================

begin;

-- 1. Sources réactivées le 28/07 qui n'ont rien produit en 48 h.
update public.job_sources s
set is_active = false,
    active = false,
    health_status = 'paused',
    health_status_reason = 'unproductive_after_48h_review_2026_07_30',
    disabled_reason = 'no_offers_after_reactivation',
    disabled_at = now(),
    updated_at = now()
where s.health_status_reason = 'reactivated_after_audit_2026_07_28'
  and s.is_active
  and not exists (
    select 1 from public.jobs j
    where j.job_source_id = s.id and j.job_status = 'active'::job_lifecycle_status
  )
  and not exists (
    select 1 from public.jobs j
    where j.job_source_id = s.id and j.created_at > now() - interval '48 hours'
  );

insert into public.jobradar_health_events(level, code, details)
select 'info', 'unproductive_sources_paused',
       jsonb_build_object('rows', count(*), 'at', now())
from public.job_sources
where health_status_reason = 'unproductive_after_48h_review_2026_07_30';

-- 2. Alertes des comptes de test dont l'adresse est invalide.
--
-- Resend rejette les domaines factices : « Invalid `to` field. Please use our
-- testing email address instead of domains like example.com ». Deux comptes de
-- test automatisés créés le 05/04 échouaient donc chaque matin, et
-- maintenaient l'avertissement job_alert_digest_starving en boucle, ce qui
-- rendait ce signal inutilisable pour détecter un vrai problème de livraison.
update public.alerts a
set is_active = false, updated_at = now()
where a.is_active
  and a.user_id in (select id from auth.users where email like '%@example.com');

commit;
