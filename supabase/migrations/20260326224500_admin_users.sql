begin;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin',
  is_active boolean not null default true,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_users_user_id_key unique (user_id),
  constraint admin_users_email_key unique (email),
  constraint admin_users_role_check check (role in ('super_admin', 'admin')),
  constraint admin_users_email_normalized_check check (email = lower(btrim(email)) and email <> '')
);

create index if not exists admin_users_role_active_idx
  on public.admin_users (role, is_active, created_at desc);

create or replace function public.admin_users_normalize()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(nullif(btrim(new.email), ''));
  new.role := lower(nullif(btrim(new.role), ''));

  if new.email is null then
    raise exception 'email_required';
  end if;

  if new.role is null then
    raise exception 'role_required';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_admin_users_normalize on public.admin_users;
create trigger trg_admin_users_normalize
before insert or update on public.admin_users
for each row
execute function public.admin_users_normalize();

drop trigger if exists trg_admin_users_updated_at on public.admin_users;
create trigger trg_admin_users_updated_at
before update on public.admin_users
for each row
execute function public.set_updated_at_timestamp();

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
        and au.is_active = true
        and au.role = 'super_admin'
    );
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or exists (
      select 1
      from public.admin_users au
      where au.user_id = auth.uid()
        and au.is_active = true
        and au.role in ('super_admin', 'admin')
    );
$$;

create or replace function public.is_internal_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_user();
$$;

alter table public.admin_users enable row level security;

revoke all on table public.admin_users from public, anon, authenticated;

do $pol$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_users'
      and policyname = 'admin_users_select_self'
  ) then
    execute 'create policy admin_users_select_self on public.admin_users for select using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_users'
      and policyname = 'admin_users_super_admin_select_all'
  ) then
    execute 'create policy admin_users_super_admin_select_all on public.admin_users for select using (public.is_super_admin())';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_users'
      and policyname = 'admin_users_super_admin_insert'
  ) then
    execute 'create policy admin_users_super_admin_insert on public.admin_users for insert with check (public.is_super_admin())';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_users'
      and policyname = 'admin_users_super_admin_update'
  ) then
    execute 'create policy admin_users_super_admin_update on public.admin_users for update using (public.is_super_admin()) with check (public.is_super_admin())';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_users'
      and policyname = 'admin_users_service_role_all'
  ) then
    execute 'create policy admin_users_service_role_all on public.admin_users for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')';
  end if;
end
$pol$;

grant select, insert, update on public.admin_users to authenticated;
grant select, insert, update, delete on public.admin_users to service_role;

do $seed$
declare
  v_seed_user_id constant uuid := 'd8069021-87ff-452a-beb3-e5b708378a7e';
  v_seed_email constant text := 'd.kacoutie@gmail.com';
  v_auth_email text;
  v_existing_id uuid;
begin
  select lower(nullif(btrim(u.email), ''))
  into v_auth_email
  from auth.users u
  where u.id = v_seed_user_id
  limit 1;

  if v_auth_email is null then
    raise notice 'skip admin_users seed: auth.users row % not found', v_seed_user_id;
  else
    if v_auth_email <> v_seed_email then
      raise exception 'admin_users seed mismatch for %: expected %, found %', v_seed_user_id, v_seed_email, v_auth_email;
    end if;

    select au.id
    into v_existing_id
    from public.admin_users au
    where au.user_id = v_seed_user_id
       or au.email = v_seed_email
    order by case when au.user_id = v_seed_user_id then 0 else 1 end
    limit 1
    for update;

    if v_existing_id is null then
      insert into public.admin_users (
        user_id,
        email,
        role,
        is_active,
        created_by_user_id
      )
      values (
        v_seed_user_id,
        v_seed_email,
        'super_admin',
        true,
        v_seed_user_id
      );
    else
      update public.admin_users
      set user_id = v_seed_user_id,
          email = v_seed_email,
          role = 'super_admin',
          is_active = true,
          updated_at = now()
      where id = v_existing_id;
    end if;
  end if;
end
$seed$;

revoke all on function public.is_super_admin() from public;
revoke all on function public.is_admin_user() from public;
revoke all on function public.is_internal_admin() from public;

grant execute on function public.is_super_admin() to authenticated, service_role;
grant execute on function public.is_admin_user() to authenticated, service_role;
grant execute on function public.is_internal_admin() to authenticated, service_role;

commit;
