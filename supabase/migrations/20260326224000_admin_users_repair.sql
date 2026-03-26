begin;

do $$
declare
  v_has_table boolean;
  v_has_legacy_is_super_admin boolean;
begin
  select to_regclass('public.admin_users') is not null into v_has_table;

  if not v_has_table then
    raise exception 'admin_users_repair: public.admin_users does not exist';
  end if;

  alter table public.admin_users
    add column if not exists id uuid,
    add column if not exists user_id uuid,
    add column if not exists email text,
    add column if not exists role text,
    add column if not exists is_active boolean,
    add column if not exists created_by_user_id uuid,
    add column if not exists created_at timestamptz,
    add column if not exists updated_at timestamptz;

  alter table public.admin_users alter column id set default gen_random_uuid();
  alter table public.admin_users alter column role set default 'admin';
  alter table public.admin_users alter column is_active set default true;
  alter table public.admin_users alter column created_at set default now();
  alter table public.admin_users alter column updated_at set default now();

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_users'
      and column_name = 'is_super_admin'
  )
  into v_has_legacy_is_super_admin;

  update public.admin_users
  set id = gen_random_uuid()
  where id is null;

  update public.admin_users
  set email = lower(nullif(btrim(email), ''))
  where email is not null;

  update public.admin_users au
  set email = lower(nullif(btrim(u.email), ''))
  from auth.users u
  where au.user_id = u.id
    and (au.email is null or nullif(btrim(au.email), '') is null);

  update public.admin_users
  set role = lower(nullif(btrim(role), ''))
  where role is not null;

  if v_has_legacy_is_super_admin then
    execute $sql$
      update public.admin_users
      set role = case
        when coalesce(is_super_admin, false) then 'super_admin'
        else coalesce(role, 'admin')
      end
      where role is null
         or role not in ('super_admin', 'admin')
    $sql$;
  else
    update public.admin_users
    set role = 'admin'
    where role is null;
  end if;

  update public.admin_users
  set is_active = true
  where is_active is null;

  update public.admin_users
  set created_at = now()
  where created_at is null;

  update public.admin_users
  set updated_at = coalesce(updated_at, created_at, now())
  where updated_at is null;

  update public.admin_users au
  set created_by_user_id = null
  where au.created_by_user_id is not null
    and not exists (
      select 1
      from auth.users u
      where u.id = au.created_by_user_id
    );

  update public.admin_users
  set role = 'super_admin',
      is_active = true,
      updated_at = now()
  where user_id = 'd8069021-87ff-452a-beb3-e5b708378a7e'::uuid
     or email = 'd.kacoutie@gmail.com';

  if exists (
    select 1
    from public.admin_users
    where id is null
  ) then
    raise exception 'admin_users_repair: null id remains';
  end if;

  if exists (
    select 1
    from public.admin_users
    where user_id is null
  ) then
    raise exception 'admin_users_repair: null user_id remains';
  end if;

  if exists (
    select 1
    from public.admin_users
    where email is null
  ) then
    raise exception 'admin_users_repair: null email remains';
  end if;

  if exists (
    select 1
    from public.admin_users
    where role not in ('super_admin', 'admin')
  ) then
    raise exception 'admin_users_repair: invalid role values remain';
  end if;

  if exists (
    select 1
    from public.admin_users au
    left join auth.users u on u.id = au.user_id
    where u.id is null
  ) then
    raise exception 'admin_users_repair: some user_id values do not reference auth.users';
  end if;

  if exists (
    select 1
    from public.admin_users
    group by user_id
    having count(*) > 1
  ) then
    raise exception 'admin_users_repair: duplicate user_id values detected';
  end if;

  if exists (
    select 1
    from public.admin_users
    group by email
    having count(*) > 1
  ) then
    raise exception 'admin_users_repair: duplicate email values detected';
  end if;
end
$$;

alter table public.admin_users alter column id set not null;
alter table public.admin_users alter column user_id set not null;
alter table public.admin_users alter column email set not null;
alter table public.admin_users alter column role set not null;
alter table public.admin_users alter column is_active set not null;
alter table public.admin_users alter column created_at set not null;
alter table public.admin_users alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.admin_users'::regclass
      and contype = 'p'
  ) then
    alter table public.admin_users
      add constraint admin_users_pkey primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.admin_users'::regclass
      and conname = 'admin_users_role_check'
  ) then
    alter table public.admin_users
      add constraint admin_users_role_check
      check (role in ('super_admin', 'admin'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.admin_users'::regclass
      and conname = 'admin_users_email_normalized_check'
  ) then
    alter table public.admin_users
      add constraint admin_users_email_normalized_check
      check (email = lower(btrim(email)) and email <> '');
  end if;
end
$$;

create unique index if not exists admin_users_user_id_key
  on public.admin_users (user_id);

create unique index if not exists admin_users_email_key
  on public.admin_users (email);

create index if not exists admin_users_role_active_idx
  on public.admin_users (role, is_active, created_at desc);

commit;
