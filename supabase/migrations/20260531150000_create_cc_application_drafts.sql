-- CapCarrière V1 — application drafts before explicit user approval
-- No email sending, no candidate submission, no modification to jobs/applications/candidatures.

create table if not exists public.cc_application_drafts (
  id uuid primary key default gen_random_uuid(),

  -- Ownership / relations
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete restrict,
  apply_intel_id uuid not null references public.cc_job_apply_intel(id) on delete restrict,

  -- Optional future bridge to existing final tracking table.
  -- Kept nullable and unused in V1.
  application_id bigint null references public.applications(id) on delete set null,

  -- Draft nature
  draft_type text not null default 'email_application',
  application_channel text not null default 'email_direct_reliable',

  -- Recipient / message
  recipient_email text null,
  cc_emails text[] not null default '{}'::text[],
  subject text null,
  email_body text null,
  cover_letter_body text null,

  -- User-facing generation options
  language text not null default 'fr',
  tone text not null default 'professional',
  cv_required boolean not null default true,
  cover_letter_required boolean not null default false,

  -- Safety gates
  draft_gate text not null default 'needs_human_review_before_draft',
  status text not null default 'draft',
  risk_level text not null default 'low',
  risk_flags text[] not null default '{}'::text[],

  -- Evidence / reproducibility
  evidence_json jsonb not null default '{}'::jsonb,
  source_snapshot_json jsonb not null default '{}'::jsonb,
  generation_input_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,

  -- AI generation trace
  generation_model text null,
  generation_prompt_version text null,
  generated_at timestamptz null,

  -- Review / approval lifecycle
  user_reviewed_at timestamptz null,
  user_approved_at timestamptz null,
  sent_at timestamptz null,
  cancelled_at timestamptz null,

  -- Audit timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cc_application_drafts_draft_type_check
    check (draft_type in (
      'email_application',
      'cover_letter',
      'email_and_cover_letter'
    )),

  constraint cc_application_drafts_application_channel_check
    check (application_channel in (
      'email_direct_reliable',
      'email_direct',
      'external_form',
      'unknown'
    )),

  constraint cc_application_drafts_draft_gate_check
    check (draft_gate in (
      'ready_for_draft_after_user_review',
      'needs_human_review_before_draft',
      'blocked_restricted_applicants',
      'blocked_inactive_or_expired'
    )),

  constraint cc_application_drafts_status_check
    check (status in (
      'draft',
      'needs_user_review',
      'approved_by_user',
      'sent',
      'cancelled',
      'blocked',
      'failed'
    )),

  constraint cc_application_drafts_risk_level_check
    check (risk_level in (
      'none',
      'low',
      'medium',
      'high',
      'blocked'
    )),

  constraint cc_application_drafts_language_check
    check (language in (
      'fr',
      'en'
    )),

  constraint cc_application_drafts_recipient_email_format_check
    check (
      recipient_email is null
      or recipient_email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
    ),

  constraint cc_application_drafts_sent_requires_approval_check
    check (
      status <> 'sent'
      or user_approved_at is not null
    ),

  constraint cc_application_drafts_blocked_gate_status_check
    check (
      draft_gate not in (
        'blocked_restricted_applicants',
        'blocked_inactive_or_expired'
      )
      or status = 'blocked'
    )
);

create unique index if not exists cc_application_drafts_user_apply_intel_active_uidx
  on public.cc_application_drafts(user_id, apply_intel_id)
  where status <> 'cancelled';

create index if not exists cc_application_drafts_user_status_idx
  on public.cc_application_drafts(user_id, status, created_at desc);

create index if not exists cc_application_drafts_job_idx
  on public.cc_application_drafts(job_id);

create index if not exists cc_application_drafts_apply_intel_idx
  on public.cc_application_drafts(apply_intel_id);

create index if not exists cc_application_drafts_gate_status_idx
  on public.cc_application_drafts(draft_gate, status);

create index if not exists cc_application_drafts_recipient_email_idx
  on public.cc_application_drafts(lower(recipient_email))
  where recipient_email is not null;

create index if not exists cc_application_drafts_risk_flags_gin_idx
  on public.cc_application_drafts using gin(risk_flags);

create index if not exists cc_application_drafts_metadata_gin_idx
  on public.cc_application_drafts using gin(metadata_json);

create or replace function public.cc_application_drafts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_cc_application_drafts_set_updated_at
  on public.cc_application_drafts;

create trigger trg_cc_application_drafts_set_updated_at
before update on public.cc_application_drafts
for each row
execute function public.cc_application_drafts_set_updated_at();

alter table public.cc_application_drafts enable row level security;

drop policy if exists "cc_application_drafts_select_own"
  on public.cc_application_drafts;

create policy "cc_application_drafts_select_own"
on public.cc_application_drafts
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "cc_application_drafts_insert_own"
  on public.cc_application_drafts;

create policy "cc_application_drafts_insert_own"
on public.cc_application_drafts
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "cc_application_drafts_update_own"
  on public.cc_application_drafts;

create policy "cc_application_drafts_update_own"
on public.cc_application_drafts
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

comment on table public.cc_application_drafts is
  'CapCarrière user-reviewed application drafts. Stores generated email/cover-letter drafts before explicit user approval. Does not send emails.';

comment on column public.cc_application_drafts.apply_intel_id is
  'Reference to cc_job_apply_intel row used to identify the application channel and evidence.';

comment on column public.cc_application_drafts.draft_gate is
  'Safety decision from apply intelligence classification before generation or review.';

comment on column public.cc_application_drafts.risk_flags is
  'Non-blocking or blocking risk flags such as duplicate_recipient_email, html_only_description, internal_only_or_restricted_applicants.';

comment on column public.cc_application_drafts.evidence_json is
  'Evidence snippets and extracted signals used to justify the draft recipient/channel.';

comment on column public.cc_application_drafts.source_snapshot_json is
  'Snapshot of job/apply_intel fields at generation time for traceability.';