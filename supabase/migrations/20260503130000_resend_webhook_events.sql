begin;

create table if not exists public.resend_webhook_events (
  id bigserial primary key,
  provider text not null default 'resend',
  event_id text null,
  event_type text not null,
  email text null,
  resend_email_id text null,
  raw_payload jsonb not null,
  headers jsonb null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,
  processing_status text not null default 'processed',
  error_message text null,
  constraint resend_webhook_events_provider_not_empty check (btrim(provider) <> ''),
  constraint resend_webhook_events_event_type_not_empty check (btrim(event_type) <> ''),
  constraint resend_webhook_events_processing_status_check check (
    processing_status in ('processed', 'ignored', 'failed')
  )
);

create unique index if not exists resend_webhook_events_provider_event_id_uidx
  on public.resend_webhook_events (provider, event_id)
  where event_id is not null;

create index if not exists resend_webhook_events_event_type_idx
  on public.resend_webhook_events (event_type);
create index if not exists resend_webhook_events_received_at_idx
  on public.resend_webhook_events (received_at desc);
create index if not exists resend_webhook_events_email_idx
  on public.resend_webhook_events (email);
create index if not exists resend_webhook_events_resend_email_id_idx
  on public.resend_webhook_events (resend_email_id);

alter table public.resend_webhook_events enable row level security;

revoke all on table public.resend_webhook_events from anon, authenticated;
grant all on table public.resend_webhook_events to service_role;
grant usage, select on sequence public.resend_webhook_events_id_seq to service_role;

commit;
