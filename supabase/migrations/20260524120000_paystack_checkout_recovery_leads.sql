begin;

create extension if not exists pgcrypto;

create table if not exists public.paystack_checkout_recovery_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  priority text not null,
  recovery_segment text not null,
  attempt_count integer null,
  statuses text null,
  channels text null,
  last_status text null,
  last_channel text null,
  last_gateway_response text null,
  last_requested_amount_xof integer null,
  inferred_plan text null,
  last_attempt_at timestamptz null,
  reason text null,
  template_key text not null default 'paystack_abandoned_checkout_email_1',
  recommended_state text not null default 'pending',
  imported_at timestamptz not null default now(),
  queued_at timestamptz null,
  sent_at timestamptz null,
  cancelled_at timestamptz null,
  notes text null,
  constraint paystack_checkout_recovery_leads_email_not_empty check (btrim(email) <> ''),
  constraint paystack_checkout_recovery_leads_email_key unique (email),
  constraint paystack_checkout_recovery_leads_priority_check check (
    priority in ('P1', 'P2')
  ),
  constraint paystack_checkout_recovery_leads_segment_check check (
    recovery_segment in (
      'card_abandoned',
      'mobile_money_failed',
      'mobile_money_expired_or_abandoned',
      'multiple_attempts_without_success'
    )
  ),
  constraint paystack_checkout_recovery_leads_attempt_count_check check (
    attempt_count is null or attempt_count >= 0
  ),
  constraint paystack_checkout_recovery_leads_amount_check check (
    last_requested_amount_xof is null or last_requested_amount_xof >= 0
  ),
  constraint paystack_checkout_recovery_leads_template_key_check check (
    template_key = 'paystack_abandoned_checkout_email_1'
  ),
  constraint paystack_checkout_recovery_leads_recommended_state_check check (
    recommended_state in ('pending', 'queued', 'sent', 'cancelled', 'skipped')
  )
);

create unique index if not exists paystack_checkout_recovery_leads_email_normalized_uidx
  on public.paystack_checkout_recovery_leads (lower(btrim(email)));
create index if not exists paystack_checkout_recovery_leads_pending_priority_idx
  on public.paystack_checkout_recovery_leads (priority, last_attempt_at desc)
  where recommended_state = 'pending';
create index if not exists paystack_checkout_recovery_leads_segment_idx
  on public.paystack_checkout_recovery_leads (recovery_segment);

alter table public.paystack_checkout_recovery_leads enable row level security;

revoke all on table public.paystack_checkout_recovery_leads from anon, authenticated;
grant all on table public.paystack_checkout_recovery_leads to service_role;

comment on table public.paystack_checkout_recovery_leads is
  'Imported Paystack checkout recovery leads for manually controlled marketing review.';
comment on column public.paystack_checkout_recovery_leads.last_gateway_response is
  'Non-sensitive gateway outcome text only; card or payment instrument data must never be stored.';

commit;
