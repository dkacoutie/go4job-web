create table if not exists public.cc_cv_events (
  id uuid primary key default gen_random_uuid(),

  cv_version_id uuid not null references public.cc_cv_versions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,

  event_type text not null,

  from_status text,
  to_status text,

  triggered_by text not null default 'system',

  metadata_json jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint cc_cv_events_event_type_check check (
    event_type in (
      'cv_imported',
      'candidate_confirmed',
      'marked_current',
      'review_ready_enabled',
      'autopilot_ready_enabled',
      'revoked',
      'archived',
      'rejected',
      'manual_audit'
    )
  ),

  constraint cc_cv_events_triggered_by_check check (
    triggered_by in (
      'system',
      'candidate',
      'admin',
      'service_role'
    )
  )
);

alter table public.cc_cv_events enable row level security;

create index if not exists cc_cv_events_cv_version_id_idx
  on public.cc_cv_events(cv_version_id);

create index if not exists cc_cv_events_user_id_idx
  on public.cc_cv_events(user_id);

create index if not exists cc_cv_events_event_type_idx
  on public.cc_cv_events(event_type);

create index if not exists cc_cv_events_created_at_idx
  on public.cc_cv_events(created_at desc);