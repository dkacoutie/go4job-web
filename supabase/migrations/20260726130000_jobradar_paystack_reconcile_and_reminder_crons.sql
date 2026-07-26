-- P7 (finalisation avant Meta Ads) : active les 2 crons Paystack déjà
-- préparés lors des Ajustements 6 et 8 (spec activation/paiement du
-- 24/07/2026), déployés en edge functions depuis mais jamais planifiés.
--
-- Dry-run effectué juste avant cette migration (26/07/2026, via appel
-- manuel net.http_post reproduisant exactement la mécanique des autres
-- crons du projet) :
--   - paystack_reconcile_pending : candidates_found = 0 (avec max_age_hours
--     poussé jusqu'au plafond dur de la fonction, 336h/14 jours).
--   - jobradar_payment_reminder_send : candidates_fetched = 0 (même test).
--
-- Explication du 0 : billing_payments ne contient aucun paiement
-- pending/ongoing récent. Les plus récents (statuts pending/ongoing) datent
-- du 27/03/2026 et du 10/06/2026 — bien au-delà des plafonds durs codés en
-- dur dans les deux fonctions (14 jours), qui refusent volontairement de
-- toucher à de si vieux paiements ("garde-fou dur même si mal configuré").
-- Le fameux segment de "214 comptes" mentionné dans les rapports précédents
-- vient d'une table statique différente (paystack_checkout_recovery_leads,
-- import ponctuel), pas de billing_payments — non concerné par ces crons.
--
-- Conséquence pratique : activer ces 2 crons maintenant est sans effet
-- immédiat (aucun paiement en attente actuellement éligible). Ils ne
-- commenceront à agir que sur de NOUVEAUX paiements Paystack qui resteraient
-- pending/ongoing après le lancement de la campagne Meta Ads — exactement
-- le moment où ce filet de sécurité doit déjà être actif.
--
-- Garde-fous déjà présents dans les fonctions elles-mêmes (voir
-- supabase/functions/paystack_reconcile_pending/index.ts et
-- supabase/functions/jobradar_payment_reminder_send/index.ts), non répétés
-- ici : dry_run par défaut, jamais d'écrasement d'un statut déjà final,
-- jamais de double activation de pass, jamais plus de 2 relances par
-- paiement, exclusion notification_prefs.unsubscribed_at +
-- email_suppressions, confirmation littérale exigée pour tout envoi réel.
--
-- Fréquences choisies pour rester décalées des autres crons déjà étalés
-- (migration 20260726110000) : reconcile toutes les 15 min (:07/:22/:37/:52),
-- relance toutes les 30 min (:17/:47), volontairement après reconcile dans
-- le même cycle horaire pour ne jamais relancer un paiement que Paystack
-- vient de confirmer entre-temps.
--
-- Réversible : select cron.unschedule('paystack_reconcile_pending_cron');
--              select cron.unschedule('jobradar_payment_reminder_send_cron');

begin;

select cron.schedule(
  'paystack_reconcile_pending_cron',
  '7,22,37,52 * * * *',
  $$
  select net.http_post(
    url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/paystack_reconcile_pending',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from private.app_secrets where key = 'CRON_SECRET'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_service_role_key')
    ),
    body := jsonb_build_object('dry_run', false, 'limit', 10, 'max_age_hours', 48),
    timeout_milliseconds := 25000
  );
  $$
);

select cron.schedule(
  'jobradar_payment_reminder_send_cron',
  '17,47 * * * *',
  $$
  select net.http_post(
    url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/jobradar_payment_reminder_send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from private.app_secrets where key = 'CRON_SECRET'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_service_role_key')
    ),
    body := jsonb_build_object(
      'dry_run', false,
      'confirm', 'SEND_JOBRADAR_PAYMENT_REMINDER_V1',
      'limit', 5,
      'first_delay_minutes', 10,
      'second_delay_hours', 24,
      'max_age_hours', 72
    ),
    timeout_milliseconds := 25000
  );
  $$
);

commit;
