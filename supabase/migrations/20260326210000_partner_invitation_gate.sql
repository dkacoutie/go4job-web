begin;

create table if not exists public.partner_invitations (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partner_accounts(id) on delete cascade,
  invitation_token text not null unique,
  status text not null default 'active' check (status in ('active', 'used', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_by_user_id uuid null,
  used_by_user_id uuid null,
  used_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_invitations_partner_status_idx
  on public.partner_invitations (partner_id, status, expires_at desc);

alter table public.partner_invitations enable row level security;

revoke all on table public.partner_invitations from anon, authenticated;

create or replace function public.partner_validate_invitation(
  p_invitation_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(p_invitation_token), '');
  v_invitation public.partner_invitations%rowtype;
  v_partner public.partner_accounts%rowtype;
begin
  if v_token is null then
    raise exception 'invitation_token_required';
  end if;

  select *
  into v_invitation
  from public.partner_invitations
  where invitation_token = v_token
  limit 1
  for update;

  if not found then
    raise exception 'invitation_not_found';
  end if;

  if v_invitation.status = 'used' then
    raise exception 'invitation_used';
  end if;

  if v_invitation.status = 'revoked' then
    raise exception 'invitation_revoked';
  end if;

  if v_invitation.status = 'expired' or v_invitation.expires_at <= now() then
    update public.partner_invitations
    set status = 'expired',
        updated_at = now()
    where id = v_invitation.id
      and status = 'active';

    raise exception 'invitation_expired';
  end if;

  select *
  into v_partner
  from public.partner_accounts
  where id = v_invitation.partner_id
  limit 1;

  if not found then
    raise exception 'invitation_partner_not_found';
  end if;

  return jsonb_build_object(
    'partner_id', v_partner.id,
    'display_name', v_partner.display_name,
    'contact_name', v_partner.contact_name,
    'contact_email', v_partner.contact_email,
    'partner_status', v_partner.status,
    'expires_at', v_invitation.expires_at
  );
end;
$$;

create or replace function public.partner_admin_generate_invitation(
  p_partner_id uuid,
  p_expires_in_days integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_partner public.partner_accounts%rowtype;
  v_invitation public.partner_invitations%rowtype;
  v_token text;
  v_is_admin boolean := false;
  v_days integer := greatest(coalesce(p_expires_in_days, 14), 1);
  v_base_url text := 'https://jobradar.go4jobapp.com/devenir-partenaire?invite=';
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select coalesce(p.is_admin, false)
  into v_is_admin
  from public.profiles p
  where p.user_id = v_uid
  limit 1;

  if not v_is_admin then
    raise exception 'admin_required';
  end if;

  select *
  into v_partner
  from public.partner_accounts
  where id = p_partner_id
  limit 1
  for update;

  if not found then
    raise exception 'partner_not_found';
  end if;

  update public.partner_invitations
  set status = case when expires_at <= now() then 'expired' else 'revoked' end,
      updated_at = now()
  where partner_id = p_partner_id
    and status = 'active';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.partner_invitations (
    partner_id,
    invitation_token,
    status,
    expires_at,
    created_by_user_id
  )
  values (
    p_partner_id,
    v_token,
    'active',
    now() + make_interval(days => v_days),
    v_uid
  )
  returning *
  into v_invitation;

  return jsonb_build_object(
    'invitation_id', v_invitation.id,
    'partner_id', v_partner.id,
    'display_name', v_partner.display_name,
    'status', v_invitation.status,
    'expires_at', v_invitation.expires_at,
    'invitation_token', v_token,
    'invitation_url', v_base_url || v_token
  );
end;
$$;

drop function if exists public.partner_request_apply(text, text, text, text, text);

create or replace function public.partner_request_apply(
  p_invitation_token text,
  p_display_name text,
  p_contact_name text default null,
  p_contact_email text default null,
  p_application_message text default null,
  p_terms_version text default 'partner_terms_v1'
)
returns public.partner_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invitation public.partner_invitations%rowtype;
  v_partner public.partner_accounts%rowtype;
  v_auth_email text;
  v_effective_contact_email text;
  v_display_name text := nullif(btrim(p_display_name), '');
  v_contact_name text := nullif(btrim(p_contact_name), '');
  v_application_message text := nullif(btrim(p_application_message), '');
  v_terms_version text := nullif(btrim(p_terms_version), '');
  v_invitation_token text := nullif(btrim(p_invitation_token), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if v_invitation_token is null then
    raise exception 'invitation_token_required';
  end if;

  if v_display_name is null then
    raise exception 'display_name_required';
  end if;

  if v_terms_version is null then
    raise exception 'terms_version_required';
  end if;

  select lower(nullif(btrim(u.email), ''))
  into v_auth_email
  from auth.users u
  where u.id = v_uid
  limit 1;

  if v_auth_email is null then
    raise exception 'authenticated_email_required';
  end if;

  select *
  into v_invitation
  from public.partner_invitations
  where invitation_token = v_invitation_token
  limit 1
  for update;

  if not found then
    raise exception 'invitation_not_found';
  end if;

  if v_invitation.status = 'used' then
    raise exception 'invitation_used';
  end if;

  if v_invitation.status = 'revoked' then
    raise exception 'invitation_revoked';
  end if;

  if v_invitation.status = 'expired' or v_invitation.expires_at <= now() then
    update public.partner_invitations
    set status = 'expired',
        updated_at = now()
    where id = v_invitation.id
      and status = 'active';

    raise exception 'invitation_expired';
  end if;

  select *
  into v_partner
  from public.partner_accounts
  where id = v_invitation.partner_id
  limit 1
  for update;

  if not found then
    raise exception 'invitation_partner_not_found';
  end if;

  if v_partner.user_id is not null and v_partner.user_id <> v_uid then
    raise exception 'invitation_reserved';
  end if;

  if v_partner.contact_email is not null and lower(v_partner.contact_email) <> v_auth_email then
    raise exception 'invitation_email_mismatch';
  end if;

  v_effective_contact_email := lower(
    coalesce(
      nullif(btrim(p_contact_email), ''),
      nullif(btrim(v_partner.contact_email), ''),
      v_auth_email
    )
  );

  update public.partner_accounts
  set user_id = coalesce(user_id, v_uid),
      status = case when v_partner.status in ('paused', 'inactive') then v_partner.status else 'active' end,
      display_name = v_display_name,
      contact_name = coalesce(v_contact_name, contact_name),
      contact_email = v_effective_contact_email,
      application_message = coalesce(v_application_message, application_message),
      terms_accepted_at = now(),
      terms_version = v_terms_version,
      updated_at = now()
  where id = v_partner.id
  returning *
  into v_partner;

  update public.partner_invitations
  set status = 'used',
      used_by_user_id = v_uid,
      used_at = now(),
      updated_at = now()
  where id = v_invitation.id;

  update public.partner_invitations
  set status = case when expires_at <= now() then 'expired' else 'revoked' end,
      updated_at = now()
  where partner_id = v_partner.id
    and status = 'active'
    and id <> v_invitation.id;

  return v_partner;
end;
$$;

revoke all on function public.partner_validate_invitation(text) from public;
grant execute on function public.partner_validate_invitation(text) to anon, authenticated, service_role;

revoke all on function public.partner_admin_generate_invitation(uuid, integer) from public;
grant execute on function public.partner_admin_generate_invitation(uuid, integer) to authenticated, service_role;

revoke all on function public.partner_request_apply(text, text, text, text, text, text) from public;
grant execute on function public.partner_request_apply(text, text, text, text, text, text) to authenticated, service_role;

commit;
