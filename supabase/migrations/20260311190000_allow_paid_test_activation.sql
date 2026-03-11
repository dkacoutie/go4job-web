-- Allow paid_test payments to activate passes (test behaves like live)
create or replace function public.activate_pass_from_payment(p_payment_id uuid)
returns public.billing_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.billing_payments%rowtype;
  v_plan public.billing_plans%rowtype;
  v_now timestamptz := now();
  v_sub public.billing_subscriptions%rowtype;
  v_is_test boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_allowed';
  end if;

  select * into v_payment
  from public.billing_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  if v_payment.status not in ('paid', 'paid_test') then
    raise exception 'payment_not_paid';
  end if;

  v_is_test := v_payment.status = 'paid_test'
    or coalesce((v_payment.provider_payload->>'test_mode')::boolean, false);

  select * into v_plan
  from public.billing_plans
  where id = v_payment.plan_id;

  if not found then
    raise exception 'plan_not_found';
  end if;

  -- if already activated for this payment, return it
  select * into v_sub
  from public.billing_subscriptions
  where source_payment_id = v_payment.id
  limit 1;

  if found then
    return v_sub;
  end if;

  -- expire any current active pass
  update public.billing_subscriptions
  set status = 'expired',
      ends_at = least(ends_at, v_now),
      updated_at = v_now
  where user_id = v_payment.user_id
    and status = 'active';

  insert into public.billing_subscriptions(
    user_id, plan_id, source_payment_id, status,
    starts_at, ends_at, activated_at, created_at, updated_at
  )
  values (
    v_payment.user_id,
    v_payment.plan_id,
    v_payment.id,
    'active',
    v_now,
    v_now + (v_plan.duration_days || ' days')::interval,
    v_now,
    v_now,
    v_now
  )
  returning * into v_sub;

  insert into public.billing_events(user_id, event_type, payload)
  values (
    v_payment.user_id,
    'pass_activated',
    jsonb_build_object('payment_id', v_payment.id, 'plan_id', v_plan.id, 'test_mode', v_is_test)
  );

  return v_sub;
end;
$$;
