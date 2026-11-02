# Stops what start.ps1 started (and anything still listening on those two ports).
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$file = Join-Path $root ".staging-data\test-env\pids.json"
$ports = @(3000, 5173)
if (Test-Path $file) {
  $state = Get-Content $file -Raw | ConvertFrom-Json
  $ports = @($state.apiPort, $state.adminPort)
  foreach ($id in $state.api, $state.admin) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}
foreach ($port in $ports) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Write-Output "Stopped."
