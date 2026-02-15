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

-- Upsert RSS sources without violating feed_url uniqueness
-- ReliefWeb
update public.job_sources
set code='reliefweb_jobs',
    name='ReliefWeb Jobs',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"http://reliefweb.int/jobs/rss.xml","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Africa/Global',
    priority=85
where trim(both from ingest_config->>'feed_url') = 'http://reliefweb.int/jobs/rss.xml';

insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'reliefweb_jobs', 'ReliefWeb Jobs', 'rss_generic', 'ready', '{"feed_url":"http://reliefweb.int/jobs/rss.xml","limit":50}', true, null, 'Africa/Global', 85
where not exists (select 1 from public.job_sources where code='reliefweb_jobs')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='http://reliefweb.int/jobs/rss.xml');

-- Remotive
update public.job_sources
set code='remotive',
    name='Remotive',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://remotive.com/feed","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Global Remote',
    priority=70
where trim(both from ingest_config->>'feed_url') = 'https://remotive.com/feed';

insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'remotive', 'Remotive', 'rss_generic', 'ready', '{"feed_url":"https://remotive.com/feed","limit":50}', true, null, 'Global Remote', 70
where not exists (select 1 from public.job_sources where code='remotive')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://remotive.com/feed');

-- We Work Remotely
update public.job_sources
set code='weworkremotely',
    name='We Work Remotely',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://weworkremotely.com/remote-jobs.rss","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Global Remote',
    priority=70
where trim(both from ingest_config->>'feed_url') = 'https://weworkremotely.com/remote-jobs.rss';

insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'weworkremotely', 'We Work Remotely', 'rss_generic', 'ready', '{"feed_url":"https://weworkremotely.com/remote-jobs.rss","limit":50}', true, null, 'Global Remote', 70
where not exists (select 1 from public.job_sources where code='weworkremotely')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://weworkremotely.com/remote-jobs.rss');

-- Himalayas
update public.job_sources
set code='himalayas',
    name='Himalayas',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://himalayas.app/jobs/rss","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Global Remote',
    priority=65
where trim(both from ingest_config->>'feed_url') = 'https://himalayas.app/jobs/rss';

insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'himalayas', 'Himalayas', 'rss_generic', 'ready', '{"feed_url":"https://himalayas.app/jobs/rss","limit":50}', true, null, 'Global Remote', 65
where not exists (select 1 from public.job_sources where code='himalayas')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://himalayas.app/jobs/rss');

-- Empllo
update public.job_sources
set code='empllo',
    name='Empllo',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://empllo.com/feeds/remote-jobs.rss","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Global Remote',
    priority=60
where trim(both from ingest_config->>'feed_url') = 'https://empllo.com/feeds/remote-jobs.rss';

insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'empllo', 'Empllo', 'rss_generic', 'ready', '{"feed_url":"https://empllo.com/feeds/remote-jobs.rss","limit":50}', true, null, 'Global Remote', 60
where not exists (select 1 from public.job_sources where code='empllo')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://empllo.com/feeds/remote-jobs.rss');

-- RemoteYeah
update public.job_sources
set code='remoteyeah',
    name='RemoteYeah',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://remoteyeah.com/rss.xml","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Global Remote',
    priority=60
where trim(both from ingest_config->>'feed_url') = 'https://remoteyeah.com/rss.xml';

insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'remoteyeah', 'RemoteYeah', 'rss_generic', 'ready', '{"feed_url":"https://remoteyeah.com/rss.xml","limit":50}', true, null, 'Global Remote', 60
where not exists (select 1 from public.job_sources where code='remoteyeah')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://remoteyeah.com/rss.xml');

-- WorkAnywhere
update public.job_sources
set code='workanywhere',
    name='WorkAnywhere',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://workanywhere.pro/rss.xml","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Global Remote',
    priority=55
where trim(both from ingest_config->>'feed_url') = 'https://workanywhere.pro/rss.xml';

insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'workanywhere', 'WorkAnywhere', 'rss_generic', 'ready', '{"feed_url":"https://workanywhere.pro/rss.xml","limit":50}', true, null, 'Global Remote', 55
where not exists (select 1 from public.job_sources where code='workanywhere')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://workanywhere.pro/rss.xml');

-- Real Work From Anywhere
update public.job_sources
set code='realwfa',
    name='Real Work From Anywhere',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://www.realworkfromanywhere.com/rss.xml","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Global Remote',
    priority=55
where trim(both from ingest_config->>'feed_url') = 'https://www.realworkfromanywhere.com/rss.xml';

insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'realwfa', 'Real Work From Anywhere', 'rss_generic', 'ready', '{"feed_url":"https://www.realworkfromanywhere.com/rss.xml","limit":50}', true, null, 'Global Remote', 55
where not exists (select 1 from public.job_sources where code='realwfa')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://www.realworkfromanywhere.com/rss.xml');

-- HireWeb3
update public.job_sources
set code='hireweb3',
    name='HireWeb3',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://hireweb3.io/job/rss","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Global Remote',
    priority=50
where trim(both from ingest_config->>'feed_url') = 'https://hireweb3.io/job/rss';

insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'hireweb3', 'HireWeb3', 'rss_generic', 'ready', '{"feed_url":"https://hireweb3.io/job/rss","limit":50}', true, null, 'Global Remote', 50
where not exists (select 1 from public.job_sources where code='hireweb3')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://hireweb3.io/job/rss');

-- Workable
update public.job_sources
set code='workable',
    name='Workable Board',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://www.workable.com/boards/workable.xml","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Global',
    priority=45
where trim(both from ingest_config->>'feed_url') = 'https://www.workable.com/boards/workable.xml';

insert into public.job_sources (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'workable', 'Workable Board', 'rss_generic', 'ready', '{"feed_url":"https://www.workable.com/boards/workable.xml","limit":50}', true, null, 'Global', 45
where not exists (select 1 from public.job_sources where code='workable')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://www.workable.com/boards/workable.xml');
