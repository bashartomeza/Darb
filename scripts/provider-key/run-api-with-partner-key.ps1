# Starts the built API with the limited partner-directory gate enabled and the
# partner key injected into the CHILD process environment only.
#
# Safety rules enforced here:
# - the database name must end in _ci, _qa or _sim (disposable databases only);
# - every other checkpoint, map, research and demo gate is cleared for the child;
# - the key is never placed in an argument, a file, the parent environment or output;
# - -Synthetic uses a random throwaway key (never stored) so the mechanism can be
#   checked with no real credential and no provider request.
#
# The caller supplies DATABASE_URL, JWT_SECRET and CORS_ORIGINS in the shell.
param([switch]$Synthetic, [int]$Port = 3200)
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "PartnerKey.psm1") -Force

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$server = Join-Path $root "apps\api\dist\server.js"
if (-not (Test-Path -LiteralPath $server)) { throw "Build the API first: npm run build -w @masari/api" }

foreach ($name in "DATABASE_URL", "JWT_SECRET") {
  if (-not (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue)) { throw "$name must be set in this shell." }
}
$databaseName = ([Uri]$env:DATABASE_URL).AbsolutePath.TrimStart('/')
if ($databaseName -notmatch "(_ci|_qa|_sim)$") {
  throw "Refusing database '$databaseName': use a disposable database whose name ends in _ci, _qa or _sim."
}

if ($Synthetic) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $key = "synthetic-" + [Convert]::ToHexString($bytes)
} else {
  $key = Get-PartnerKey
}

$startInfo = New-Object Diagnostics.ProcessStartInfo
$startInfo.FileName = (Get-Command node).Source
$startInfo.ArgumentList.Add($server)
$startInfo.WorkingDirectory = Join-Path $root "apps\api"
$startInfo.UseShellExecute = $false

# Start from what the shell provides, then clear every gate this check must not touch.
$clear = @(
  "ENABLE_DEMO_FEATURES", "DEMO_RESET_KEY", "DEMO_RESET_ALLOWED_DATABASES",
  "MAPS_ENABLED", "ROUTE_MAPS_ENABLED", "ROUTE_PROVIDER",
  "CHECKPOINTS_ENABLED", "CHECKPOINTS_URL", "CHECKPOINTS_API_KEY",
  "CHECKPOINT_DIRECTORY_ENABLED", "CHECKPOINT_DIRECTORY_FILE",
  "DRIVER_DOCUMENTS_ENABLED"
)
foreach ($name in $clear) { [void]$startInfo.Environment.Remove($name) }
foreach ($name in @($startInfo.Environment.Keys | Where-Object { $_ -like "DEMO_*" })) { [void]$startInfo.Environment.Remove($name) }
$startInfo.Environment["APP_ENV"] = "local"
$startInfo.Environment["PORT"] = "$Port"
$startInfo.Environment["ENABLE_DEMO_FEATURES"] = "false"
$startInfo.Environment["AWEENRAYEH_LIMITED_DIRECTORY_ENABLED"] = "true"
$startInfo.Environment["AWEENRAYEH_PARTNER_API_KEY"] = $key
if (-not $startInfo.Environment.ContainsKey("CORS_ORIGINS")) { $startInfo.Environment["CORS_ORIGINS"] = "http://localhost:5173" }
$key = $null

$mode = if ($Synthetic) { " (synthetic key)" } else { "" }
Write-Output "Starting the API on port $Port against '$databaseName' with only the limited partner-directory gate enabled$mode. Stop it with Ctrl+C."
$process = [Diagnostics.Process]::Start($startInfo)
try { $process.WaitForExit() } finally { if (-not $process.HasExited) { $process.Kill($true) } }
exit $process.ExitCode
