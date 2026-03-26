begin;

alter table public.partner_accounts
  add column if not exists application_message text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

create or replace function public.partner_request_apply(
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
  v_partner public.partner_accounts%rowtype;
  v_auth_email text;
  v_effective_contact_email text;
  v_display_name text := nullif(btrim(p_display_name), '');
  v_contact_name text := nullif(btrim(p_contact_name), '');
  v_application_message text := nullif(btrim(p_application_message), '');
  v_terms_version text := nullif(btrim(p_terms_version), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
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

  v_effective_contact_email := lower(coalesce(nullif(btrim(p_contact_email), ''), v_auth_email));

  select *
  into v_partner
  from public.partner_accounts
  where user_id = v_uid
  limit 1
  for update;

  if found then
    if v_partner.status <> 'pending' then
      return v_partner;
    end if;

    update public.partner_accounts
    set display_name = v_display_name,
        contact_name = coalesce(v_contact_name, contact_name),
        contact_email = v_effective_contact_email,
        application_message = v_application_message,
        terms_accepted_at = now(),
        terms_version = v_terms_version
    where id = v_partner.id
    returning *
    into v_partner;

    return v_partner;
  end if;

  select *
  into v_partner
  from public.partner_accounts
  where user_id is null
    and contact_email = v_auth_email
  order by created_at asc
  limit 1
  for update;

  if found then
    update public.partner_accounts
    set user_id = v_uid,
        display_name = v_display_name,
        contact_name = coalesce(v_contact_name, contact_name),
        contact_email = v_effective_contact_email,
        application_message = coalesce(v_application_message, application_message),
        terms_accepted_at = now(),
        terms_version = v_terms_version
    where id = v_partner.id
    returning *
    into v_partner;

    return v_partner;
  end if;

  insert into public.partner_accounts (
    user_id,
    status,
    display_name,
    contact_name,
    contact_email,
    application_message,
    terms_accepted_at,
    terms_version
  )
  values (
    v_uid,
    'pending',
    v_display_name,
    v_contact_name,
    v_effective_contact_email,
    v_application_message,
    now(),
    v_terms_version
  )
  returning *
  into v_partner;

  return v_partner;
end;
$$;

revoke all on function public.partner_request_apply(text, text, text, text, text) from public;
grant execute on function public.partner_request_apply(text, text, text, text, text) to authenticated, service_role;

commit;
