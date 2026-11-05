#!/bin/bash
# Cron, daily: document expiry reminders, document and receiver-data retention, trust scores.
# One failing job does not stop the others.
APP_ROOT="$HOME/darb-app"
cd "$APP_ROOT" || exit 1
# shellcheck disable=SC1090
source "$HOME/nodevenv/darb-app/22/bin/activate"
for job in checkDriverDocumentExpiry purgeDriverDocuments purgePassengerParcelReceivers recomputeDriverTrust; do
  echo "$(date -Is) $job"
  node ops/run.mjs node "dist/scripts/$job.js" || echo "$(date -Is) $job failed"
done
