param(
  [string]$ProjectUrl = $env:SUPABASE_URL,
  [string]$CronSecret = $env:CRON_SECRET,
  [string]$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY,
  [string]$JobId = $env:JOB_ID
)

function Fail($msg) {
  Write-Host "FAIL  $msg" -ForegroundColor Red
}

function Ok($msg) {
  Write-Host "OK    $msg" -ForegroundColor Green
}

function Info($msg) {
  Write-Host "INFO  $msg" -ForegroundColor Cyan
}

if (-not $ProjectUrl) {
  Fail "SUPABASE_URL not set. Example: `$env:SUPABASE_URL = 'https://<PROJECT_REF>.supabase.co'"
  exit 1
}

Info "Using SUPABASE_URL = $ProjectUrl"

function IsHealthOk($resp) {
  if ($null -eq $resp) { return $false }
  if ($resp -is [string]) { return $resp.Trim().ToLower() -eq "ok" }
  try {
    if ($resp.ok -eq $true) { return $true }
    if ($resp.message -and $resp.message.ToString().ToLower() -eq "ok") { return $true }
    if ($resp.isHealthy -eq $true) { return $true }
    if ($resp.statusCode -eq 200) { return $true }
  } catch {}
  return $false
}

try {
  $health = Invoke-RestMethod -Uri "$ProjectUrl/functions/v1/_internal/health" -Method Get
  if (IsHealthOk $health) {
    Ok "health"
  } else {
    Fail "health (unexpected response: $($health | ConvertTo-Json -Compress))"
  }
} catch {
  Fail "health: $($_.Exception.Message)"
}

if ($CronSecret) {
  try {
    $ping = Invoke-RestMethod -Uri "$ProjectUrl/functions/v1/ping_cron" -Method Get -Headers @{ "x-cron-secret" = $CronSecret }
    if ($ping -and $ping.ok -eq $true) { Ok "ping_cron" } else { Fail "ping_cron (unexpected response)" }
  } catch {
    Fail "ping_cron: $($_.Exception.Message) (check CRON_SECRET for prod)"
  }

  try {
    $desc = Invoke-RestMethod -Uri "$ProjectUrl/functions/v1/job_enrich_description?limit=2&dry_run=1" -Method Get -Headers @{ "x-cron-secret" = $CronSecret }
    if ($desc -and $desc.ok -eq $true) { Ok "job_enrich_description (dry_run)" } else { Fail "job_enrich_description (unexpected response)" }
  } catch {
    Fail "job_enrich_description: $($_.Exception.Message) (check CRON_SECRET for prod)"
  }
} else {
  Fail "CRON_SECRET missing. Skipping ping_cron + job_enrich_description."
}

if ($ServiceRoleKey -and $JobId) {
  try {
    $body = @{ job_id = $JobId; debug = $true; persist = $false } | ConvertTo-Json
    $jr = Invoke-RestMethod -Uri "$ProjectUrl/functions/v1/job_enrich" -Method Post -ContentType "application/json" -Body $body -Headers @{
      "apikey" = $ServiceRoleKey
      "authorization" = "Bearer $ServiceRoleKey"
    }
    if ($jr -and $jr.ok -eq $true) { Ok "job_enrich (debug, persist=false)" } else { Fail "job_enrich (unexpected response)" }
  } catch {
    Fail "job_enrich: $($_.Exception.Message) (check SERVICE_ROLE_KEY + JOB_ID)"
  }
} else {
  Info "job_enrich check skipped (requires SUPABASE_SERVICE_ROLE_KEY + JOB_ID)."
}
