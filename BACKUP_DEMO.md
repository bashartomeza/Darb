# Darb Backup Demo

Use this only when a live surface cannot recover quickly. Keep the same eight-minute story and state clearly that the images were captured from the real M5A browser and Android emulator rehearsal.

## Ordered screenshot walkthrough

1. **Arabic admin and corridor** — [`docs/demo/screenshots/admin-dashboard-ar.png`](docs/demo/screenshots/admin-dashboard-ar.png). Introduce Darb and the locked Hebron-to-Bethlehem corridor.
2. **Passenger explainable match** — [`docs/demo/screenshots/mobile-passenger-match-ar.png`](docs/demo/screenshots/mobile-passenger-match-ar.png). Point to the selected route, `0.9317` score, breakdown, and Arabic explanation.
3. **Merchant batch** — [`docs/demo/screenshots/mobile-merchant-order-batch-ar.png`](docs/demo/screenshots/mobile-merchant-order-batch-ar.png). Show five parcels, persisted batch, and `86.12 km` estimated saving.
4. **Driver combined inbox** — [`docs/demo/screenshots/mobile-driver-inbox-ar.png`](docs/demo/screenshots/mobile-driver-inbox-ar.png). Show one passenger plus five parcels on the selected driver's own route.
5. **Driver trip and tracking** — [`docs/demo/screenshots/mobile-driver-trip-ar.png`](docs/demo/screenshots/mobile-driver-trip-ar.png), then [`mobile-driver-trip-completed-ar.png`](docs/demo/screenshots/mobile-driver-trip-completed-ar.png). Explain valid-only lifecycle actions and deterministic location sequence.
6. **Passenger observer** — [`docs/demo/screenshots/mobile-passenger-observer-ar.png`](docs/demo/screenshots/mobile-passenger-observer-ar.png). Show the connected read-only trip.
7. **Merchant observer** — [`docs/demo/screenshots/mobile-merchant-trip-ar.png`](docs/demo/screenshots/mobile-merchant-trip-ar.png). Show order, all parcels, trip, and location synchronized without mutation controls.
8. **Admin comparison close** — [`docs/demo/screenshots/admin-results-ar.png`](docs/demo/screenshots/admin-results-ar.png). Close on 1 versus 6 trips, 21.53 versus 129.19 distance, 43.06 versus 258.38 cost, and Darb as winner.

## Exact recovery actions

### API failure

1. Keep admin and mobile open.
2. In the API terminal, restore the same safe local environment values and run `npm run dev:api`.
3. Confirm `http://localhost:3000/api/v1/health` returns `service: masari-api`.
4. Select admin Refresh and mobile Retry. If state is uncertain, run the protected reset and restart the judge script.

### Admin failure

1. Confirm API health first.
2. Stop only the verified Darb Vite process, then run `npm run dev:admin`.
3. Reopen `http://localhost:5173`, log in as the seeded admin, and continue from the comparison or run a protected reset.

### Emulator failure

1. Cold-boot `Medium_Phone_API_36.0` and wait for `adb devices` to report `device`.
2. Run `adb install -r app-debug.apk` from the release package.
3. Relaunch Darb; if session state is stale, clear app data and use a demo preset.
4. Use the screenshot walkthrough while the emulator boots.

### MySQL failure

1. Start the existing `MySQL80` Windows service and use only the explicitly allow-listed disposable demo database; do not edit records manually or use `masari`.
2. Run `npm run demo:preflight`.
3. When every check passes, run `npm run db:migrate:status`, `npm run demo:smoke`, then the protected reset.

### Port conflict

1. Inspect ownership with `Get-NetTCPConnection -LocalPort 3000,5173 -State Listen` and `Get-CimInstance Win32_Process`.
2. Stop a process only if its command line confirms it is stale Darb API/Vite. Never terminate an unrelated process automatically.
3. Preflight must identify a wrong service as “not the Darb API/admin console.” Keep final URLs on 3000/5173.

### Failed reset

1. Confirm `DEMO_RESET_KEY` exists only in the safe local environment and the exact disposable database is listed in `DEMO_RESET_ALLOWED_DATABASES`; an authenticated Admin alone cannot authorize reset.
2. Confirm API/MySQL health and retry once.
3. Run `npm run demo:smoke`; do not edit MySQL manually.

### Stale application session

1. Admin: log out or clear only the browser's Darb site data, then log in again.
2. Mobile: log out; if navigation remains stale, run `adb shell pm clear ps.darb.mobile`, relaunch, and use the correct role preset.
3. Arabic should be the default after cleared site/app data.

## Decision rule

If recovery is not complete within two minutes, switch to this walkthrough and continue speaking. Do not delay the comparison and closing sections.
