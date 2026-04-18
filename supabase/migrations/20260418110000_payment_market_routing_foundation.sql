begin;

alter table public.profiles
  add column if not exists payment_preference text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_payment_preference_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_payment_preference_check
      check (payment_preference is null or payment_preference in ('eur', 'xof'));
  end if;
end
$$;

comment on column public.profiles.payment_preference is
  'Preference marche paiement utilisateur. Valeurs autorisees: eur, xof.';

create or replace function public.set_payment_preference(pref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if pref not in ('eur', 'xof') then
    raise exception 'Invalid payment preference: %', pref;
  end if;

  update public.profiles
  set payment_preference = pref,
      updated_at = now()
  where user_id = auth.uid();

  if not found then
    raise exception 'Profile not found for authenticated user';
  end if;
end;
$$;

revoke all on function public.set_payment_preference(text) from public;
grant execute on function public.set_payment_preference(text) to authenticated;

commit;
