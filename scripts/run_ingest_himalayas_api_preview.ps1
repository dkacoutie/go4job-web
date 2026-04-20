$ErrorActionPreference = "Stop"

$secret = (Get-Content "supabase\functions\.env" | Where-Object { $_ -match "^CRON_SECRET=" }) -replace "^CRON_SECRET=", ""
$secret = $secret.Trim()

$body = @{
  source_code = "himalayas_api"
  limit = 5
  dry_run = $true
} | ConvertTo-Json

$resp = Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:54321/functions/v1/ingest_source" `
  -Headers @{ "x-cron-secret" = $secret } `
  -ContentType "application/json" `
  -Body $body

$resp | ConvertTo-Json -Depth 8
