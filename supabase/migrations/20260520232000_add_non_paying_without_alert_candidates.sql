create or replace view public.jobradar_marketing_reactivation_candidates as
with profile_candidates as (
  select
    p.user_id,
    u.email,
    lower(btrim(u.email::text)) as email_normalized,
    p.created_at as registered_at,
    nullif(btrim((p.jobradar_onboarding -> 'profile'::text) ->> 'desiredRole'::text), ''::text) as poste_recherche
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where u.email is not null
    and u.deleted_at is null
),
payment_attempts as (
  select
    bp.user_id,
    count(*)::integer as total_payment_attempts,
    max(bp.created_at) as last_payment_attempt_at,
    array_agg(distinct lower(bp.status) order by lower(bp.status)) as payment_statuses
  from public.billing_payments bp
  where lower(bp.status) = any (array['abandoned', 'pending', 'failed', 'ongoing'])
  group by bp.user_id
),
base_eligible_candidates as (
  select
    pc.user_id,
    pc.email,
    pc.email_normalized,
    pc.registered_at,
    pc.poste_recherche,
    coalesce(pa.total_payment_attempts, 0) as total_payment_attempts,
    pa.last_payment_attempt_at,
    coalesce(pa.payment_statuses, array[]::text[]) as payment_statuses
  from profile_candidates pc
  left join payment_attempts pa on pa.user_id = pc.user_id
  where pc.email_normalized !~~ '%@example.com'::text
    and pc.email_normalized !~~ '%@go4jobapp.com'::text
    and pc.email_normalized <> all (
      array[
        'contact.jobradar@gmail.com',
        'infos.go4job@gmail.com',
        'd.kacoutie@gmail.com',
        'kacoutiedieudonne@gmail.com'
      ]
    )
    and not exists (
      select 1
      from public.email_suppressions es
      where es.email_normalized = pc.email_normalized
    )
    and not exists (
      select 1
      from public.billing_payments paid
      where paid.user_id = pc.user_id
        and lower(paid.status) = 'paid'
        and paid.paid_at is not null
    )
    and not exists (
      select 1
      from public.billing_subscriptions bs
      where bs.user_id = pc.user_id
        and lower(bs.status) = 'active'
        and bs.activated_at is not null
        and (bs.ends_at is null or bs.ends_at > now())
    )
    and not exists (
      select 1
      from public.current_user_pass cup
      where cup.user_id = pc.user_id
        and lower(cup.status) = 'active'
        and cup.activated_at is not null
        and (cup.ends_at is null or cup.ends_at > now())
    )
),
payment_segmented_candidates as (
  select
    ec.user_id,
    ec.email,
    ec.email_normalized,
    ec.registered_at,
    ec.poste_recherche,
    ec.total_payment_attempts,
    ec.last_payment_attempt_at,
    ec.payment_statuses,
    case
      when ec.total_payment_attempts > 0 then 'payment_attempt_no_success'::text
      else 'interested_no_payment_attempt'::text
    end as segment,
    case
      when ec.total_payment_attempts > 0 then 'payment_attempt_no_success_email_1'::text
      else 'interested_no_payment_attempt_email_1'::text
    end as suggested_email_key
  from base_eligible_candidates ec
  where ec.poste_recherche is not null
),
alert_segmented_candidates as (
  select
    ec.user_id,
    ec.email,
    ec.email_normalized,
    ec.registered_at,
    ec.poste_recherche,
    ec.total_payment_attempts,
    ec.last_payment_attempt_at,
    ec.payment_statuses,
    'non_paying_without_alert'::text as segment,
    'create_alert_email_1'::text as suggested_email_key
  from base_eligible_candidates ec
  where not exists (
    select 1
    from public.alerts a
    where a.user_id = ec.user_id
      and coalesce(a.is_active, true) = true
  )
),
all_segmented_candidates as (
  select * from payment_segmented_candidates
  union all
  select * from alert_segmented_candidates
)
select
  user_id,
  email,
  email_normalized,
  registered_at,
  poste_recherche,
  total_payment_attempts,
  last_payment_attempt_at,
  payment_statuses,
  segment,
  suggested_email_key
from all_segmented_candidates sc
where not exists (
  select 1
  from public.email_logs el
  where el.email_normalized = sc.email_normalized
    and el.email_key = sc.suggested_email_key
    and el.status = any (
      array['dry_run', 'queued', 'sent', 'delivered', 'opened', 'clicked']
    )
);
