begin;

create extension if not exists pgcrypto;

create table if not exists public.marketing_campaign_settings (
  campaign_key text primary key,
  enabled boolean not null default false,
  dry_run boolean not null default true,
  segment_key text not null,
  sequence_key text not null,
  step_key text not null,
  template_key text not null,
  daily_enqueue_limit integer not null default 10,
  daily_send_limit integer not null default 10,
  cooldown_days integer not null default 7,
  min_user_age_hours integer not null default 24,
  priority integer not null default 100,
  max_emails_per_sequence integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_campaign_settings_campaign_key_not_empty check (btrim(campaign_key) <> ''),
  constraint marketing_campaign_settings_segment_key_not_empty check (btrim(segment_key) <> ''),
  constraint marketing_campaign_settings_sequence_key_not_empty check (btrim(sequence_key) <> ''),
  constraint marketing_campaign_settings_step_key_not_empty check (btrim(step_key) <> ''),
  constraint marketing_campaign_settings_template_key_not_empty check (btrim(template_key) <> ''),
  constraint marketing_campaign_settings_daily_enqueue_limit_check check (daily_enqueue_limit between 0 and 500),
  constraint marketing_campaign_settings_daily_send_limit_check check (daily_send_limit between 0 and 500),
  constraint marketing_campaign_settings_cooldown_days_check check (cooldown_days between 0 and 365),
  constraint marketing_campaign_settings_min_user_age_hours_check check (min_user_age_hours between 0 and 8760),
  constraint marketing_campaign_settings_priority_check check (priority >= 1),
  constraint marketing_campaign_settings_max_emails_per_sequence_check check (max_emails_per_sequence between 1 and 10)
);

create index if not exists marketing_campaign_settings_enabled_priority_idx
  on public.marketing_campaign_settings (enabled, priority);
create index if not exists marketing_campaign_settings_template_key_idx
  on public.marketing_campaign_settings (template_key);
create index if not exists marketing_campaign_settings_segment_key_idx
  on public.marketing_campaign_settings (segment_key);

alter table public.marketing_campaign_settings enable row level security;

drop trigger if exists trg_marketing_campaign_settings_updated_at on public.marketing_campaign_settings;
create trigger trg_marketing_campaign_settings_updated_at
before update on public.marketing_campaign_settings
for each row
execute function public.set_updated_at_timestamp();

insert into public.marketing_campaign_settings (
  campaign_key,
  enabled,
  dry_run,
  segment_key,
  sequence_key,
  step_key,
  template_key,
  daily_enqueue_limit,
  daily_send_limit,
  cooldown_days,
  min_user_age_hours,
  priority,
  max_emails_per_sequence,
  metadata
)
values (
  'non_paying_without_alert',
  false,
  true,
  'non_paying_without_alert',
  'non_paying_without_alert',
  'email_1',
  'create_alert_email_1',
  10,
  10,
  7,
  24,
  30,
  1,
  jsonb_build_object(
    'description', 'Inscrits sans pass actif et sans alerte active',
    'cta_url', 'https://jobradar.go4jobapp.com/jobradar/alerts',
    'phase', 'v1_foundation',
    'initial_state', 'disabled_until_planner_validation'
  )
)
on conflict (campaign_key) do nothing;

create table if not exists public.marketing_global_settings (
  key text primary key,
  value text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_global_settings_key_not_empty check (btrim(key) <> ''),
  constraint marketing_global_settings_value_not_empty check (btrim(value) <> '')
);

alter table public.marketing_global_settings enable row level security;

drop trigger if exists trg_marketing_global_settings_updated_at on public.marketing_global_settings;
create trigger trg_marketing_global_settings_updated_at
before update on public.marketing_global_settings
for each row
execute function public.set_updated_at_timestamp();

insert into public.marketing_global_settings (key, value, description)
values
  ('lifecycle_paused', 'true', 'Emergency global pause for all lifecycle marketing automation'),
  ('daily_global_cap', '25', 'Maximum lifecycle marketing emails per UTC day across all campaigns'),
  ('circuit_breaker_enabled', 'true', 'Enable automatic safety stop based on negative signals'),
  ('bounce_threshold_pct', '2.0', 'Pause threshold for bounce rate over 24h'),
  ('complaint_threshold_pct', '0.1', 'Pause threshold for complaint rate over 24h'),
  ('max_marketing_emails_per_user_per_day', '1', 'Maximum marketing emails per user per UTC day'),
  ('max_marketing_emails_per_user_per_month', '4', 'Maximum marketing emails per user per rolling month')
on conflict (key) do nothing;

create table if not exists public.marketing_planner_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null default gen_random_uuid(),
  run_date date not null default current_date,
  campaign_key text not null,
  dry_run boolean not null default true,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  eligible_count integer not null default 0,
  enqueued_count integer not null default 0,
  skipped_suppressed_count integer not null default 0,
  skipped_cooldown_count integer not null default 0,
  skipped_too_recent_count integer not null default 0,
  skipped_daily_cap_count integer not null default 0,
  skipped_duplicate_count integer not null default 0,
  skipped_global_cap_count integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint marketing_planner_logs_campaign_key_not_empty check (btrim(campaign_key) <> ''),
  constraint marketing_planner_logs_status_check check (
    status in ('started', 'success', 'failed', 'skipped', 'dry_run')
  ),
  constraint marketing_planner_logs_eligible_count_check check (eligible_count >= 0),
  constraint marketing_planner_logs_enqueued_count_check check (enqueued_count >= 0),
  constraint marketing_planner_logs_skipped_suppressed_count_check check (skipped_suppressed_count >= 0),
  constraint marketing_planner_logs_skipped_cooldown_count_check check (skipped_cooldown_count >= 0),
  constraint marketing_planner_logs_skipped_too_recent_count_check check (skipped_too_recent_count >= 0),
  constraint marketing_planner_logs_skipped_daily_cap_count_check check (skipped_daily_cap_count >= 0),
  constraint marketing_planner_logs_skipped_duplicate_count_check check (skipped_duplicate_count >= 0),
  constraint marketing_planner_logs_skipped_global_cap_count_check check (skipped_global_cap_count >= 0)
);

create index if not exists marketing_planner_logs_campaign_run_date_idx
  on public.marketing_planner_logs (campaign_key, run_date desc);
create index if not exists marketing_planner_logs_created_at_idx
  on public.marketing_planner_logs (created_at desc);
create index if not exists marketing_planner_logs_status_idx
  on public.marketing_planner_logs (status);
create index if not exists marketing_planner_logs_run_id_idx
  on public.marketing_planner_logs (run_id);
create unique index if not exists marketing_planner_logs_success_daily_uidx
  on public.marketing_planner_logs (campaign_key, run_date)
  where dry_run = false and status = 'success';

alter table public.marketing_planner_logs enable row level security;

revoke all on table public.marketing_campaign_settings from anon, authenticated;
revoke all on table public.marketing_global_settings from anon, authenticated;
revoke all on table public.marketing_planner_logs from anon, authenticated;

grant all on table public.marketing_campaign_settings to service_role;
grant all on table public.marketing_global_settings to service_role;
grant all on table public.marketing_planner_logs to service_role;

commit;
