-- Cron d'envoi des pings Telegram après le digest email quotidien.
--
-- ATTENTION : à exécuter uniquement après avoir déployé et testé
-- manuellement send_telegram_digest_notify (voir marche à suivre fournie
-- séparément), sinon ce job échouera silencieusement chaque jour à 06:45
-- (fonction edge encore inexistante ou secrets absents).
--
-- Miroir volontaire de private.cron_send_job_alert_digest (même mécanisme
-- CRON_SECRET / vault.decrypted_secrets / net.http_post), décalé de 15
-- minutes après jobradar_job_alert_digest (06:30) pour laisser le temps aux
-- digests email du jour d'être enregistrés dans jobradar_digest_runs.

begin;

create or replace function private.cron_send_telegram_digest_notify()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'vault'
as $$
declare
  v_secret text;
  v_jwt text;
  v_response_id bigint;
begin
  select value into v_secret from private.app_secrets where key = 'CRON_SECRET';
  if v_secret is null or length(v_secret) = 0 then
    raise exception 'CRON_SECRET missing in private.app_secrets';
  end if;

  select decrypted_secret into v_jwt
  from vault.decrypted_secrets where name = 'supabase_service_role_key';
  if v_jwt is null or length(v_jwt) = 0 then
    raise exception 'supabase_service_role_key missing in vault.decrypted_secrets';
  end if;

  select net.http_post(
    url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/send_telegram_digest_notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret,
      'Authorization', 'Bearer ' || v_jwt
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_response_id;

  return jsonb_build_object('ok', true, 'request_id', v_response_id);
end;
$$;

select cron.schedule(
  'jobradar_telegram_digest_notify',
  '45 6 * * *',
  $$select private.cron_send_telegram_digest_notify();$$
);

commit;
