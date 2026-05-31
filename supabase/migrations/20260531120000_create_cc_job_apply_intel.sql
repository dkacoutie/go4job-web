-- CapCarriere apply intelligence layer.
-- Stores reversible, CapCarriere-specific application channel metadata
-- without modifying JobRadar's public.jobs table.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at_timestamp'
      and p.pronargs = 0
  ) then
    execute $fn$
      create function public.set_updated_at_timestamp()
      returns trigger
      language plpgsql
      as $body$
      begin
        new.updated_at = now();
        return new;
      end;
      $body$
    $fn$;
  end if;
end;
$$;

create table if not exists public.cc_job_apply_intel (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,

  apply_channel text not null default 'unknown',
  apply_email text,
  apply_url text,
  email_reliability text,
  form_type text,
  ats_type text,

  requires_login boolean not null default false,
  has_captcha boolean not null default false,
  requires_otp boolean not null default false,
  is_closed_platform boolean not null default false,

  automation_level text not null default 'manual_action_required',
  confidence numeric not null default 0,

  detected_from text,
  detection_method text,
  status text not null default 'pending',
  invalid_reason text,

  bounce_count integer not null default 0,
  last_bounce_at timestamptz,
  last_checked_at timestamptz,

  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cc_job_apply_intel_job_id_key unique (job_id),
  constraint cc_job_apply_intel_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint cc_job_apply_intel_bounce_count_check
    check (bounce_count >= 0),
  constraint cc_job_apply_intel_apply_channel_check
    check (apply_channel in (
      'unknown',
      'email_direct_reliable',
      'email_detected_unverified',
      'email_accommodation_only',
      'job_page_with_apply_button',
      'simple_form_assistable',
      'ats_form_assistable',
      'ats_complex',
      'login_required',
      'captcha_required',
      'otp_required',
      'closed_platform',
      'manual_instruction',
      'no_channel',
      'spontaneous_application'
    )),
  constraint cc_job_apply_intel_email_reliability_check
    check (
      email_reliability is null
      or email_reliability in (
        'low',
        'medium',
        'high',
        'verified',
        'unverified',
        'generic',
        'support_only',
        'accommodation_only',
        'noreply',
        'bounced',
        'invalid'
      )
    ),
  constraint cc_job_apply_intel_automation_level_check
    check (automation_level in (
      'send_email_after_review',
      'prepare_dossier_only',
      'copy_paste_assisted',
      'extension_prefill_candidate',
      'manual_action_required',
      'not_supported'
    )),
  constraint cc_job_apply_intel_status_check
    check (status in (
      'pending',
      'detected',
      'verified',
      'needs_ai_review',
      'needs_manual_review',
      'invalid',
      'stale'
    ))
);

create index if not exists cc_job_apply_intel_job_id_idx
  on public.cc_job_apply_intel (job_id);

create index if not exists cc_job_apply_intel_apply_channel_idx
  on public.cc_job_apply_intel (apply_channel);

create index if not exists cc_job_apply_intel_automation_level_idx
  on public.cc_job_apply_intel (automation_level);

create index if not exists cc_job_apply_intel_status_idx
  on public.cc_job_apply_intel (status);

create index if not exists cc_job_apply_intel_last_checked_at_idx
  on public.cc_job_apply_intel (last_checked_at);

create index if not exists cc_job_apply_intel_actionable_idx
  on public.cc_job_apply_intel (
    automation_level,
    apply_channel,
    confidence desc,
    last_checked_at desc
  )
  where status in ('detected', 'verified')
    and automation_level in (
      'send_email_after_review',
      'prepare_dossier_only',
      'copy_paste_assisted'
    )
    and apply_channel in (
      'email_direct_reliable',
      'job_page_with_apply_button',
      'simple_form_assistable',
      'manual_instruction',
      'spontaneous_application'
    )
    and confidence >= 0.5;

drop trigger if exists trg_cc_job_apply_intel_updated_at
  on public.cc_job_apply_intel;

create trigger trg_cc_job_apply_intel_updated_at
before update on public.cc_job_apply_intel
for each row
execute function public.set_updated_at_timestamp();

alter table public.cc_job_apply_intel enable row level security;

comment on table public.cc_job_apply_intel is
  'CapCarriere apply intelligence for JobRadar jobs. Private service-role layer; no direct public frontend access.';

comment on column public.cc_job_apply_intel.job_id is
  'JobRadar job enriched by CapCarriere without modifying public.jobs.';

comment on column public.cc_job_apply_intel.apply_channel is
  'Detected CapCarriere application channel, including email, apply button, assistable forms, ATS, closed platforms, manual instructions, or unknown.';

comment on column public.cc_job_apply_intel.automation_level is
  'How far CapCarriere may go after user validation for this job.';

comment on column public.cc_job_apply_intel.metadata_json is
  'Raw detector evidence, source snippets, parser diagnostics, and provider-specific metadata.';
