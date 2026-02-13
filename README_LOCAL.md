# JobRadar - Local Setup (Supabase + Vite)

This guide is for local development only. It targets the local Supabase stack at `http://127.0.0.1:54321`.

## Prereqs
- Node.js + npm
- Supabase CLI + Docker Desktop

## Local Supabase
Start the local stack:
```powershell
supabase start
supabase status
```

Apply migrations (no reset):
```powershell
supabase migration up
```

## Seed job_sources (optional)
If you do not already have the RSS test source, insert it:
```powershell
docker exec -i supabase_db_go4job-web psql -U postgres -d postgres -c "insert into public.job_sources (code, name, ingest_method, ingest_status, is_active, active, ingest_config, source_type) values ('rss_hn_jobs', 'HN Jobs RSS', 'rss_generic', 'ready', true, true, '{\"feed_url\":\"https://hnrss.org/jobs\",\"limit\":10,\"expire_ttl_days\":30}', 'rss') on conflict (code) do update set ingest_method=excluded.ingest_method, ingest_status=excluded.ingest_status, is_active=excluded.is_active, active=excluded.active, ingest_config=excluded.ingest_config, source_type=excluded.source_type;"
```

Ensure remotive source exists:
```powershell
docker exec -i supabase_db_go4job-web psql -U postgres -d postgres -c "update public.job_sources set code='remotive', ingest_method='remotive', ingest_status='ready', is_active=true, active=true, source_type='api', ingest_config=coalesce(ingest_config, '{}'::jsonb) where (code is null or code='');"
```

## Ingestion (local)
```powershell
# Remotive (writes jobs)
Invoke-RestMethod -Uri "http://127.0.0.1:54321/functions/v1/ingest_remotive" -Method Post -ContentType "application/json" -Headers @{"x-cron-secret"="YOUR_CRON_SECRET"} -Body '{"limit":5,"force":true}'

# RSS (writes jobs)
Invoke-RestMethod -Uri "http://127.0.0.1:54321/functions/v1/ingest_source" -Method Post -ContentType "application/json" -Headers @{"x-cron-secret"="YOUR_CRON_SECRET"} -Body '{"source_code":"rss_hn_jobs","dry_run":false,"limit":3}'
```

## Enrichment (local)
```powershell
# Description enrich (writes description_text)
Invoke-RestMethod -Uri "http://127.0.0.1:54321/functions/v1/job_enrich_description?limit=1" -Method Get -Headers @{"x-cron-secret"="YOUR_CRON_SECRET"}

# Enrich one job (writes job_family/skills/experience)
Invoke-RestMethod -Uri "http://127.0.0.1:54321/functions/v1/job_enrich" -Method Post -ContentType "application/json" -Headers @{"apikey"="YOUR_ANON_KEY"; "authorization"="Bearer YOUR_SERVICE_ROLE_KEY"} -Body '{"job_id":"YOUR_JOB_ID","persist":true}'
```

## CV Extract (local)
```powershell
$body = @{ cv_text = @'
John Doe
Email: john.doe@example.com
Phone: +1 555 123 4567
Skills: Python, SQL, Excel, Power BI, React, TypeScript, Docker, AWS, Git, Jira, Communication, Leadership
Experience: Data analyst, reporting, dashboards, project management
'@ } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:54321/functions/v1/cv_extract" -Method Post -ContentType "application/json" -Body $body -Headers @{"apikey"="YOUR_ANON_KEY"; "authorization"="Bearer YOUR_SERVICE_ROLE_KEY"}
```

## Frontend
```powershell
npm install
npm run lint
npm run build
```

Preview locally:
```powershell
npm run preview -- --host 127.0.0.1 --port 4173
```

## Smoke tests
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:54321/functions/v1/_internal/health" -Method Get
Invoke-RestMethod -Uri "http://127.0.0.1:54321/functions/v1/ping_cron" -Method Get -Headers @{"x-cron-secret"="YOUR_CRON_SECRET"}
Invoke-RestMethod -Uri "http://127.0.0.1:54321/functions/v1/job_enrich_description?limit=2&dry_run=1" -Method Get -Headers @{"x-cron-secret"="YOUR_CRON_SECRET"}
```
