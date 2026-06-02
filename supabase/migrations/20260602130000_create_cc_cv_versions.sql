create table if not exists public.cc_cv_versions (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles(user_id) on delete cascade,

  -- optional link with user_cvs, without making user_cvs the CapCarriere source of truth
  user_cv_id uuid references public.user_cvs(id) on delete set null,

  storage_bucket text not null default 'cvs',
  storage_path text not null,
  storage_object_id uuid,
  original_filename text,
  mime_type text,
  file_size_bytes bigint,

  cv_text_md5 text,

  status text not null default 'uploaded',
  is_current boolean not null default false,

  candidate_confirmed_at timestamptz,
  usable_for_review_at timestamptz,

  -- prÃ©vu pour plus tard, mais non utilisÃ© maintenant
  approved_for_autosend_at timestamptz,
  autosend_mandate_id uuid,

  revoked_at timestamptz,
  archived_at timestamptz,

  source text not null default 'manual',
  metadata_json jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cc_cv_versions_status_check check (
    status in (
      'uploaded',
      'candidate_confirmed',
      'review_ready',
      'autopilot_ready',
      'revoked',
      'archived',
      'rejected'
    )
  ),

  constraint cc_cv_versions_source_check check (
    source in (
      'manual',
      'user_cvs_import',
      'candidate_upload',
      'admin_internal_link',
      'system_backfill'
    )
  ),

  constraint cc_cv_versions_autosend_requires_mandate_check check (
    status <> 'autopilot_ready'
    or (
      approved_for_autosend_at is not null
      and autosend_mandate_id is not null
    )
  ),

  constraint cc_cv_versions_review_ready_requires_confirmation_check check (
    status <> 'review_ready'
    or (
      candidate_confirmed_at is not null
      and usable_for_review_at is not null
    )
  )
);

alter table public.cc_cv_versions enable row level security;

create index if not exists cc_cv_versions_user_id_idx
  on public.cc_cv_versions(user_id);

create index if not exists cc_cv_versions_user_cv_id_idx
  on public.cc_cv_versions(user_cv_id);

create index if not exists cc_cv_versions_status_idx
  on public.cc_cv_versions(status);

create unique index if not exists cc_cv_versions_one_current_per_user_idx
  on public.cc_cv_versions(user_id)
  where is_current = true
    and revoked_at is null
    and archived_at is null;

drop trigger if exists cc_cv_versions_set_updated_at
  on public.cc_cv_versions;

create trigger cc_cv_versions_set_updated_at
before update on public.cc_cv_versions
for each row
execute function public.set_updated_at_timestamp();
