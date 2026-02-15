-- RSS sources + internship tagging (idempotent)

-- Extend job_sources to support RSS
alter table public.job_sources
  add column if not exists code text,
  add column if not exists ingest_method text,
  add column if not exists ingest_status text default 'ready',
  add column if not exists ingest_config jsonb default '{}'::jsonb,
  add column if not exists is_active boolean default true,
  add column if not exists country text,
  add column if not exists region text,
  add column if not exists priority int default 0;

create unique index if not exists job_sources_code_uq on public.job_sources (code);

-- Add job_type for internship tagging
alter table public.jobs
  add column if not exists job_type text;

create index if not exists jobs_job_type_idx on public.jobs (job_type);

-- Seed RSS sources (Africa + global)
insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
values
  -- Africa / impact-heavy
  ('reliefweb_jobs',  'ReliefWeb Jobs',     'rss_generic', 'ready', '{"feed_url":"http://reliefweb.int/jobs/rss.xml","limit":50}', true, null, 'Africa/Global', 85),

  -- Global remote
  ('remotive',        'Remotive',           'rss_generic', 'ready', '{"feed_url":"https://remotive.com/feed","limit":50}', true, null, 'Global Remote', 70),
  ('weworkremotely',  'We Work Remotely',   'rss_generic', 'ready', '{"feed_url":"https://weworkremotely.com/remote-jobs.rss","limit":50}', true, null, 'Global Remote', 70),
  ('himalayas',       'Himalayas',          'rss_generic', 'ready', '{"feed_url":"https://himalayas.app/jobs/rss","limit":50}', true, null, 'Global Remote', 65),
  ('empllo',          'Empllo',             'rss_generic', 'ready', '{"feed_url":"https://empllo.com/feeds/remote-jobs.rss","limit":50}', true, null, 'Global Remote', 60),
  ('remoteyeah',      'RemoteYeah',         'rss_generic', 'ready', '{"feed_url":"https://remoteyeah.com/rss.xml","limit":50}', true, null, 'Global Remote', 60),
  ('workanywhere',    'WorkAnywhere',       'rss_generic', 'ready', '{"feed_url":"https://workanywhere.pro/rss.xml","limit":50}', true, null, 'Global Remote', 55),
  ('realwfa',         'Real Work From Anywhere','rss_generic','ready','{"feed_url":"https://www.realworkfromanywhere.com/rss.xml","limit":50}', true, null, 'Global Remote', 55),
  ('hireweb3',        'HireWeb3',           'rss_generic', 'ready', '{"feed_url":"https://hireweb3.io/job/rss","limit":50}', true, null, 'Global Remote', 50),
  ('workable',        'Workable Board',     'rss_generic', 'ready', '{"feed_url":"https://www.workable.com/boards/workable.xml","limit":50}', true, null, 'Global', 45)
on conflict (code) do update set
  name=excluded.name,
  ingest_method=excluded.ingest_method,
  ingest_status=excluded.ingest_status,
  ingest_config=excluded.ingest_config,
  is_active=excluded.is_active,
  country=excluded.country,
  region=excluded.region,
  priority=excluded.priority;
