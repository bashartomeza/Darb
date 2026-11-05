#!/bin/bash
# Cron, daily: document expiry reminders, document, receiver-data, live-location and expired-row retention, trust scores.
# One failing job does not stop the others.
APP_ROOT="$HOME/darb-app"
cd "$APP_ROOT" || exit 1
# shellcheck disable=SC1090
set +u
source "$HOME/nodevenv/darb-app/22/bin/activate"
set -u
for job in checkDriverDocumentExpiry purgeDriverDocuments purgePassengerParcelReceivers purgeLocationEvents purgeExpiredData recomputeDriverTrust; do
  echo "$(date -Is) $job"
  node ops/run.mjs node "dist/scripts/$job.js" || echo "$(date -Is) $job failed"
done
