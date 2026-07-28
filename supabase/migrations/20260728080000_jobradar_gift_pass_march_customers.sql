-- =============================================================================
-- JobRadar — Geste commercial envers les trois clients de mars 2026
--
-- Contexte. Ces trois personnes ont pris un pass en mars. Le service d'alerte
-- ne fonctionnait pas correctement pendant leur période :
--
--   - un client avec 3 alertes actives n'a reçu aucun email de la semaine
--   - un client avec 1 alerte en a reçu 2 sur les 7 qu'une fréquence
--     quotidienne promettait
--   - un client n'avait aucune alerte configurée, rien dans le parcours après
--     paiement ne l'ayant conduit à cette étape
--
-- Causes identifiées et corrigées le 28/07/2026 :
--   - aucun cron n'envoyait l'alerte aux détenteurs d'alerte
--     (voir 20260728060000_jobradar_cron_send_job_alert_digest.sql)
--   - le vivier de candidats était limité aux 240 offres les plus récentes du
--     catalogue entier, soit une vingtaine de minutes de collecte
--
-- On crédite un pass de 30 jours à chacun. Aucun paiement associé
-- (source_payment_id à null) : c'est un geste, pas une transaction.
--
-- Vérifié avant écriture par un SELECT : aucun des trois ne disposait d'un pass
-- valide à cette date, donc pas de double crédit. Le garde-fou NOT EXISTS
-- ci-dessous rend la migration rejouable sans effet indésirable.
--
-- Accompagné de trois messages personnels envoyés par le porteur du projet,
-- pas d'un envoi automatique.
-- =============================================================================

begin;

insert into public.billing_subscriptions
  (user_id, plan_id, source_payment_id, status, starts_at, ends_at, activated_at)
select
  p.user_id,
  (select id from public.billing_plans where code = 'pass_30d'),
  null,
  'active',
  now(),
  now() + interval '30 days',
  now()
from (
  select distinct bs.user_id
  from public.billing_subscriptions bs
  join auth.users u on u.id = bs.user_id
  where u.email not ilike '%kacoutie%'
    and u.email not ilike '%go4job%'
    and u.email not ilike '%test%'
    and u.email not ilike '%+%'
) p
where not exists (
  select 1 from public.billing_subscriptions b
  where b.user_id = p.user_id and b.status = 'active' and b.ends_at > now()
);

insert into public.jobradar_health_events(level, code, details)
values ('info', 'compensation_pass_granted',
        jsonb_build_object('plan', 'pass_30d', 'reason', 'digest_non_delivery_march_2026', 'at', now()));

commit;
