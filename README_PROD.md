# JobRadar - Production (Supabase hosted)

This file documents how to **auto-fill job descriptions in production** using Supabase Cron + Edge Functions.
It does **not** run anything by itself. Execute the SQL in your **production** Supabase SQL editor after validation.

## Why this is required
`job_enrich_description` only runs when called. To keep descriptions filled, we schedule the function with `pg_cron` and `pg_net`.

## Preconditions (prod)
1. **Edge Function deployed**: `job_enrich_description` exists and is enabled.
2. **Secrets set for the function**:
   - `CRON_SECRET` (must match the header used by the cron job).
3. **Supabase Cron enabled** (`pg_cron` extension).
4. **Supabase Vault available** (to store `project_url` + `cron_secret`).

## Step 1 — Store secrets in Vault
Run this once in the **Supabase SQL editor** (production):

```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_CRON_SECRET', 'cron_secret');
```

Supabase Vault stores secrets securely and exposes them via `vault.decrypted_secrets` for use in SQL jobs.

## Step 2 — Schedule the Edge Function
Use the SQL from:

`supabase/prod/cron_job_enrich_description.sql`

It creates a cron job that calls:
`/functions/v1/job_enrich_description?limit=5` every 5 minutes using `x-cron-secret`.

## Step 3 — Verify cron
Check the job exists:

```sql
select * from cron.job order by jobid desc;
```

Job execution details:

```sql
select * from cron.job_run_details order by start_time desc limit 20;
```

## Step 4 — Production smoke checks (read-only)
You can run a small read-only check against production (no DB writes):

```powershell
$env:SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
$env:CRON_SECRET = "YOUR_CRON_SECRET"

# Optional for job_enrich test:
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_KEY"
$env:JOB_ID = "A_VALID_JOB_UUID"

.\scripts\prod-check.ps1
```

The script will:
- call `/_internal/health`
- call `/ping_cron`
- call `/job_enrich_description?dry_run=1`
- optionally call `/job_enrich` with `persist=false` if `JOB_ID` is set

## Optional tuning
You can adjust:
- **Schedule**: e.g. `*/2 * * * *` for every 2 minutes.
- **Limit**: change `limit=5` to `limit=10` for faster backfills.

## Optional — Deploy functions with a script
If you want a repeatable deploy:

```powershell
.\scripts\prod-deploy.ps1 -ProjectRef "YOUR_PROJECT_REF"
```

You can also pass a custom list:

```powershell
.\scripts\prod-deploy.ps1 -ProjectRef "YOUR_PROJECT_REF" -Functions @("job_enrich_description","job_enrich")
```
