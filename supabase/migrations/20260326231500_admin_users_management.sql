begin;

create or replace function public.admin_list_admin_users()
returns table (
  id uuid,
  user_id uuid,
  email text,
  role text,
  is_active boolean,
  created_by_user_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  is_current_user boolean,
  is_protected boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.is_super_admin() then
    raise exception 'not_allowed';
  end if;

  return query
  select
    au.id,
    au.user_id,
    au.email,
    au.role,
    au.is_active,
    au.created_by_user_id,
    au.created_at,
    au.updated_at,
    au.user_id = auth.uid() as is_current_user,
    au.user_id = 'd8069021-87ff-452a-beb3-e5b708378a7e'::uuid or au.role = 'super_admin' as is_protected
  from public.admin_users au
  order by
    case when au.role = 'super_admin' then 0 else 1 end,
    case when au.is_active then 0 else 1 end,
    au.created_at asc;
end;
$$;

create or replace function public.admin_grant_admin_access(
  p_email text
)
returns public.admin_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(p_email), ''));
  v_auth_user auth.users%rowtype;
  v_admin_user public.admin_users%rowtype;
begin
  if auth.role() <> 'service_role' and not public.is_super_admin() then
    raise exception 'not_allowed';
  end if;

  if v_email is null then
    raise exception 'email_required';
  end if;

  select *
  into v_auth_user
  from auth.users u
  where lower(nullif(btrim(u.email), '')) = v_email
  order by u.created_at asc
  limit 1;

  if not found then
    raise exception 'auth_user_not_found';
  end if;

  if v_auth_user.id = 'd8069021-87ff-452a-beb3-e5b708378a7e'::uuid then
    raise exception 'protected_super_admin';
  end if;

  select *
  into v_admin_user
  from public.admin_users au
  where au.user_id = v_auth_user.id
     or au.email = v_email
  limit 1
  for update;

  if found and v_admin_user.role = 'super_admin' then
    raise exception 'target_is_super_admin';
  end if;

  if not found then
    insert into public.admin_users (
      user_id,
      email,
      role,
      is_active,
      created_by_user_id
    )
    values (
      v_auth_user.id,
      v_email,
      'admin',
      true,
      auth.uid()
    )
    returning *
    into v_admin_user;
  else
    update public.admin_users
    set user_id = v_auth_user.id,
        email = v_email,
        role = 'admin',
        is_active = true,
        updated_at = now()
    where id = v_admin_user.id
    returning *
    into v_admin_user;
  end if;

  return v_admin_user;
end;
$$;

create or replace function public.admin_set_admin_user_active(
  p_admin_user_id uuid,
  p_is_active boolean
)
returns public.admin_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_user public.admin_users%rowtype;
begin
  if auth.role() <> 'service_role' and not public.is_super_admin() then
    raise exception 'not_allowed';
  end if;

  if p_admin_user_id is null then
    raise exception 'admin_user_id_required';
  end if;

  select *
  into v_admin_user
  from public.admin_users au
  where au.id = p_admin_user_id
  limit 1
  for update;

  if not found then
    raise exception 'admin_user_not_found';
  end if;

  if v_admin_user.user_id = 'd8069021-87ff-452a-beb3-e5b708378a7e'::uuid then
    raise exception 'protected_super_admin';
  end if;

  if v_admin_user.role = 'super_admin' then
    raise exception 'super_admin_cannot_be_modified_here';
  end if;

  if not p_is_active and v_admin_user.user_id = auth.uid() then
    raise exception 'cannot_disable_yourself';
  end if;

  update public.admin_users
  set is_active = p_is_active,
      updated_at = now()
  where id = v_admin_user.id
  returning *
  into v_admin_user;

  return v_admin_user;
end;
$$;

revoke all on function public.admin_list_admin_users() from public;
revoke all on function public.admin_grant_admin_access(text) from public;
revoke all on function public.admin_set_admin_user_active(uuid, boolean) from public;

grant execute on function public.admin_list_admin_users() to authenticated, service_role;
grant execute on function public.admin_grant_admin_access(text) to authenticated, service_role;
grant execute on function public.admin_set_admin_user_active(uuid, boolean) to authenticated, service_role;

commit;
