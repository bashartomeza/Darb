# Starts the local test environment: API (port 3000) and Admin site (port 5173) on the
# disposable masari_demo database. State, logs and one-time codes live in
# .staging-data/test-env (git-ignored).
#
#   pwsh -NoProfile -File scripts/test-env/start.ps1
#   pwsh -NoProfile -File scripts/test-env/stop.ps1
param([int]$ApiPort = 3000, [int]$AdminPort = 5173)
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
if (-not (Test-Path (Join-Path $root "apps\api\dist\server.js"))) { throw "Build first: npm run build -w @masari/api" }

# Settings come from apps/api/.env, then the database is pointed at the disposable demo one.
$values = @{}
foreach ($line in Get-Content (Join-Path $root "apps\api\.env")) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim('"') }
}
$databaseUrl = $values["DATABASE_URL"] -replace "/[A-Za-z0-9_]+(\?|$)", "/masari_demo`$1"

# Admin site first, with a clean environment (it reads its own apps/admin/.env.local).
$adminProcess = Start-Process -FilePath (Get-Command npm.cmd).Source `
  -ArgumentList @("run", "dev", "-w", "@masari/admin", "--", "--port", "$AdminPort", "--strictPort") `
  -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $state "admin.log") -RedirectStandardError (Join-Path $state "admin.err.log")

# API: settings from apps/api/.env, pointed at the disposable demo database.
foreach ($key in $values.Keys) { Set-Item -Path "Env:$key" -Value $values[$key] }
$env:DATABASE_URL = $databaseUrl
$env:APP_ENV = "demo"
$env:PORT = "$ApiPort"
$env:DEMO_RESET_ALLOWED_DATABASES = "masari_demo"
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
if (Test-MailPassword) {
  $env:DEMO_SMTP_USER = "basharto30@gmail.com"
  $env:DEMO_SMTP_PASSWORD = Get-MailPassword
  $mailMode = "real emails are sent from $($env:DEMO_SMTP_USER)"
} else {
  Remove-Item Env:DEMO_SMTP_USER, Env:DEMO_SMTP_PASSWORD -ErrorAction SilentlyContinue
  $mailMode = "no real emails (tokens are only written to the file)"
}
$env:DRIVER_DOCUMENTS_ENABLED = "true"
$env:DRIVER_DOCUMENTS_DIR = Join-Path $state "driver-docs"
# Local test environment only: drivers and shop owners may sign up without an invitation code.
$env:OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED = "true"
# Local test environment only: route catalogue, route fares and passenger parcels need the canonical route entry
# switches (matching and trip creation stay off, so the main story keeps using the classic flow).
$env:ROUTE_MANAGEMENT_ENABLED = "true"
$env:MULTI_ROUTE_ENTRY_ENABLED = "true"
$env:CORS_ORIGINS = "http://localhost:$AdminPort,http://127.0.0.1:$AdminPort"
$apiProcess = Start-Process -FilePath (Get-Command node).Source `
  -ArgumentList @((Join-Path $root "scripts/test-env/test-api-server.mjs")) `
  -WorkingDirectory (Join-Path $root "apps/api") -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $state "api.log") -RedirectStandardError (Join-Path $state "api.err.log")

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
Write-Output "API   http://localhost:$ApiPort   ready: $apiUp"
Write-Output "Admin http://localhost:$AdminPort   ready: $adminUp"
Write-Output "One-time sign-up codes appear in: $(Join-Path $state 'otp.txt')"
Write-Output "Email sign-up codes (normal users) appear in: $(Join-Path $state 'email-codes.txt') - $mailMode"
if (-not ($apiUp -and $adminUp)) { Write-Output "Something did not start; run stop.ps1 and check the build and .env."; exit 1 }
