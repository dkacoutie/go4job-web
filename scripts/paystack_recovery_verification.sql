-- Run manually after applying the migration and reviewing/running the generated import SQL.

-- 1. Total imported leads.
select count(*)::integer as total_leads
from public.paystack_checkout_recovery_leads;

-- 2. Distribution by priority.
select priority, count(*)::integer as total
from public.paystack_checkout_recovery_leads
group by priority
order by priority;

-- 3. Distribution by recovery segment.
select recovery_segment, count(*)::integer as total
from public.paystack_checkout_recovery_leads
group by recovery_segment
order by total desc, recovery_segment;

-- 4. Internal/test emails detected by the dedicated function rules.
select id, email, priority, recovery_segment
from public.paystack_checkout_recovery_leads
where lower(btrim(email)) like '%@example.com'
   or lower(btrim(email)) like '%@example.org'
   or lower(btrim(email)) like '%@go4jobapp.com'
   or lower(btrim(email)) like '%.test'
   or lower(btrim(email)) ~ '(^|[+._-])test([+._-]|@)'
   or lower(btrim(email)) in (
     'contact.jobradar@gmail.com',
     'infos.go4job@gmail.com',
     'd.kacoutie@gmail.com',
     'kacoutiedieudonne@gmail.com'
   )
order by imported_at desc;

-- 5. Converted leads according to billing_payments and active pass sources.
select l.id, l.email, u.id as user_id, l.priority, l.recovery_segment
from public.paystack_checkout_recovery_leads l
join auth.users u on lower(btrim(u.email::text)) = lower(btrim(l.email))
where exists (
    select 1
    from public.billing_payments bp
    where bp.user_id = u.id
      and lower(bp.status) = 'paid'
      and bp.paid_at is not null
  )
  or exists (
    select 1
    from public.billing_subscriptions bs
    where bs.user_id = u.id
      and lower(bs.status) = 'active'
      and bs.activated_at is not null
      and (bs.ends_at is null or bs.ends_at > now())
  )
  or exists (
    select 1
    from public.current_user_pass cup
    where cup.user_id = u.id
      and lower(cup.status) = 'active'
      and cup.activated_at is not null
      and (cup.ends_at is null or cup.ends_at > now())
  )
order by l.imported_at desc;

-- 6. Suppressed leads, including unsubscribe suppressions.
select l.email, es.reason, es.source, es.created_at
from public.paystack_checkout_recovery_leads l
join public.email_suppressions es
  on es.email_normalized = lower(btrim(l.email))
order by es.created_at desc;

-- 7. Leads with an existing unsubscribe token; used tokens are blocked in dry-run.
select
  l.email,
  count(t.id)::integer as token_count,
  bool_or(t.used_at is not null) as has_used_unsubscribe_token,
  max(t.used_at) as last_used_at
from public.paystack_checkout_recovery_leads l
join public.email_unsubscribe_tokens t
  on t.email_normalized = lower(btrim(l.email))
group by l.email
order by last_used_at desc nulls last, l.email;

-- 8. Leads already present in queue or logs for this campaign/template.
select
  'queue' as source,
  q.email,
  q.status,
  q.created_at,
  q.template_key
from public.marketing_email_queue q
join public.paystack_checkout_recovery_leads l
  on lower(btrim(q.email)) = lower(btrim(l.email))
where q.sequence_key = 'paystack_abandoned_checkout'
  and q.step_key = 'email_1'
  and q.template_key = 'paystack_abandoned_checkout_email_1'
union all
select
  'log' as source,
  el.email,
  el.status,
  el.created_at,
  coalesce(el.metadata->>'template_key', el.email_key) as template_key
from public.email_logs el
join public.paystack_checkout_recovery_leads l
  on el.email_normalized = lower(btrim(l.email))
where el.email_key in (
    'paystack_abandoned_checkout:email_1',
    'paystack_abandoned_checkout_email_1'
  )
   or el.metadata->>'template_key' = 'paystack_abandoned_checkout_email_1'
order by created_at desc;

-- 9. Recent queue rows for the recovery template.
select id, email, status, sequence_key, step_key, template_key, created_at, sent_at
from public.marketing_email_queue
where template_key = 'paystack_abandoned_checkout_email_1'
order by created_at desc
limit 50;

-- 10. Recent logs for the recovery template/campaign.
select id, email, status, email_key, metadata->>'template_key' as template_key, created_at, sent_at
from public.email_logs
where email_key in (
    'paystack_abandoned_checkout:email_1',
    'paystack_abandoned_checkout_email_1'
  )
   or metadata->>'template_key' = 'paystack_abandoned_checkout_email_1'
order by created_at desc
limit 50;
