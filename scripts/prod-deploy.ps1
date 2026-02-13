param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [string[]]$Functions = @(
    "job_enrich_description",
    "job_enrich",
    "ingest_remotive",
    "ingest_source",
    "cv_extract"
  )
)

function Info($msg) {
  Write-Host "INFO  $msg" -ForegroundColor Cyan
}

function Ok($msg) {
  Write-Host "OK    $msg" -ForegroundColor Green
}

function Fail($msg) {
  Write-Host "FAIL  $msg" -ForegroundColor Red
}

Info "Deploying to project: $ProjectRef"
Info "Functions: $($Functions -join ', ')"

foreach ($fn in $Functions) {
  Info "Deploying function: $fn"
  supabase functions deploy $fn --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) {
    Fail "Deploy failed for $fn"
    exit $LASTEXITCODE
  }
  Ok "Deployed $fn"
}

Ok "All functions deployed."
