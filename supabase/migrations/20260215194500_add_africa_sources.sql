-- Add Africa-focused sources (AEJ + AGL + Bourbon + AfDB), idempotent

-- AEJ (Agence Emploi Jeunes) - HTML ingestion
update public.job_sources
set name='Agence Emploi Jeunes',
    ingest_method='aej_html',
    ingest_status='ready',
    ingest_config='{"list_url":"https://www.agenceemploijeunes.ci/site/offres-emplois","max_pages":2,"limit":30,"delay_ms":800}'::jsonb,
    is_active=true,
    country='Cote d''Ivoire',
    region='Cote d''Ivoire',
    priority=95
where code='aej_ci';

update public.job_sources
set ingest_method='aej_html',
    ingest_status='ready',
    ingest_config='{"list_url":"https://www.agenceemploijeunes.ci/site/offres-emplois","max_pages":2,"limit":30,"delay_ms":800}'::jsonb,
    is_active=true,
    country='Cote d''Ivoire',
    region='Cote d''Ivoire',
    priority=95
where name='Agence Emploi Jeunes'
  and not exists (select 1 from public.job_sources where code='aej_ci');

insert into public.job_sources
  (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'aej_ci', 'Agence Emploi Jeunes', 'aej_html', 'ready',
       '{"list_url":"https://www.agenceemploijeunes.ci/site/offres-emplois","max_pages":2,"limit":30,"delay_ms":800}',
       true, 'Cote d''Ivoire', 'Cote d''Ivoire', 95
where not exists (select 1 from public.job_sources where code='aej_ci')
  and not exists (select 1 from public.job_sources where name='Agence Emploi Jeunes');

-- AGL (Africa Global Logistics) RSS
update public.job_sources
set ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://acareerbyagl.talent-soft.com/handlers/offerRss.ashx?LCID=1033","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Africa/Global',
    priority=80
where trim(both from ingest_config->>'feed_url') = 'https://acareerbyagl.talent-soft.com/handlers/offerRss.ashx?LCID=1033';

update public.job_sources
set name='AGL (Africa Global Logistics)',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://acareerbyagl.talent-soft.com/handlers/offerRss.ashx?LCID=1033","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Africa/Global',
    priority=80
where code='agl_rss'
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://acareerbyagl.talent-soft.com/handlers/offerRss.ashx?LCID=1033');

update public.job_sources
set ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://acareerbyagl.talent-soft.com/handlers/offerRss.ashx?LCID=1033","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Africa/Global',
    priority=80
where name='AGL (Africa Global Logistics)'
  and (ingest_config->>'feed_url' is null or trim(both from ingest_config->>'feed_url') = '')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://acareerbyagl.talent-soft.com/handlers/offerRss.ashx?LCID=1033');

update public.job_sources
set code='agl_rss'
where trim(both from ingest_config->>'feed_url')='https://acareerbyagl.talent-soft.com/handlers/offerRss.ashx?LCID=1033'
  and (code is null or code = '')
  and not exists (select 1 from public.job_sources where code='agl_rss');

insert into public.job_sources
  (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'agl_rss', 'AGL (Africa Global Logistics)', 'rss_generic', 'ready',
       '{"feed_url":"https://acareerbyagl.talent-soft.com/handlers/offerRss.ashx?LCID=1033","limit":50}',
       true, null, 'Africa/Global', 80
where not exists (select 1 from public.job_sources where code='agl_rss')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://acareerbyagl.talent-soft.com/handlers/offerRss.ashx?LCID=1033')
  and not exists (select 1 from public.job_sources where name='AGL (Africa Global Logistics)');

-- Bourbon RSS
update public.job_sources
set ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://bourbon-career.talent-soft.com/handlers/offerRss.ashx?LCID=2057","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Africa/Global',
    priority=75
where trim(both from ingest_config->>'feed_url') = 'https://bourbon-career.talent-soft.com/handlers/offerRss.ashx?LCID=2057';

update public.job_sources
set name='Bourbon',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://bourbon-career.talent-soft.com/handlers/offerRss.ashx?LCID=2057","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Africa/Global',
    priority=75
where code='bourbon_rss'
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://bourbon-career.talent-soft.com/handlers/offerRss.ashx?LCID=2057');

update public.job_sources
set ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://bourbon-career.talent-soft.com/handlers/offerRss.ashx?LCID=2057","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Africa/Global',
    priority=75
where name='Bourbon'
  and (ingest_config->>'feed_url' is null or trim(both from ingest_config->>'feed_url') = '')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://bourbon-career.talent-soft.com/handlers/offerRss.ashx?LCID=2057');

update public.job_sources
set code='bourbon_rss'
where trim(both from ingest_config->>'feed_url')='https://bourbon-career.talent-soft.com/handlers/offerRss.ashx?LCID=2057'
  and (code is null or code = '')
  and not exists (select 1 from public.job_sources where code='bourbon_rss');

insert into public.job_sources
  (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'bourbon_rss', 'Bourbon', 'rss_generic', 'ready',
       '{"feed_url":"https://bourbon-career.talent-soft.com/handlers/offerRss.ashx?LCID=2057","limit":50}',
       true, null, 'Africa/Global', 75
where not exists (select 1 from public.job_sources where code='bourbon_rss')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://bourbon-career.talent-soft.com/handlers/offerRss.ashx?LCID=2057')
  and not exists (select 1 from public.job_sources where name='Bourbon');

-- AfDB Vacancies RSS
update public.job_sources
set ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://www.afdb.org/en/vacancies/assistant-informatique/projects-and-operations/about-us/careers/current-vacancies/rss","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Africa/Global',
    priority=78
where trim(both from ingest_config->>'feed_url') = 'https://www.afdb.org/en/vacancies/assistant-informatique/projects-and-operations/about-us/careers/current-vacancies/rss';

update public.job_sources
set name='AfDB Vacancies',
    ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://www.afdb.org/en/vacancies/assistant-informatique/projects-and-operations/about-us/careers/current-vacancies/rss","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Africa/Global',
    priority=78
where code='afdb_vacancies'
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://www.afdb.org/en/vacancies/assistant-informatique/projects-and-operations/about-us/careers/current-vacancies/rss');

update public.job_sources
set ingest_method='rss_generic',
    ingest_status='ready',
    ingest_config='{"feed_url":"https://www.afdb.org/en/vacancies/assistant-informatique/projects-and-operations/about-us/careers/current-vacancies/rss","limit":50}'::jsonb,
    is_active=true,
    country=null,
    region='Africa/Global',
    priority=78
where name='AfDB Vacancies'
  and (ingest_config->>'feed_url' is null or trim(both from ingest_config->>'feed_url') = '')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://www.afdb.org/en/vacancies/assistant-informatique/projects-and-operations/about-us/careers/current-vacancies/rss');

update public.job_sources
set code='afdb_vacancies'
where trim(both from ingest_config->>'feed_url')='https://www.afdb.org/en/vacancies/assistant-informatique/projects-and-operations/about-us/careers/current-vacancies/rss'
  and (code is null or code = '')
  and not exists (select 1 from public.job_sources where code='afdb_vacancies');

insert into public.job_sources
  (code, name, ingest_method, ingest_status, ingest_config, is_active, country, region, priority)
select 'afdb_vacancies', 'AfDB Vacancies', 'rss_generic', 'ready',
       '{"feed_url":"https://www.afdb.org/en/vacancies/assistant-informatique/projects-and-operations/about-us/careers/current-vacancies/rss","limit":50}',
       true, null, 'Africa/Global', 78
where not exists (select 1 from public.job_sources where code='afdb_vacancies')
  and not exists (select 1 from public.job_sources where trim(both from ingest_config->>'feed_url')='https://www.afdb.org/en/vacancies/assistant-informatique/projects-and-operations/about-us/careers/current-vacancies/rss')
  and not exists (select 1 from public.job_sources where name='AfDB Vacancies');
