# Deploys Darb (API + Admin site) to the cPanel account that serves https://darb.aynur.ps.
# Run from the repo root on a clean checkout of the commit to release:
#   pwsh -NoProfile -File deploy/cpanel/deploy.ps1              # build, upload, install, restart
#   pwsh -NoProfile -File deploy/cpanel/deploy.ps1 -FirstTime   # first run: upload + create .env + register the app
# Access is by SSH key (~/.ssh/darb_injazat, authorized in cPanel > SSH Access); no password is used or printed.
param([switch]$FirstTime, [switch]$AllowDirty)
$ErrorActionPreference = "Stop"

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$sshKey = Join-Path $env:USERPROFILE ".ssh\darb_injazat"
$sshTarget = "aynurzzx@45.159.160.11"
$sshPort = "22022"
$sshArgs = @("-i", $sshKey, "-p", $sshPort, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes")
$scpArgs = @("-i", $sshKey, "-P", $sshPort, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes")
Set-Location $root

if (-not $AllowDirty -and (git status --porcelain --untracked-files=no)) { throw "Tracked files have local changes; commit or stash them, or pass -AllowDirty." }
$release = (git rev-parse --short=12 HEAD).Trim()
Write-Output "Release $release"

# 1. Build the API and the Admin site (the Admin calls the API on the same origin).
#    The Prisma client is regenerated first so it always matches this commit's schema.
$env:DATABASE_URL = "mysql://build:unused@localhost:3306/build"
try { Push-Location apps/api; npx prisma generate | Out-Null; if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" } }
finally { Pop-Location; Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
npm run build -w @darb/api | Out-Null
if ($LASTEXITCODE -ne 0) { throw "API build failed" }
$env:VITE_APP_ENV = "production"; $env:VITE_ENABLE_DEMO_FEATURES = "false"; $env:VITE_API_BASE_URL = "https://darb.aynur.ps"
try { npm run build -w @darb/admin | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Admin build failed" } }
finally { Remove-Item Env:VITE_APP_ENV, Env:VITE_ENABLE_DEMO_FEATURES, Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue }

# 2. Stage the release: compiled API, Prisma schema + migrations, Admin build, startup file, server scripts,
#    and a package.json whose dependencies are pinned to the exact versions in package-lock.json.
$stage = Join-Path ([IO.Path]::GetTempPath()) "darb-release-$release"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory $stage | Out-Null
Copy-Item -Recurse apps/api/dist (Join-Path $stage "dist")
Copy-Item -Recurse apps/api/prisma (Join-Path $stage "prisma")
Copy-Item apps/api/prisma.config.ts $stage
Copy-Item -Recurse apps/admin/dist (Join-Path $stage "admin")
Copy-Item deploy/cpanel/app.js $stage
Copy-Item -Recurse deploy/cpanel/ops (Join-Path $stage "ops")
Set-Content -NoNewline -Path (Join-Path $stage "release.txt") -Value $release
node -e @"
const fs = require('fs');
const api = require('./apps/api/package.json');
const lock = require('./package-lock.json').packages;
const exact = (name) => { const key = Object.keys(lock).find((k) => k === 'node_modules/' + name || k.endsWith('/node_modules/' + name)); if (!key) throw new Error('not in lock: ' + name); return lock[key].version; };
const deps = {};
for (const name of [...Object.keys(api.dependencies), 'prisma']) deps[name] = exact(name);
fs.writeFileSync(process.argv[1], JSON.stringify({ name: 'darb-app', private: true, type: 'module', engines: { node: '>=22' }, dependencies: deps }, null, 2) + '\n');
"@ (Join-Path $stage "package.json")
if ($LASTEXITCODE -ne 0) { throw "Could not write the release package.json" }

$tarball = Join-Path ([IO.Path]::GetTempPath()) "darb-release-$release.tgz"
tar -czf $tarball -C $stage .
Write-Output ("Release package: {0:N1} MB" -f ((Get-Item $tarball).Length / 1MB))

# 3. Upload and unpack. Only the release-owned paths are replaced; .env, logs, tmp, node_modules stay.
scp @scpArgs $tarball "${sshTarget}:darb-release.tgz" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Upload failed" }
$unpack = 'set -e; mkdir -p ~/darb-app && cd ~/darb-app && rm -rf dist admin prisma ops app.js prisma.config.ts release.txt && tar -xzf ~/darb-release.tgz && rm -f ~/darb-release.tgz && chmod +x ops/*.sh'
ssh @sshArgs $sshTarget $unpack
if ($LASTEXITCODE -ne 0) { throw "Unpacking on the server failed" }

# 4. First run: create .env and register the app, then stop so the owner can fill in the two passwords.
if ($FirstTime) {
  ssh @sshArgs $sshTarget "cd ~/darb-app && bash ops/setup.sh"
  Write-Output "Next: open cPanel > File Manager > darb-app/.env, fill DB_PASSWORD and SMTP_PASSWORD, save, then run deploy.ps1 without -FirstTime."
  exit $LASTEXITCODE
}

# 5. Install, migrate, restart, cron, health check.
ssh @sshArgs $sshTarget "cd ~/darb-app && bash ops/install.sh"
if ($LASTEXITCODE -ne 0) { throw "Install on the server failed" }
Remove-Item -Recurse -Force $stage, $tarball
Write-Output "Deployed $release to https://darb.aynur.ps"
