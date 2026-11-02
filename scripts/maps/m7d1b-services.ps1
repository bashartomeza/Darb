param(
  [ValidateSet("prepare", "valhalla-build", "valhalla-serve", "nominatim-import", "status", "cleanup")]
  [string]$Action = "status",
  [string]$EvidenceDirectory = (Join-Path ([System.IO.Path]::GetTempPath()) "darb-m7d1b-evidence"),
  [switch]$ConfirmCleanup
)

$ErrorActionPreference = "Stop"
$PbfName = "israel-and-palestine-260806.osm.pbf"
$PbfUrl = "https://download.geofabrik.de/asia/$PbfName"
$ExpectedSha256 = "36e45cb73d7fa584fbdf58836b615174122c32f22bf1871ec691161826af79aa"
$ValhallaImage = "ghcr.io/valhalla/valhalla-scripted@sha256:24ef7955899dececb94e26c6dfb89d64fabfae875f980432694b0261eb6c251b"
$NominatimImage = "mediagis/nominatim@sha256:7923a8e67197fc6d4f4ecb7c0e8bbedffeddcfdf4519596fe946e46a28f5a9f8"
$ValhallaBuildContainer = "darb-m7d1b-evidence-valhalla-build"
$ValhallaServeContainer = "darb-m7d1b-evidence-valhalla-serve"
$NominatimContainer = "darb-m7d1b-evidence-nominatim"
$NominatimPbfVolume = "darb-m7d1b-evidence-nominatim-pbf"
$NominatimDbVolume = "darb-m7d1b-evidence-nominatim-db"
$PbfPath = Join-Path $EvidenceDirectory $PbfName

function Invoke-Docker {
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') failed" }
}

function Remove-ContainerIfPresent([string]$Name) {
  $present = & docker ps -aq --filter "name=^/$Name$"
  if ($present) { Invoke-Docker rm -f $Name | Out-Null }
}

function Prepare-Pbf {
  New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
  if (-not (Test-Path -LiteralPath $PbfPath)) { Invoke-WebRequest -Uri $PbfUrl -OutFile $PbfPath }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $PbfPath).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedSha256) { throw "PBF checksum mismatch: $actual" }
  [pscustomobject]@{ path = $PbfPath; bytes = (Get-Item -LiteralPath $PbfPath).Length; sha256 = $actual }
}

function Wait-Http([string]$Url, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try { $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $Url; if ($response.StatusCode -eq 200) { return } } catch {}
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Url"
}

switch ($Action) {
  "prepare" { Prepare-Pbf }
  "valhalla-build" {
    Prepare-Pbf | Out-Null
    Remove-ContainerIfPresent $ValhallaBuildContainer
    Invoke-Docker run -d --name $ValhallaBuildContainer -p "127.0.0.1:18002:8002" -v "${EvidenceDirectory}:/custom_files" `
      -e use_tiles_ignore_pbf=False -e force_rebuild=True -e build_tar=True -e serve_tiles=True `
      -e build_admins=True -e build_time_zones=True -e build_elevation=False -e build_transit=False -e server_threads=8 $ValhallaImage | Out-Null
    Wait-Http "http://127.0.0.1:18002/status" 600
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:18002/status" | Select-Object StatusCode, Content
  }
  "valhalla-serve" {
    if (-not (Test-Path -LiteralPath (Join-Path $EvidenceDirectory "valhalla_tiles.tar"))) { throw "Build the graph first" }
    Remove-ContainerIfPresent $ValhallaServeContainer
    Invoke-Docker run -d --name $ValhallaServeContainer -p "127.0.0.1:18003:8002" -v "${EvidenceDirectory}:/custom_files" `
      -e use_tiles_ignore_pbf=True -e force_rebuild=False -e build_tar=False -e serve_tiles=True `
      -e build_admins=False -e build_time_zones=False -e build_elevation=False -e build_transit=False -e server_threads=8 $ValhallaImage | Out-Null
    Wait-Http "http://127.0.0.1:18003/status" 60
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:18003/status" | Select-Object StatusCode, Content
  }
  "nominatim-import" {
    Prepare-Pbf | Out-Null
    Remove-ContainerIfPresent $NominatimContainer
    foreach ($volume in @($NominatimPbfVolume, $NominatimDbVolume)) {
      $present = & docker volume ls -q --filter "name=^${volume}$"
      if ($present) { throw "Disposable volume $volume already exists; run cleanup explicitly before a fresh import" }
      Invoke-Docker volume create $volume | Out-Null
    }
    Invoke-Docker run --rm -v "${EvidenceDirectory}:/source:ro" -v "${NominatimPbfVolume}:/target" alpine:3.22 sh -c "cp /source/$PbfName /target/region.osm.pbf && chmod 644 /target/region.osm.pbf" | Out-Null
    $disposablePassword = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
    Invoke-Docker run -d --name $NominatimContainer -p "127.0.0.1:18080:8080" `
      -v "${NominatimPbfVolume}:/nominatim/data" -v "${NominatimDbVolume}:/var/lib/postgresql/16/main" `
      -e PBF_PATH=/nominatim/data/region.osm.pbf -e IMPORT_STYLE=full -e THREADS=8 -e FREEZE=true -e UPDATE_MODE=none `
      -e IMPORT_WIKIPEDIA=false -e IMPORT_US_POSTCODES=false -e IMPORT_GB_POSTCODES=false `
      -e POSTGRES_SHARED_BUFFERS=512MB -e POSTGRES_MAINTENANCE_WORK_MEM=2GB -e POSTGRES_AUTOVACUUM_WORK_MEM=1GB `
      -e POSTGRES_WORK_MEM=50MB -e POSTGRES_EFFECTIVE_CACHE_SIZE=4GB -e POSTGRES_SYNCHRONOUS_COMMIT=off `
      -e POSTGRES_MAX_WAL_SIZE=2GB -e POSTGRES_CHECKPOINT_TIMEOUT=10min -e POSTGRES_CHECKPOINT_COMPLETION_TARGET=0.9 `
      -e "NOMINATIM_PASSWORD=$disposablePassword" --entrypoint bash $NominatimImage `
      -c "exec 9>/dev/null; export BASH_XTRACEFD=9; exec /app/start.sh" | Out-Null
    $disposablePassword = $null
    Wait-Http "http://127.0.0.1:18080/status.php" 900
    $secretTraceHits = (& docker logs $NominatimContainer 2>&1 | Select-String -Pattern "useradd -m -p|ALTER USER|NOMINATIM_PASSWORD").Count
    if ($secretTraceHits -ne 0) { throw "Secret-bearing trace pattern detected; do not retain or publish these logs" }
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:18080/status.php" | Select-Object StatusCode, Content
  }
  "status" {
    Invoke-Docker ps -a --filter "name=darb-m7d1b-evidence" --format "{{.Names}} {{.Status}}"
  }
  "cleanup" {
    if (-not $ConfirmCleanup) { throw "cleanup requires -ConfirmCleanup" }
    foreach ($container in @($ValhallaBuildContainer, $ValhallaServeContainer, $NominatimContainer)) { Remove-ContainerIfPresent $container }
    foreach ($volume in @($NominatimPbfVolume, $NominatimDbVolume)) {
      $present = & docker volume ls -q --filter "name=^${volume}$"
      if ($present) { Invoke-Docker volume rm $volume | Out-Null }
    }
    "Removed only the disposable M7D1B evidence containers and Nominatim volumes. The downloaded PBF/Valhalla graph remain in $EvidenceDirectory."
  }
}
