-- Pass gating helper (MVP)
create or replace function public.has_active_pass(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.billing_subscriptions s
    where s.user_id = p_user_id
      and s.status = 'active'
      and s.ends_at > now()
  );
$$;
