# Puts the disposable masari_demo database back to the clean test starting state:
# protected demo reset, the three pending/rejected approval accounts, placeholder
# legal text, and fresh sign-up invitations (written to .staging-data/test-env/invitations.txt).
# The API must be running (scripts/test-env/start.ps1).
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
Set-Location $root

$values = @{}
foreach ($line in Get-Content (Join-Path $root "apps\api\.env")) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim('"') }
}
$env:DATABASE_URL = $values["DATABASE_URL"] -replace "/[A-Za-z0-9_]+(\?|$)", "/masari_demo`$1"
$env:DEMO_RESET_ALLOWED_DATABASES = "masari_demo"
foreach ($key in $values.Keys) { if ($key -ne "DATABASE_URL") { Set-Item -Path "Env:$key" -Value $values[$key] } }
$env:APP_ENV = "demo"

# Test sign-ups are real accounts until marked; the protected reset only removes demo data.
node scripts/test-env/mark-test-users.mjs

$apiBase = "http://localhost:3000/api/v1"
Invoke-RestMethod -Method Post -Uri "$apiBase/demo/reset" -Headers @{ "x-demo-reset-key" = $values["DEMO_RESET_KEY"] } -ContentType "application/json" -Body "{}" | Out-Null
Write-Output "Demo data reset."
npm run demo:seed-approvals 2>&1 | Select-String '"ok":true' | ForEach-Object { Write-Output "Approval accounts seeded." }
node scripts/test-env/seed-onboarding.mjs
Remove-Item (Join-Path $root ".staging-data\test-env\otp.txt") -ErrorAction SilentlyContinue
Write-Output "Ready. Codes: .staging-data/test-env/invitations.txt"
