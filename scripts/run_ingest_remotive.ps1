$ErrorActionPreference = "Stop"

$secret = (Get-Content "supabase\functions\.env" | Where-Object { $_ -match "^CRON_SECRET=" }) -replace "^CRON_SECRET=", ""
$secret = $secret.Trim()

$resp = Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:54321/functions/v1/ingest_remotive" `
  -Headers @{ "Authorization" = "Bearer $secret" } `
  -ContentType "application/json" `
  -Body "{}"

$resp | Format-Table -AutoSize
