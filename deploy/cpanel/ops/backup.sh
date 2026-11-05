#!/bin/bash
# Cron, daily: compressed dump of the Darb database into ~/darb-backups, keeping 14 days.
# The password reaches mysqldump through its environment only (never the command line).
set -euo pipefail
APP_ROOT="$HOME/darb-app"
OUT="$HOME/darb-backups/darb-$(date +%Y%m%d-%H%M%S).sql.gz"
umask 077
cd "$APP_ROOT"
node ops/run.mjs bash -c 'MYSQL_PWD="$DB_PASSWORD" mysqldump --single-transaction --triggers --no-tablespaces -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME"' | gzip > "$OUT"
find "$HOME/darb-backups" -name 'darb-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) backup written: $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
