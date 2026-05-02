begin;

create extension if not exists pgcrypto;

create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  email text not null,
  email_normalized text not null,
  reason text not null,
  source text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint email_suppressions_reason_check check (
    reason in (
      'unsubscribed',
      'hard_bounce',
      'soft_bounce_repeat',
      'spam_complaint',
      'manual_exclusion',
      'test_account'
    )
  ),
  constraint email_suppressions_email_normalized_key unique (email_normalized)
);

create index if not exists email_suppressions_user_id_idx
  on public.email_suppressions (user_id);
create index if not exists email_suppressions_email_normalized_idx
  on public.email_suppressions (email_normalized);
create index if not exists email_suppressions_reason_idx
  on public.email_suppressions (reason);
create index if not exists email_suppressions_created_at_idx
  on public.email_suppressions (created_at desc);

create table if not exists public.email_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  email text not null,
  email_normalized text not null,
  token uuid not null default gen_random_uuid(),
  email_key text not null,
  segment text not null,
  used_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint email_unsubscribe_tokens_token_key unique (token),
  constraint email_unsubscribe_tokens_email_key_not_empty check (btrim(email_key) <> ''),
  constraint email_unsubscribe_tokens_segment_check check (
    segment in (
      'payment_attempt_no_success',
      'interested_no_payment_attempt',
      'buyer_feedback',
      'incomplete_onboarding',
      'expired_pass',
      'former_buyer',
      'job_alert'
    )
  )
);

create index if not exists email_unsubscribe_tokens_user_id_idx
  on public.email_unsubscribe_tokens (user_id);
create index if not exists email_unsubscribe_tokens_email_normalized_idx
  on public.email_unsubscribe_tokens (email_normalized);
create index if not exists email_unsubscribe_tokens_token_idx
  on public.email_unsubscribe_tokens (token);
create index if not exists email_unsubscribe_tokens_email_key_idx
  on public.email_unsubscribe_tokens (email_key);
create index if not exists email_unsubscribe_tokens_used_at_idx
  on public.email_unsubscribe_tokens (used_at);

create table if not exists public.email_sequences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  email_normalized text not null,
  segment text not null,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  stopped_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_sequences_segment_check check (
    segment in (
      'payment_attempt_no_success',
      'interested_no_payment_attempt',
      'buyer_feedback',
      'incomplete_onboarding',
      'expired_pass',
      'former_buyer',
      'job_alert'
    )
  ),
  constraint email_sequences_status_check check (
    status in (
      'active',
      'paused',
      'completed',
      'stopped_by_purchase',
      'stopped_by_unsubscribe',
      'stopped_by_bounce',
      'stopped_by_complaint',
      'stopped_manually'
    )
  ),
  constraint email_sequences_user_segment_key unique (user_id, segment)
);

create index if not exists email_sequences_user_id_idx
  on public.email_sequences (user_id);
create index if not exists email_sequences_email_normalized_idx
  on public.email_sequences (email_normalized);
create index if not exists email_sequences_segment_idx
  on public.email_sequences (segment);
create index if not exists email_sequences_status_idx
  on public.email_sequences (status);
create index if not exists email_sequences_created_at_idx
  on public.email_sequences (created_at desc);

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  sequence_id uuid null references public.email_sequences(id) on delete set null,
  email text not null,
  email_normalized text not null,
  segment text not null,
  email_key text not null,
  template_version text null,
  subject text null,
  dry_run boolean not null default true,
  status text not null default 'dry_run',
  resend_message_id text null,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz null,
  delivered_at timestamptz null,
  opened_at timestamptz null,
  clicked_at timestamptz null,
  bounced_at timestamptz null,
  complained_at timestamptz null,
  unsubscribed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_logs_segment_check check (
    segment in (
      'payment_attempt_no_success',
      'interested_no_payment_attempt',
      'buyer_feedback',
      'incomplete_onboarding',
      'expired_pass',
      'former_buyer',
      'job_alert'
    )
  ),
  constraint email_logs_status_check check (
    status in (
      'dry_run',
      'queued',
      'sent',
      'delivered',
      'opened',
      'clicked',
      'bounced',
      'complained',
      'unsubscribed',
      'skipped',
      'failed'
    )
  ),
  constraint email_logs_email_key_not_empty check (btrim(email_key) <> ''),
  constraint email_logs_email_normalized_email_key_key unique (email_normalized, email_key)
);

