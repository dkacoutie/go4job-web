create table if not exists public.cv_ats_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  source text not null default 'cv_ats_landing',
  utm_source text null,
  utm_medium text null,
  utm_campaign text null,
  utm_content text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint cv_ats_events_event_type_check check (
    event_type in ('whatsapp_cta_click')
  ),
  constraint cv_ats_events_source_check check (
    source in ('cv_ats_landing')
  )
);

create index if not exists cv_ats_events_event_type_created_idx
  on public.cv_ats_events(event_type, created_at desc);

create index if not exists cv_ats_events_source_created_idx
  on public.cv_ats_events(source, created_at desc);

create index if not exists cv_ats_events_utm_campaign_idx
  on public.cv_ats_events(utm_campaign);

alter table public.cv_ats_events enable row level security;

revoke all on table public.cv_ats_events from anon, authenticated;
grant insert on table public.cv_ats_events to anon, authenticated;
grant all on table public.cv_ats_events to service_role;

drop policy if exists cv_ats_events_public_whatsapp_insert
  on public.cv_ats_events;

create policy cv_ats_events_public_whatsapp_insert
  on public.cv_ats_events
  for insert
  to anon, authenticated
  with check (
    event_type = 'whatsapp_cta_click'
    and source = 'cv_ats_landing'
  );

comment on table public.cv_ats_events is
  'Lightweight public event capture for the CapCarriere CV ATS landing page. WhatsApp clicks are not email leads.';
