create table if not exists public.notification_logs (
  id bigint generated always as identity primary key,
  user_id uuid null,
  to_email text not null,
  channel text not null default 'email',
  digest_date date not null,
  status text not null,
  provider text not null default 'resend',
  provider_id text null,
  error text null,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_logs_unique
  on public.notification_logs (to_email, channel, digest_date);