create index if not exists email_logs_user_id_idx
  on public.email_logs (user_id);
create index if not exists email_logs_email_normalized_idx
  on public.email_logs (email_normalized);
create index if not exists email_logs_segment_idx
  on public.email_logs (segment);
create index if not exists email_logs_email_key_idx
  on public.email_logs (email_key);
create index if not exists email_logs_status_idx
  on public.email_logs (status);
create index if not exists email_logs_created_at_idx
  on public.email_logs (created_at desc);
create index if not exists email_logs_resend_message_id_idx
  on public.email_logs (resend_message_id);

alter table public.email_suppressions enable row level security;
alter table public.email_unsubscribe_tokens enable row level security;
alter table public.email_sequences enable row level security;
alter table public.email_logs enable row level security;

drop trigger if exists trg_email_sequences_updated_at on public.email_sequences;
create trigger trg_email_sequences_updated_at
before update on public.email_sequences
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists trg_email_logs_updated_at on public.email_logs;
create trigger trg_email_logs_updated_at
before update on public.email_logs
for each row
execute function public.set_updated_at_timestamp();

create or replace view public.jobradar_marketing_reactivation_candidates as
with profile_candidates as (
  select
    p.user_id,
    u.email,
    lower(btrim(u.email)) as email_normalized,
    p.created_at as registered_at,
    nullif(btrim(p.jobradar_onboarding->'profile'->>'desiredRole'), '') as poste_recherche
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where u.email is not null
),
payment_attempts as (
  select
    bp.user_id,
    count(*)::integer as total_payment_attempts,
    max(bp.created_at) as last_payment_attempt_at,
    array_agg(distinct lower(bp.status) order by lower(bp.status)) as payment_statuses
  from public.billing_payments bp
  where lower(bp.status) in ('abandoned', 'pending', 'failed', 'ongoing')
  group by bp.user_id
),
eligible_candidates as (
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
  where pc.poste_recherche is not null
    and pc.email_normalized not like '%@example.com'
    and pc.email_normalized not like '%@go4jobapp.com'
    and pc.email_normalized not in (
      'contact.jobradar@gmail.com',
      'infos.go4job@gmail.com',
      'd.kacoutie@gmail.com',
      'kacoutiedieudonne@gmail.com'
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
    )
),
segmented_candidates as (
  select
    ec.*,
    case
      when ec.total_payment_attempts > 0 then 'payment_attempt_no_success'
      else 'interested_no_payment_attempt'
    end as segment,
    case
      when ec.total_payment_attempts > 0 then 'payment_attempt_no_success_email_1'
      else 'interested_no_payment_attempt_email_1'
    end as suggested_email_key
  from eligible_candidates ec
)
select
  sc.user_id,
  sc.email,
  sc.email_normalized,
  sc.registered_at,
  sc.poste_recherche,
  sc.total_payment_attempts,
  sc.last_payment_attempt_at,
  sc.payment_statuses,
  sc.segment,
  sc.suggested_email_key
from segmented_candidates sc
where not exists (
  select 1
  from public.email_logs el
  where el.email_normalized = sc.email_normalized
    and el.email_key = sc.suggested_email_key
    and el.status in ('dry_run', 'queued', 'sent', 'delivered', 'opened', 'clicked')
);

create or replace view public.jobradar_marketing_reactivation_summary as
select
  segment,
  suggested_email_key,
  count(*)::integer as total_candidates,
  min(registered_at) as oldest_registered_at,
  max(registered_at) as newest_registered_at,
  max(last_payment_attempt_at) as latest_payment_attempt_at
from public.jobradar_marketing_reactivation_candidates
group by segment, suggested_email_key;

revoke all on table public.email_suppressions from anon, authenticated;
revoke all on table public.email_unsubscribe_tokens from anon, authenticated;
revoke all on table public.email_sequences from anon, authenticated;
revoke all on table public.email_logs from anon, authenticated;
revoke all on table public.jobradar_marketing_reactivation_candidates from anon, authenticated;
revoke all on table public.jobradar_marketing_reactivation_summary from anon, authenticated;

grant all on table public.email_suppressions to service_role;
grant all on table public.email_unsubscribe_tokens to service_role;
grant all on table public.email_sequences to service_role;
grant all on table public.email_logs to service_role;
grant select on table public.jobradar_marketing_reactivation_candidates to service_role;
grant select on table public.jobradar_marketing_reactivation_summary to service_role;

commit;
