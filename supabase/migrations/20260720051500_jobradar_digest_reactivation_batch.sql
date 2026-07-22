-- Remplace le test manuel hardcode du cron jobid=35 (jobradar_daily_digest)
-- par une vraie boucle multi-utilisateurs, throttlee, sur le segment
-- "non_paying_without_alert" (utilisateurs inscrits, non payants, sans
-- alerte active) -- meme segment que le planner marketing
-- (jobradar_marketing_reactivation_candidates / cooldown_days=7), deja
-- corrige dans la migration precedente pour le mailing marketing.
--
-- Contexte : le cron jobid=35 appelait net.http_post() directement avec un
-- user_id code en dur ('d8069021-87ff-452a-beb3-e5b708378a7e') dans la
-- commande cron elle-meme, dry_run:false, allow_send:true. Aucune migration
-- versionnee ne definissait ce job -- cree manuellement hors process,
-- probablement un test jamais generalise. Resultat : un seul compte
-- recevait le digest chaque jour, les autres utilisateurs eligibles
-- (214 dans le segment) n'en recevaient aucun.
--
-- Decision du porteur du projet le 20/07/2026 : objectif confirme = relancer
-- les inscrits sans acte d'achat via le digest d'offres. Plafond retenu :
-- 25 utilisateurs/jour. Lancement en dry_run (aucun email reellement envoye)
-- le temps de valider dans les logs, avant bascule en envoi reel.
--
-- Pour basculer en envoi reel plus tard, sans nouvelle migration :
--   insert into private.app_secrets(key, value)
--   values ('JOB_ALERT_DIGEST_REACTIVATION_DRY_RUN', 'false')
--   on conflict (key) do update set value = excluded.value;
-- (absence de cle = dry_run par defaut, comportement actuel)

begin;

create or replace function private.cron_send_job_alert_digest_reactivation()
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'vault'
as $func$
declare
  v_secret text;
  v_jwt text;
  v_dry_run boolean := true;
  r record;
  v_is_first boolean := true;
  v_cap constant int := 25;
  v_cooldown_days constant int := 7;
begin
  select value into v_secret
  from private.app_secrets
  where key = 'CRON_SECRET';

  if v_secret is null or length(v_secret) = 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'cron_secret_missing' and created_at > now() - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'cron_secret_missing', jsonb_build_object('at', now()));
    end if;
    raise exception 'CRON_SECRET missing in private.app_secrets';
  end if;

  select decrypted_secret into v_jwt
  from vault.decrypted_secrets
  where name = 'supabase_service_role_key';

  if v_jwt is null or length(v_jwt) = 0 then
    if not exists (
      select 1 from public.jobradar_health_events
      where code = 'service_role_key_missing' and created_at > now() - interval '6 hours'
    ) then
      insert into public.jobradar_health_events(level, code, details)
      values ('critical', 'service_role_key_missing', jsonb_build_object('at', now()));
    end if;
    raise exception 'supabase_service_role_key missing in vault.decrypted_secrets';
  end if;

  select coalesce(
    (select value from private.app_secrets where key = 'JOB_ALERT_DIGEST_REACTIVATION_DRY_RUN'),
    'true'
  ) <> 'false'
  into v_dry_run;

  for r in
    select c.user_id, c.email
    from public.jobradar_marketing_reactivation_candidates c
    where c.segment = 'non_paying_without_alert'
      and not exists (
        select 1
        from public.notification_logs n
        where n.user_id = c.user_id
          and n.channel = 'job_alert_digest_v2'
          and n.status = 'sent'
          and n.created_at >= now() - (v_cooldown_days || ' days')::interval
      )
    order by c.registered_at asc
    limit v_cap
  loop
    if not v_is_first then
      perform pg_sleep(3);
    end if;
    v_is_first := false;

    perform net.http_post(
      url := 'https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/send_job_alert_digest_v2',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', v_secret,
        'Authorization', 'Bearer ' || v_jwt
      ),
      body := jsonb_build_object(
        'dry_run', v_dry_run,
        'allow_send', true,
        'confirm', 'SEND_JOB_ALERT_DIGEST_V2',
        'user_id', r.user_id,
        'trigger', 'cron_reactivation'
      ),
      timeout_milliseconds := 60000
    );
  end loop;
end;
$func$;

revoke all on function private.cron_send_job_alert_digest_reactivation() from public;

-- cron.job appartient a supabase_admin : passage oblige par cron.alter_job().
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.alter_job(
      35,
      command => 'select private.cron_send_job_alert_digest_reactivation();'
    );
  end if;
end;
$$;

commit;
