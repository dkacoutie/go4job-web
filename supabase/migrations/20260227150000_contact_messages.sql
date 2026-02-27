create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  email text not null,
  subject text not null,
  message text not null,
  status text not null default 'received',
  ip text,
  user_agent text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_email_idx on public.contact_messages (email);
create index if not exists contact_messages_ip_idx on public.contact_messages (ip);

alter table public.contact_messages enable row level security;
