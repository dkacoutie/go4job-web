-- Fondations notifications Telegram (opt-in, best-effort, en plus de l'email)
--
-- Contexte : profiles.notif_telegram et profiles.telegram_chat_id existent déjà
-- en base (ajoutées manuellement à une date antérieure, jamais documentées
-- dans une migration versionnée). Cette migration les documente de façon
-- idempotente (IF NOT EXISTS, aucun changement si elles existent déjà) et
-- ajoute ce qui manque pour un flux d'opt-in complet et sécurisé.
--
-- Principe de sécurité : telegram_chat_id ne doit jamais pouvoir être écrit
-- directement par un utilisateur authentifié avec une valeur arbitraire (un
-- chat_id Telegram appartenant à quelqu'un d'autre pourrait recevoir les
-- alertes d'un tiers). Un trigger BEFORE UPDATE bloque toute tentative de ce
-- type depuis le client ; seul le webhook Telegram (service_role, après
-- vérification d'un code à usage unique) peut poser une vraie valeur.
-- L'utilisateur authentifié garde le droit de se délier (mettre à null).
--
-- Ne planifie aucun cron ici : voir la migration suivante
-- (20260805091500_jobradar_telegram_digest_notify_cron.sql), à exécuter
-- seulement après déploiement et test manuel des fonctions edge.

begin;

alter table public.profiles
  add column if not exists notif_telegram boolean not null default false,
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_link_code text,
  add column if not exists telegram_link_code_expires_at timestamptz;

create or replace function public.protect_telegram_link_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Un utilisateur authentifié peut se délier (mettre à null) mais jamais
  -- forcer un chat_id : seul le webhook Telegram vérifié peut en poser un.
  if new.telegram_chat_id is distinct from old.telegram_chat_id
     and new.telegram_chat_id is not null then
    new.telegram_chat_id := old.telegram_chat_id;
  end if;

  -- Impossible d'activer notif_telegram sans qu'un chat_id réel soit déjà lié.
  if new.notif_telegram is distinct from old.notif_telegram
     and new.notif_telegram = true
     and old.telegram_chat_id is null then
    new.notif_telegram := old.notif_telegram;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_telegram_link_columns_trg on public.profiles;
create trigger protect_telegram_link_columns_trg
  before update on public.profiles
  for each row
  execute function public.protect_telegram_link_columns();

-- RPC self-service pour se délier : le trigger l'autorise déjà nativement,
-- cette fonction reste pratique côté client pour un appel explicite unique.
create or replace function public.unlink_telegram_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set telegram_chat_id = null,
      notif_telegram = false,
      telegram_link_code = null,
      telegram_link_code_expires_at = null
  where user_id = auth.uid();
end;
$$;

grant execute on function public.unlink_telegram_account() to authenticated;

-- Journal d'idempotence pour l'envoi des pings Telegram : un ping par digest
-- déjà envoyé par email, jamais deux fois pour le même run.
create table if not exists public.jobradar_telegram_notify_log (
  run_id uuid primary key references public.jobradar_digest_runs(id) on delete cascade,
  sent_at timestamptz not null default now()
);

alter table public.jobradar_telegram_notify_log enable row level security;
-- Aucune policy client créée volontairement : table accessible uniquement
-- via service_role (edge function send_telegram_digest_notify).

commit;
