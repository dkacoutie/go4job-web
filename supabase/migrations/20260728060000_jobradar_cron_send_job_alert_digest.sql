-- =============================================================================
-- JobRadar — Cron dédié à l'alerte produit
--
-- Constat du 28/07/2026 : aucun cron n'envoyait l'alerte aux gens qui en ont
-- configuré une. Le seul cron d'emails actif (jobid 35, nommé
-- jobradar_daily_digest) appelle en réalité une campagne de réactivation
-- marketing ciblée sur le segment 'non_paying_without_alert'. Par construction,
-- elle exclut à la fois les détenteurs d'alerte et les clients payants.
--
-- Conséquence : le produit vendu ne partait plus depuis mi-mai. Les clients
-- payants ne recevaient rien, le porteur du projet non plus, et les
-- 8 979 tentatives antérieures avaient été refusées pour 'pass_required'.
--
-- Cette fonction sépare les deux métiers. La campagne de réactivation reste ce
-- qu'elle est ; ici on envoie l'alerte à ceux qui l'ont demandée.
--
-- Deux principes tirés de la panne d'ingestion réparée la même nuit :
--   1. Pas de pg_sleep dans la boucle. C'est ce qui faisait dépasser le
--      statement_timeout et tuait le cron d'ingestion en silence pendant 8 jours.
--   2. Lot de taille fixe avec rotation par ancienneté d'envoi, pour que la
--      durée reste constante quel que soit le nombre d'abonnés.
--
-- Répartition des responsabilités : ce cron décide QUI et QUAND. La fonction
-- edge send_job_alert_digest_v2 reste seule juge du CONTENU et des règles de
-- consentement (notification_prefs, email_suppressions, seuils de qualité).
-- On ne duplique pas ces contrôles ici, pour qu'ils ne puissent pas diverger.
--
-- Palier gratuit : 5 offres, pas 3. La fonction edge exige min_jobs_to_send = 5
-- pour accepter d'envoyer. Un palier à 3 rendait le digest gratuit
-- mathématiquement impossible : constaté à l'envoi réel, 12 réponses
-- 'below_real_send_threshold_preview_only'. min_jobs_to_send est paramétrable,
-- on aurait pu l'abaisser pour les gratuits, mais ce seuil existe pour éviter
-- d'envoyer un email trop maigre pour être utile. L'abaisser reviendrait à
-- réserver les emails les plus pauvres au groupe qu'il faut convaincre.
--
-- Résultat du premier envoi réel : 16 emails, 10 gratuits à 5 offres,
-- 2 détenteurs de pass à 30 offres.
--
-- Sur le partage du canal 'job_alert_digest_v2' avec la campagne de
-- réactivation : vérifié après coup, les deux populations sont disjointes par
-- construction. La relance cible 'non_paying_without_alert', ce cron cible les
-- détenteurs d'une alerte active. Chevauchement mesuré : 0 personne sur 14 et
-- 215. Le délai de 20 h ne peut donc pas priver quelqu'un de son alerte, sauf
-- transitoirement s'il crée une alerte le lendemain d'un email de relance, ce
-- qui est un comportement acceptable.
-- =============================================================================

begin;

create or replace function private.cron_send_job_alert_digest(
  p_batch int default 25,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'vault'
as $function$
declare
  v_secret text;
  v_jwt text;
  r record;
  v_now timestamptz := now();
  v_sent int := 0;
  v_eligible int := 0;
  v_starving int := 0;
  -- Doit rester >= min_jobs_to_send de la fonction edge (5), sinon le digest
  -- gratuit est systématiquement retenu par le seuil de qualité.
  v_limite_gratuit constant int := 5;
  v_limite_pass constant int := 30;
  -- Marge sous les 24 h pour absorber la dérive du planificateur sans sauter
  -- un jour d'envoi.
  v_cooldown interval := interval '20 hours';
begin
  select value into v_secret from private.app_secrets where key = 'CRON_SECRET';
  if v_secret is null or length(v_secret) = 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'cron_secret_missing' and created_at > v_now - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'cron_secret_missing', jsonb_build_object('at', v_now));
    end if;
    raise exception 'CRON_SECRET missing in private.app_secrets';
  end if;

  select decrypted_secret into v_jwt
  from vault.decrypted_secrets where name = 'supabase_service_role_key';
  if v_jwt is null or length(v_jwt) = 0 then
    raise exception 'supabase_service_role_key missing in vault.decrypted_secrets';
  end if;

  for r in
    with abonnes as (
      select
        a.user_id,
        public.has_active_pass(a.user_id) as paye,
        (
          select max(n.created_at)
          from public.notification_logs n
          where n.user_id = a.user_id
            and n.channel = 'job_alert_digest_v2'
            and n.status = 'sent'
        ) as dernier_envoi
      from public.alerts a
      where a.is_active
      group by a.user_id
    )
    select user_id, paye, dernier_envoi
    from abonnes
    where dernier_envoi is null or dernier_envoi < v_now - v_cooldown
    order by dernier_envoi asc nulls first
    limit p_batch
  loop
    if not p_dry_run then
      perform net.http_post(
        url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/send_job_alert_digest_v2',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', v_secret,
          'Authorization', 'Bearer ' || v_jwt
        ),
        body := jsonb_build_object(
          'dry_run', false,
          'allow_send', true,
          'confirm', 'SEND_JOB_ALERT_DIGEST_V2',
          'user_id', r.user_id,
          'limit', case when r.paye then v_limite_pass else v_limite_gratuit end,
          'trigger', 'cron_job_alert_digest'
        ),
        timeout_milliseconds := 60000
      );
    end if;
    v_sent := v_sent + 1;
  end loop;

  select count(distinct a.user_id) into v_eligible
  from public.alerts a where a.is_active;

  -- Supervision par l'absence, comme sur l'ingestion : un abonné sans digest
  -- depuis 48 h signale que le lot ne suit pas la cadence, ou que la fonction
  -- edge refuse d'envoyer.
  select count(*) into v_starving
  from (
    select a.user_id
    from public.alerts a
    where a.is_active
    group by a.user_id
    having coalesce((
      select max(n.created_at) from public.notification_logs n
      where n.user_id = a.user_id and n.channel = 'job_alert_digest_v2' and n.status = 'sent'
    ), 'epoch'::timestamptz) < v_now - interval '48 hours'
  ) t;

  if v_starving > 0 and not p_dry_run then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'job_alert_digest_starving' and created_at > v_now - interval '12 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('warning', 'job_alert_digest_starving',
              jsonb_build_object('starving', v_starving, 'eligible', v_eligible, 'at', v_now));
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'batch', p_batch,
    'enqueued', v_sent,
    'free_tier_limit', v_limite_gratuit,
    'pass_limit', v_limite_pass,
    'subscribers_with_active_alert', v_eligible,
    'without_digest_over_48h', v_starving
  );
end;
$function$;

comment on function private.cron_send_job_alert_digest(int, boolean) is
  'Envoie l''alerte produit aux detenteurs d''une alerte active. Distinct de la campagne de reactivation marketing (cron_send_job_alert_digest_reactivation).';

commit;

-- -----------------------------------------------------------------------------
-- Planification à créer séparément (cron.job appartient à supabase_admin) :
--
--   select cron.schedule(
--     'jobradar_job_alert_digest',
--     '30 6 * * *',
--     $$select private.cron_send_job_alert_digest(25, false);$$
--   );
--
-- 06:30 UTC, avant la campagne de réactivation de 07:00.
--
-- Créé le 28/07/2026 sous le jobid 62.
-- -----------------------------------------------------------------------------
