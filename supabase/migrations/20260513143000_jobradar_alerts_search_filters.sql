-- JobRadar alerts search filters V1.
-- Adds structured fields used to save a filtered feed search as an email alert.

alter table public.alerts
  add column if not exists search_query text,
  add column if not exists employment_types text[] not null default '{}'::text[],
  add column if not exists work_modes text[] not null default '{}'::text[],
  add column if not exists updated_at timestamptz not null default now();

-- Keep updated_at current when an alert is edited. This is idempotent and
-- intentionally generic because other project migrations already use this helper.
create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_alerts_updated_at on public.alerts;
create trigger trg_alerts_updated_at
before update on public.alerts
for each row
execute function public.set_updated_at_timestamp();
