# Canonical offer expiry and reassignment

Expiry is an explicit bounded internal command, not a public route or scheduler:

```powershell
npm run build:api
npm run canonical:match -w @darb/api -- --expire --limit=25
```

The command is available only in local, test, or demo with all canonical gates enabled. It scans at most 100 due offers, processes each in a separate transaction, and uses the canonical lock order. Two workers safely serialize on the dispatch/offer rows.

An expired offer restores held capacity once, marks the reservation `expired` with `hold_expired`, marks the offer terminal, clears the active link, and returns demand to pending. The fifth terminal attempt makes dispatch unavailable. Rematching is a separate bounded command; there is no recursive retry or production timer.

Rows failing three expiry attempts are quarantined. Results and logs contain aggregate counts and safe IDs only.
