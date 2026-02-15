# README LOCAL — JobRadar

## Prerequis
- Node.js
- Supabase CLI
- Docker Desktop (local)

## Setup local
```powershell
supabase start
npm install
```

## Migrations (idempotentes)
```powershell
supabase migration up
```

## Tests rapides (local)
```powershell
npm run lint
npm run build
```

## Edge Functions (prod)
```powershell
supabase functions deploy job_enrich_description --project-ref <PROJECT_REF>
supabase functions deploy job_ai_description --project-ref <PROJECT_REF>
supabase functions deploy user_generate_ai_desc --project-ref <PROJECT_REF>
```

## Smoke tests (prod)
### Health
```powershell
curl -X GET "https://<PROJECT_REF>.supabase.co/functions/v1/job_enrich_description"
curl -X GET "https://<PROJECT_REF>.supabase.co/functions/v1/job_ai_description"
```

### Scraping (dry run)
```powershell
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/job_enrich_description?limit=2&dry_run=1" `
  -H "x-cron-secret: <CRON_SECRET>"
```

### IA (dry run)
```powershell
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/job_ai_description?limit=2&dry_run=1" `
  -H "x-cron-secret: <CRON_SECRET>"
```

### IA (exec)
```powershell
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/job_ai_description?limit=2" `
  -H "x-cron-secret: <CRON_SECRET>"
```

## UI checks (prod)
1. Ouvrir `/jobradar/jobs/:id` et verifier:
   - description visible (scraped ou IA)
   - badge de source
2. Mobile:
   - dropdown header utilisable au tap

## Checklist MVP (local)
1. `supabase start` OK
2. `supabase migration up` OK
3. `npm run lint` OK
4. `npm run build` OK
5. Page Job Details affiche une description utile
6. Dropdown mobile utilisable
