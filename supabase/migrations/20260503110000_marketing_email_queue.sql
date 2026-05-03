begin;

create extension if not exists pgcrypto;

create table if not exists public.marketing_email_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  email text not null,
  sequence_key text not null,
  step_key text not null,
  template_key text not null,
  segment_key text null,
  status text not null default 'queued',
  priority integer not null default 100,
  scheduled_for timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  last_error text null,
  provider text null,
  provider_message_id text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint marketing_email_queue_status_check check (
    status in ('queued', 'locked', 'sent', 'skipped', 'failed', 'cancelled')
  ),
  constraint marketing_email_queue_email_not_empty check (btrim(email) <> ''),
  constraint marketing_email_queue_sequence_key_not_empty check (btrim(sequence_key) <> ''),
  constraint marketing_email_queue_step_key_not_empty check (btrim(step_key) <> ''),
  constraint marketing_email_queue_template_key_not_empty check (btrim(template_key) <> ''),
  constraint marketing_email_queue_attempts_check check (attempts >= 0),
  constraint marketing_email_queue_max_attempts_check check (max_attempts >= 1),
  constraint marketing_email_queue_priority_check check (priority >= 0)
);

create unique index if not exists marketing_email_queue_email_sequence_step_uidx
  on public.marketing_email_queue (lower(email), sequence_key, step_key);

create index if not exists marketing_email_queue_status_scheduled_for_idx
  on public.marketing_email_queue (status, scheduled_for);
create index if not exists marketing_email_queue_lower_email_idx
  on public.marketing_email_queue (lower(email));
create index if not exists marketing_email_queue_sequence_step_idx
  on public.marketing_email_queue (sequence_key, step_key);
create index if not exists marketing_email_queue_segment_key_idx
  on public.marketing_email_queue (segment_key);
create index if not exists marketing_email_queue_created_at_idx
  on public.marketing_email_queue (created_at desc);

alter table public.marketing_email_queue enable row level security;

drop trigger if exists trg_marketing_email_queue_updated_at on public.marketing_email_queue;
create trigger trg_marketing_email_queue_updated_at
before update on public.marketing_email_queue
for each row
execute function public.set_updated_at_timestamp();

create or replace view public.marketing_email_queue_summary as
select
  status,
  sequence_key,
  step_key,
  template_key,
  segment_key,
  count(*)::integer as total,
  min(created_at) as oldest_created_at,
  max(created_at) as newest_created_at,
  min(scheduled_for) filter (where status = 'queued') as next_scheduled_for,
  count(*) filter (where status = 'sent')::integer as sent_count,
  count(*) filter (where status = 'failed')::integer as failed_count
from public.marketing_email_queue
group by status, sequence_key, step_key, template_key, segment_key;

revoke all on table public.marketing_email_queue from anon, authenticated;
revoke all on table public.marketing_email_queue_summary from anon, authenticated;

grant all on table public.marketing_email_queue to service_role;
grant select on table public.marketing_email_queue_summary to service_role;

commit;
