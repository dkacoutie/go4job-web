create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  digest_enabled boolean not null default true,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_prefs_email_idx
  on public.notification_prefs (email);
