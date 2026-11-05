#!/bin/bash
# Server half of a deploy (deploy.ps1 uploads the release, then runs this from ~/darb-app):
#   bash ops/install.sh
# 1. installs production packages into the CloudLinux Node.js environment when package.json changed,
# 2. applies pending database migrations, 3. restarts the app, 4. installs the Darb cron jobs
# (only lines tagged "# darb-app"; other cron jobs on the account are left untouched),
# 5. checks that the API answers.
set -euo pipefail

APP_ROOT="$HOME/darb-app"
NODE_VERSION="22"
cd "$APP_ROOT"

# shellcheck disable=SC1090
set +u
source "$HOME/nodevenv/darb-app/$NODE_VERSION/bin/activate"
set -u

# DB_PASSWORD and SMTP_PASSWORD come from cPanel > Setup Node.js App > Environment variables (or .env).
node ops/run.mjs node -e 'for (const k of ["DB_PASSWORD","SMTP_PASSWORD"]) if (!process.env[k]) { console.error(k + " is not set: add it in cPanel > Setup Node.js App > Environment variables."); process.exit(1) }'

release="$(cat release.txt)"
sed -i "s/^APP_RELEASE=.*/APP_RELEASE=\"$release\"/" .env

hash_now="$(sha256sum package.json | cut -d' ' -f1)"
hash_old="$(cat .installed-package-hash 2>/dev/null || true)"
if [ "$hash_now" != "$hash_old" ]; then
  echo "Installing production packages..."
  npm install --omit=dev --no-audit --no-fund --loglevel=error
  echo "$hash_now" > .installed-package-hash
else
  echo "Packages unchanged."
fi

echo "Checking the settings..."
node ops/run.mjs node --input-type=module -e "await import('./dist/config.js'); console.log('Settings OK')"

echo "Applying database migrations..."
node ops/run.mjs node ops/mariadb/migrate-deploy.mjs deploy

echo "Restarting the app..."
mkdir -p tmp && touch tmp/restart.txt

# Cron jobs, tagged so a re-run replaces exactly these lines.
existing="$(crontab -l 2>/dev/null | grep -v '# darb-app' || true)"
{
  [ -n "$existing" ] && printf '%s\n' "$existing"
  echo "*/5 * * * * bash $APP_ROOT/ops/keepalive.sh >/dev/null 2>&1 # darb-app"
  echo "15 2 * * * bash $APP_ROOT/ops/backup.sh >> $APP_ROOT/logs/backup.log 2>&1 # darb-app"
  echo "40 2 * * * bash $APP_ROOT/ops/jobs.sh >> $APP_ROOT/logs/jobs.log 2>&1 # darb-app"
} | crontab -
echo "Cron jobs installed (keep-alive every 5 min, backup 02:15, daily jobs 02:40)."

echo "Waiting for the API..."
for i in $(seq 1 30); do
  if curl -fsS "https://darb.aynur.ps/api/v1/health/ready" >/dev/null 2>&1; then
    echo "API is up: https://darb.aynur.ps/api/v1/health/ready"
    exit 0
  fi
  sleep 3
done
echo "The API did not answer in time. Check $APP_ROOT/stderr.log and cPanel > Setup Node.js App."
exit 1
