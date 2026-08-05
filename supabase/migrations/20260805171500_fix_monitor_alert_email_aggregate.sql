-- Deuxième correctif trouvé au même endroit que
-- 20260805170000_fix_job_lifecycle_maintenance_ambiguity.sql (page
-- /admin/health, 05/08/2026).
--
-- Le cron jobradar_monitor_email échoue également à chaque exécution dès
-- qu'il y a effectivement quelque chose à signaler (258 échecs, premier le
-- 28/02/2026, dernier ce matin à 00:10 UTC). Cette fonction envoie un email
-- d'alerte à contact@go4jobapp.com quand des événements warning/critical
-- se sont produits dans les dernières 24h -- c'est le filet de sécurité qui
-- aurait dû signaler la panne de jobradar_job_lifecycle_maintenance
-- ci-dessus il y a plus d'une semaine. Sa propre panne explique pourquoi
-- personne n'a été alerté.
--
-- Cause : la requête interne mélange un agrégat (string_agg, qui réduit le
-- résultat à une seule ligne) avec un ORDER BY / LIMIT au même niveau,
-- portant sur une colonne (created_at) qui n'existe plus une fois les
-- lignes agrégées. Postgres refuse : "column jobradar_health_events.
-- created_at must appear in the GROUP BY clause or be used in an aggregate
-- function." Le ORDER BY / LIMIT était visiblement destiné à sélectionner
-- les 20 événements les plus récents AVANT de les concaténer, pas à trier
-- le résultat déjà agrégé.
--
-- Correctif : sélectionner d'abord les 20 événements les plus récents dans
-- une sous-requête, puis agréger cette sous-requête. Comportement identique
-- à l'intention d'origine (liste des 20 dernières alertes dans l'email),
-- reste de la fonction (throttle 12h, secrets, appel HTTP) inchangé.

create or replace function public.jobradar_monitor_alert_email()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'private'
as $function$
declare
  v_now timestamptz := now();
  v_secret text;
  v_to text;
  v_count int := 0;
  v_list text;
  v_html text;
  v_text text;
begin
  -- throttle: at most once every 12h
  if exists (
    select 1 from jobradar_health_events
    where code = 'alert_email_sent'
      and created_at > v_now - interval '12 hours'
  ) then
    return;
  end if;

  select value into v_secret
  from private.app_secrets
  where key = 'CRON_SECRET';

  if v_secret is null or length(v_secret) = 0 then
    return;
  end if;

  select value into v_to
  from private.app_secrets
  where key = 'ALERT_EMAIL';

  if v_to is null or length(v_to) = 0 then
    v_to := 'contact@go4jobapp.com';
  end if;

  select count(*) into v_count
  from jobradar_health_events
  where created_at > v_now - interval '24 hours'
    and level in ('warning','critical')
    and code <> 'alert_email_sent';

  if v_count = 0 then
    return;
  end if;

  select string_agg(
    format('<li><strong>%s</strong> — %s (%s)</li>',
      code,
      level,
      to_char(created_at, 'YYYY-MM-DD HH24:MI')
    ),
    ''
  ) into v_list
  from (
    select code, level, created_at
    from jobradar_health_events
    where created_at > v_now - interval '24 hours'
      and level in ('warning','critical')
      and code <> 'alert_email_sent'
    order by created_at desc
    limit 20
  ) recent;

  v_html := '<div style="font-family:Arial,sans-serif;line-height:1.6;">' ||
            '<h3>Alertes JobRadar (24h)</h3>' ||
            '<p>Des signaux de dégradation ont été détectés.</p>' ||
            '<ul>' || coalesce(v_list,'') || '</ul>' ||
            '<p>Vérifie jobradar_health_events pour le détail.</p>' ||
            '</div>';

  v_text := 'Alertes JobRadar (24h). Consulte jobradar_health_events.';

  perform net.http_post(
    url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/send_email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret,
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object(
      'to', v_to,
      'subject', 'JobRadar — Alertes ingestion',
      'html', v_html,
      'text', v_text,
      'tag', 'jobradar_monitor'
    ),
    timeout_milliseconds := 20000
  );

  insert into jobradar_health_events(level, code, details)
  values ('info', 'alert_email_sent', jsonb_build_object('to', v_to, 'count', v_count));
end;
$function$;
