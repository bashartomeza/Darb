# Starts the local environment: API (port 3000) and Admin site (port 5173). By default it runs
# on the permanent `darb` database: everything created in the apps is kept, pending migrations
# are applied first, and the demo reset refuses this database (lib/demoResetSafety.ts).
# -Disposable runs on the resettable darb_demo database instead (scripts/test-env/reset-data.ps1).
# State, logs and one-time codes live in .staging-data/test-env (git-ignored).
#
#   pwsh -NoProfile -File scripts/test-env/start.ps1 [-Disposable]
#   pwsh -NoProfile -File scripts/test-env/stop.ps1
param([int]$ApiPort = 3000, [int]$AdminPort = 5173, [switch]$RealMail, [switch]$Disposable)
$ErrorActionPreference = "Stop"

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$state = Join-Path $root ".staging-data\test-env"
New-Item -ItemType Directory -Force -Path $state | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $state "driver-docs") | Out-Null

foreach ($port in $ApiPort, $AdminPort) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. Stop whatever is using it (or run stop.ps1) and try again."
  }
}
if (-not (Test-Path (Join-Path $root "apps\api\dist\server.js"))) { throw "Build first: npm run build -w @darb/api" }

# Settings come from apps/api/.env, then the database is pointed at `darb` (or darb_demo).
$values = @{}
foreach ($line in Get-Content (Join-Path $root "apps\api\.env")) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim('"') }
}
$databaseName = if ($Disposable) { "darb_demo" } else { "darb" }
$databaseUrl = $values["DATABASE_URL"] -replace "/[A-Za-z0-9_]+(\?|$)", "/$databaseName`$1"

# Bring the database schema up to date before anything uses it (applies only pending migrations).
$env:DATABASE_URL = $databaseUrl
Push-Location (Join-Path $root "apps\api")
try {
  npx prisma migrate deploy 2>&1 | Out-File -Encoding utf8 (Join-Path $state "migrate.log")
  if ($LASTEXITCODE -ne 0) { throw "Database migration failed; see $(Join-Path $state 'migrate.log')." }
} finally {
  Pop-Location
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}

# Admin site first, with a clean environment (it reads its own apps/admin/.env.local).
$adminProcess = Start-Process -FilePath (Get-Command npm.cmd).Source `
  -ArgumentList @("run", "dev", "-w", "@darb/admin", "--", "--port", "$AdminPort", "--strictPort") `
  -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $state "admin.log") -RedirectStandardError (Join-Path $state "admin.err.log")

# API: settings from apps/api/.env, pointed at the chosen database.
foreach ($key in $values.Keys) { Set-Item -Path "Env:$key" -Value $values[$key] }
$env:DATABASE_URL = $databaseUrl
$env:APP_ENV = "demo"
$env:PORT = "$ApiPort"
# Only the disposable database may ever be reset; the permanent one is never listed.
$env:DEMO_RESET_ALLOWED_DATABASES = if ($Disposable) { "darb_demo" } else { "" }
$env:TEST_OTP_FILE = Join-Path $state "otp.txt"
# Email sign-up needs a secret for its one-time tokens; keep one per test machine.
$pepperFile = Join-Path $state "auth-pepper.txt"
if (-not (Test-Path $pepperFile)) {
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  [Convert]::ToBase64String($bytes) | Set-Content -NoNewline $pepperFile
}
$env:AUTH_ACTION_TOKEN_PEPPER = (Get-Content $pepperFile -Raw).Trim()
# Real verification emails: only when the Gmail App Password was stored (set-mail-password.ps1).
Import-Module (Join-Path $PSScriptRoot "MailPassword.psm1") -Force
# Real emails are off unless -RealMail is passed (the stored App Password is kept either way).
if ($RealMail -and (Test-MailPassword)) {
  $env:DEMO_SMTP_USER = "basharto30@gmail.com"
  $env:DEMO_SMTP_PASSWORD = Get-MailPassword
  $mailMode = "real emails are sent from $($env:DEMO_SMTP_USER)"
} else {
  Remove-Item Env:DEMO_SMTP_USER, Env:DEMO_SMTP_PASSWORD -ErrorAction SilentlyContinue
  $mailMode = "no real emails (tokens are only written to the file)"
}
$env:DRIVER_DOCUMENTS_ENABLED = "true"
$env:DRIVER_DOCUMENTS_DIR = Join-Path $state "driver-docs"
# Local test environment only: route catalogue, route fares and passenger parcels need the canonical route entry
# switches (matching and trip creation stay off, so the main story keeps using the classic flow).
$env:ROUTE_MANAGEMENT_ENABLED = "true"
$env:MULTI_ROUTE_ENTRY_ENABLED = "true"
$env:CORS_ORIGINS = "http://localhost:$AdminPort,http://127.0.0.1:$AdminPort"

