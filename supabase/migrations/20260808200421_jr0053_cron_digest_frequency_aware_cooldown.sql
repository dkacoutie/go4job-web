-- JR-0053 : la fréquence choisie par l'utilisateur (alerts.frequency: instant/daily/weekly)
-- n'était jamais lue par le cron d'envoi : un cooldown fixe de 20h s'appliquait à tout le
-- monde. Aujourd'hui 15/15 alertes actives sont en "daily" donc aucun utilisateur n'était
-- lésé en pratique, mais toute personne choisissant "Hebdo" aurait reçu un digest ~quotidien
-- au lieu d'hebdomadaire (fausse promesse silencieuse). "Instant" reste plafonné par le cron
-- qui ne tourne qu'une fois par jour (30 6 * * *) : aucun cooldown ne peut le rendre plus
-- rapide que "daily" sans une vraie architecture événementielle (hors scope ici, 0 utilisateur
-- concerné actuellement) — il est donc traité comme "daily" en attendant.
create or replace function private.cron_send_job_alert_digest(p_batch integer DEFAULT 25, p_dry_run boolean DEFAULT false)
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
  -- Cooldown "daily"/"instant" : comportement historique inchangé (20h).
  v_cooldown_daily constant interval := interval '20 hours';
  -- Cooldown "weekly" : ~6.5 jours pour laisser une marge au cron quotidien
  -- (30 6 * * *) sans dériver au-delà d'une semaine.
  v_cooldown_weekly constant interval := interval '6 days 12 hours';
  -- Seuils de détection "starving" (alerte santé) : adaptés en cohérence
  -- avec le cooldown effectif de l'utilisateur, pour éviter un faux positif
  -- sur un utilisateur 100% "weekly" qui n'a simplement pas encore atteint
  -- son échéance hebdomadaire.
  v_starving_daily constant interval := interval '48 hours';
  v_starving_weekly constant interval := interval '9 days';
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
        -- Cooldown "weekly" seulement si TOUTES les alertes actives de
        -- l'utilisateur sont en "weekly" (sinon on privilégie la cadence la
        -- plus fréquente demandée pour ne pas sous-livrer un mix daily+weekly).
        bool_and(coalesce(a.frequency, 'daily') = 'weekly') as tout_weekly,
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
    select
      user_id,
      paye,
      dernier_envoi,
      case when tout_weekly then v_cooldown_weekly else v_cooldown_daily end as cooldown
    from abonnes
    where dernier_envoi is null
       or dernier_envoi < v_now - (case when tout_weekly then v_cooldown_weekly else v_cooldown_daily end)
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

  select count(*) into v_starving
  from (
    select
      a.user_id,
      bool_and(coalesce(a.frequency, 'daily') = 'weekly') as tout_weekly
    from public.alerts a
    where a.is_active
    group by a.user_id
    having coalesce((
      select max(n.created_at) from public.notification_logs n
      where n.user_id = a.user_id and n.channel = 'job_alert_digest_v2' and n.status = 'sent'
    ), 'epoch'::timestamptz)
      < v_now - (case when bool_and(coalesce(a.frequency, 'daily') = 'weekly') then v_starving_weekly else v_starving_daily end)
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
