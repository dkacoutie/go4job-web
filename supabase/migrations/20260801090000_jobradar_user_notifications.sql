-- Centre de notifications interne JobRadar V1.
--
-- Additif uniquement :
-- - n'utilise pas notification_logs, qui reste un journal d'envoi email ;
-- - ne cree jamais une ligne par offre ;
-- - reserve la creation aux triggers/fonctions serveur ;
-- - laisse le client marquer seulement read_at.

begin;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'new_matches',
    'alert_active',
    'saved_job_expiring',
    'subscription_status'
  )),
  title text not null,
  body text not null,
  cta_label text,
  cta_path text,
  related_id uuid,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists user_notifications_dedupe_uidx
  on public.user_notifications (user_id, dedupe_key);

create index if not exists user_notifications_unread_idx
  on public.user_notifications (user_id)
  where read_at is null;

create index if not exists user_notifications_feed_idx
  on public.user_notifications (user_id, created_at desc);

alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_select_own on public.user_notifications;
create policy user_notifications_select_own
  on public.user_notifications
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists user_notifications_update_read_own on public.user_notifications;
create policy user_notifications_update_read_own
  on public.user_notifications
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_notifications_insert_service on public.user_notifications;
create policy user_notifications_insert_service
  on public.user_notifications
  for insert
  to service_role
  with check (true);

revoke all on table public.user_notifications from anon, authenticated;
grant select on table public.user_notifications to authenticated;
grant update (read_at) on table public.user_notifications to authenticated;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from anon, authenticated;

insert into public.app_settings (key, value)
values ('notifications_generation_enabled', 'false'::jsonb)
on conflict (key) do nothing;

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
before update on public.app_settings
for each row
execute function public.set_updated_at_timestamp();

create or replace function public.notify_alert_activated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert_name text;
begin
  if new.is_active is not true then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.is_active is true then
    return new;
  end if;

  v_alert_name := coalesce(nullif(btrim(new.name), ''), 'JobRadar');

  insert into public.user_notifications (
    user_id,
    kind,
    title,
    body,
    cta_label,
    cta_path,
    related_id,
    dedupe_key
  )
  values (
    new.user_id,
    'alert_active',
    'Alerte activee',
    format('Ton alerte "%s" est active. Les prochaines offres importantes apparaitront ici.', v_alert_name),
    'Voir mon alerte',
    '/jobradar/alerts',
    new.id,
    'alert_active:' || new.id::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

revoke all on function public.notify_alert_activated() from public, anon, authenticated;
grant execute on function public.notify_alert_activated() to service_role;

drop trigger if exists trg_notify_alert_activated on public.alerts;
create trigger trg_notify_alert_activated
after insert or update of is_active on public.alerts
for each row
execute function public.notify_alert_activated();

comment on table public.user_notifications is
  'Centre de notifications interne JobRadar. Une ligne represente un evenement agrege utilisateur, jamais une offre individuelle.';

comment on column public.user_notifications.dedupe_key is
  'Cle idempotente par utilisateur et evenement agrege, par exemple alert_active:<alert_id> ou new_matches:<alert_id>:<period>.';

comment on table public.app_settings is
  'Parametres applicatifs controles cote serveur. notifications_generation_enabled reste false tant que les generateurs batch ne sont pas actives.';

commit;
