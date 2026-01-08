-- JobRadar / Digest schema (local + prod)

-- 1) Snapshot enrichissement sur public.jobs
alter table public.jobs
  add column if not exists job_family text,
  add column if not exists required_skills text[],
  add column if not exists optional_skills text[],
  add column if not exists job_skills text[],
  add column if not exists experience_years_min int,
  add column if not exists experience_years_max int;

-- 2) Tokens d'actions email (👍/👎)
create table if not exists public.email_action_tokens (
  id bigserial primary key,
  token text not null unique,
  user_id uuid not null,
  job_id uuid,
  action text not null check (action in ('up','down')),
  alert_id uuid,
  used_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create index if not exists email_action_tokens_user_id_idx on public.email_action_tokens (user_id);
create index if not exists email_action_tokens_job_id_idx on public.email_action_tokens (job_id);
create index if not exists email_action_tokens_used_at_idx on public.email_action_tokens (used_at);

-- 3) Feedback utilisateur sur jobs (1=👍, -1=👎)
create table if not exists public.job_feedback (
  id bigserial primary key,
  user_id uuid not null,
  job_id uuid not null,
  feedback int not null,
  via text,
  created_at timestamptz not null default now(),
  unique (user_id, job_id),
  constraint job_feedback_feedback_check check (feedback in (1, -1))
);

create index if not exists job_feedback_user_id_idx on public.job_feedback (user_id);
create index if not exists job_feedback_job_id_idx on public.job_feedback (job_id);