# Checkpoint sources (docs/checkpoints/map-sources.md). Each one is switched on only
# when its data or key is actually present, and the active ones are printed below.
$checkpointSources = @()
# 1. Coordinate feed: only when apps/api/.env provides both its address and key.
if ($values["CHECKPOINTS_URL"] -and $values["CHECKPOINTS_API_KEY"]) {
  $env:MAPS_ENABLED = "true"
  $env:CHECKPOINTS_ENABLED = "true"
  $checkpointSources += "coordinate feed (CHECKPOINTS_URL)"
} else {
  Remove-Item Env:CHECKPOINTS_ENABLED -ErrorAction SilentlyContinue
}
# 2. AweenRayeh partner API: names and last-changed times, placed on the map where the
#    name matches an OpenStreetMap checkpoint. The key stays in Windows Credential Manager
#    (scripts/provider-key/set-partner-key.ps1) and only reaches the API process.
Import-Module (Join-Path $root "scripts\provider-key\PartnerKey.psm1") -Force
$partnerKey = $null
if (Test-PartnerKey) {
  $partnerKey = Get-PartnerKey
  $env:AWEENRAYEH_LIMITED_DIRECTORY_ENABLED = "true"
  $env:PARTNER_CHECKPOINT_MAP_ENABLED = "true"
  $checkpointSources += "AweenRayeh partner API (pins from OpenStreetMap name matches)"
} else {
  Remove-Item Env:AWEENRAYEH_LIMITED_DIRECTORY_ENABLED, Env:PARTNER_CHECKPOINT_MAP_ENABLED -ErrorAction SilentlyContinue
}
# 3. Research directory (names only, never pins): when its local file exists.
$directoryFile = Join-Path $state "checkpoint-directory.json"
if (Test-Path -LiteralPath $directoryFile) {
  $env:CHECKPOINT_DIRECTORY_ENABLED = "true"
  $env:CHECKPOINT_DIRECTORY_FILE = $directoryFile
  $checkpointSources += "research directory file (names only, no map pins)"
} else {
  Remove-Item Env:CHECKPOINT_DIRECTORY_ENABLED, Env:CHECKPOINT_DIRECTORY_FILE -ErrorAction SilentlyContinue
}

if ($partnerKey) { $env:AWEENRAYEH_PARTNER_API_KEY = $partnerKey }
try {
  $apiProcess = Start-Process -FilePath (Get-Command node).Source `
    -ArgumentList @((Join-Path $root "scripts/test-env/test-api-server.mjs")) `
    -WorkingDirectory (Join-Path $root "apps/api") -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $state "api.log") -RedirectStandardError (Join-Path $state "api.err.log")
} finally {
  # The key was only for the API child; never keep it in this shell.
  Remove-Item Env:AWEENRAYEH_PARTNER_API_KEY -ErrorAction SilentlyContinue
  $partnerKey = $null
}

@{ api = $apiProcess.Id; admin = $adminProcess.Id; apiPort = $ApiPort; adminPort = $AdminPort } | ConvertTo-Json | Set-Content (Join-Path $state "pids.json")

function Wait-Http($url) {
  for ($i = 0; $i -lt 90; $i++) {
    try { if ((Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { return $true } } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}
$apiUp = Wait-Http "http://127.0.0.1:$ApiPort/api/v1/health/ready"
$adminUp = Wait-Http "http://localhost:$AdminPort/"
Write-Output "Database: $databaseName $(if ($Disposable) { '(disposable, reset-data.ps1 can wipe it)' } else { '(permanent, never reset)' })"
Write-Output "API   http://localhost:$ApiPort   ready: $apiUp"
Write-Output "Admin http://localhost:$AdminPort   ready: $adminUp"
Write-Output "One-time sign-up codes appear in: $(Join-Path $state 'otp.txt')"
Write-Output "Email sign-up codes (normal users) appear in: $(Join-Path $state 'email-codes.txt') - $mailMode"
if ($checkpointSources.Count -gt 0) {
  Write-Output "Checkpoint data: $($checkpointSources -join '; ')"
} else {
  Write-Output "Checkpoint data: none configured - the maps show 'checkpoint data unavailable' (see docs/checkpoints/map-sources.md)"
}
if (-not ($apiUp -and $adminUp)) { Write-Output "Something did not start; run stop.ps1 and check the build and .env."; exit 1 }
