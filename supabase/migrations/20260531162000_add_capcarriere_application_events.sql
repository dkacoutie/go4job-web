-- CapCarrière — audit trail + future send columns
-- Production-applied manually on 2026-05-31.
-- No email sending. No real application creation.

begin;

alter table public.cc_application_drafts
  add column if not exists send_attempt_count integer not null default 0,
  add column if not exists send_provider text null,
  add column if not exists send_provider_message_id text null,
  add column if not exists send_error text null,
  add column if not exists last_send_attempt_at timestamptz null,
  add column if not exists user_consent_at timestamptz null,
  add column if not exists approval_ip text null,
  add column if not exists approval_user_agent text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cc_application_drafts_send_attempt_count_non_negative'
      and conrelid = 'public.cc_application_drafts'::regclass
  ) then
    alter table public.cc_application_drafts
      add constraint cc_application_drafts_send_attempt_count_non_negative
      check (send_attempt_count >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'cc_application_drafts_provider_message_requires_sent_at'
      and conrelid = 'public.cc_application_drafts'::regclass
  ) then
    alter table public.cc_application_drafts
      add constraint cc_application_drafts_provider_message_requires_sent_at
      check (
        send_provider_message_id is null
        or sent_at is not null
      );
  end if;
end $$;

create table if not exists public.cc_application_events (
  id uuid primary key default gen_random_uuid(),

  draft_id uuid not null
    references public.cc_application_drafts(id)
    on delete cascade,

  user_id uuid not null
    references public.profiles(user_id)
    on delete cascade,

  event_type text not null,
  from_status text null,
  to_status text null,

  triggered_by text not null default 'system',

  ip text null,
  user_agent text null,

  metadata_json jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cc_application_events_event_type_check'
      and conrelid = 'public.cc_application_events'::regclass
  ) then
    alter table public.cc_application_events
      add constraint cc_application_events_event_type_check
      check (
        event_type in (
          'draft_created',
          'draft_generated',
          'draft_edited',
          'user_reviewed',
          'user_approved',
          'user_rejected',
          'send_requested',
          'send_attempted',
          'sent',
          'send_failed',
          'cancelled',
          'blocked'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'cc_application_events_triggered_by_check'
      and conrelid = 'public.cc_application_events'::regclass
  ) then
    alter table public.cc_application_events
      add constraint cc_application_events_triggered_by_check
      check (
        triggered_by in (
          'system',
          'user',
          'admin',
          'rpc',
          'edge_function'
        )
      );
  end if;
end $$;

create index if not exists idx_cc_application_events_draft_id
  on public.cc_application_events (draft_id);

create index if not exists idx_cc_application_events_user_id
  on public.cc_application_events (user_id);

create index if not exists idx_cc_application_events_draft_created
  on public.cc_application_events (draft_id, created_at desc);

create index if not exists idx_cc_application_events_user_created
  on public.cc_application_events (user_id, created_at desc);

alter table public.cc_application_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'cc_application_events'
      and policyname = 'cc_application_events_user_select_own'
  ) then
    create policy cc_application_events_user_select_own
      on public.cc_application_events
      for select
      using (user_id = auth.uid());
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'cc_application_events'
      and policyname = 'cc_application_events_no_direct_insert'
  ) then
    create policy cc_application_events_no_direct_insert
      on public.cc_application_events
      for insert
      with check (false);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'cc_application_events'
      and policyname = 'cc_application_events_no_update'
  ) then
    create policy cc_application_events_no_update
      on public.cc_application_events
      for update
      using (false);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'cc_application_events'
      and policyname = 'cc_application_events_no_delete'
  ) then
    create policy cc_application_events_no_delete
      on public.cc_application_events
      for delete
      using (false);
  end if;
end $$;

commit;
