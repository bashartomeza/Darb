#!/bin/bash
# Cron, every 5 minutes: Passenger stops an idle Node app, which would also stop the
# API's background workers (order expiry, dispatch). A request keeps it running.
curl -fsS --max-time 20 "https://darb.aynur.ps/api/v1/health/live" >/dev/null
