-- Historique des digests JobRadar lisibles dans l'application.
--
-- Additif : l'email continue d'etre journalise dans notification_logs.
-- Ces tables conservent seulement le contenu des digests reellement envoyes.

begin;

alter table public.user_notifications
  drop constraint if exists user_notifications_kind_check;

alter table public.user_notifications
  add constraint user_notifications_kind_check
  check (kind in (
    'new_matches',
    'digest_sent',
    'alert_active',
    'saved_job_expiring',
    'subscription_status'
  ));

create table if not exists public.jobradar_digest_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  digest_date date not null,
  channel text not null default 'email',
  subject text,
  preheader text,
  job_count integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists jobradar_digest_runs_dedupe_uidx
  on public.jobradar_digest_runs (user_id, digest_date, channel);

create index if not exists jobradar_digest_runs_user_idx
  on public.jobradar_digest_runs (user_id, digest_date desc);

create table if not exists public.jobradar_digest_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.jobradar_digest_runs(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  rank smallint not null,
  title text not null,
  company_name text,
  location text,
  country text,
  score numeric,
  created_at timestamptz not null default now()
);

create unique index if not exists jobradar_digest_items_dedupe_uidx
  on public.jobradar_digest_items (run_id, rank);

create index if not exists jobradar_digest_items_run_idx
  on public.jobradar_digest_items (run_id);

alter table public.jobradar_digest_runs enable row level security;
alter table public.jobradar_digest_items enable row level security;

drop policy if exists jobradar_digest_runs_select_own on public.jobradar_digest_runs;
create policy jobradar_digest_runs_select_own
  on public.jobradar_digest_runs
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists jobradar_digest_items_select_own on public.jobradar_digest_items;
create policy jobradar_digest_items_select_own
  on public.jobradar_digest_items
  for select
  to authenticated
  using (exists (
    select 1
    from public.jobradar_digest_runs r
    where r.id = jobradar_digest_items.run_id
      and r.user_id = auth.uid()
  ));

revoke all on table public.jobradar_digest_runs from anon, authenticated;
revoke all on table public.jobradar_digest_items from anon, authenticated;
grant select on table public.jobradar_digest_runs to authenticated;
grant select on table public.jobradar_digest_items to authenticated;

create or replace function public.record_job_alert_digest(
  p_user_id uuid,
  p_digest_date date,
  p_channel text,
  p_subject text,
  p_preheader text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_item_count integer;
begin
  v_item_count := coalesce(jsonb_array_length(p_items), 0);

  insert into public.jobradar_digest_runs (
    user_id,
    digest_date,
    channel,
    subject,
    preheader,
    job_count
  )
  values (
    p_user_id,
    p_digest_date,
    coalesce(nullif(btrim(p_channel), ''), 'email'),
    p_subject,
    p_preheader,
    v_item_count
  )
  on conflict (user_id, digest_date, channel)
  do update set
    subject = excluded.subject,
    preheader = excluded.preheader,
    job_count = excluded.job_count
  returning id into v_run_id;

  delete from public.jobradar_digest_items where run_id = v_run_id;

  insert into public.jobradar_digest_items (
    run_id,
    job_id,
    rank,
    title,
    company_name,
    location,
    country,
    score
  )
  select
    v_run_id,
    nullif(item->>'job_id', '')::uuid,
    (item->>'rank')::smallint,
    coalesce(nullif(btrim(item->>'title'), ''), 'Offre JobRadar'),
    nullif(btrim(item->>'company_name'), ''),
    nullif(btrim(item->>'location'), ''),
    nullif(btrim(item->>'country'), ''),
    nullif(item->>'score', '')::numeric
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item;

  insert into public.user_notifications (
    user_id,
    kind,
    title,
    body,
    cta_label,
    cta_path,
    related_id,
    dedupe_key
  )
  values (
    p_user_id,
    'digest_sent',
    'Nouvelles offres pour toi',
    format('%s offre%s selectionnee%s pour toi le %s',
      v_item_count,
      case when v_item_count > 1 then 's' else '' end,
      case when v_item_count > 1 then 's' else '' end,
      to_char(p_digest_date, 'DD/MM')
    ),
    'Voir mes alertes',
    '/jobradar/digests/' || v_run_id::text,
    v_run_id,
    'digest_sent:' || v_run_id::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  return v_run_id;
end;
$$;

revoke all on function public.record_job_alert_digest(uuid, date, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_job_alert_digest(uuid, date, text, text, text, jsonb)
  to service_role;

comment on table public.jobradar_digest_runs is
  'Un run correspond a un digest JobRadar reellement envoye a un utilisateur.';

comment on table public.jobradar_digest_items is
  'Offres incluses dans un digest envoye, avec snapshot minimal pour relecture historique.';

comment on function public.record_job_alert_digest(uuid, date, text, text, text, jsonb) is
  'Enregistre idempotemment un digest envoye, ses offres et la notification interne associee.';

commit;
