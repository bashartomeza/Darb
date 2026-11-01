# Card 6 route-management QA

This runbook is only for disposable local QA. Every fixture command requires `--confirm-disposable` and accepts only a MySQL URL whose host is exactly `localhost` or `127.0.0.1`, whose database path is exactly `darb_routes_qa`, and which has no query string or fragment. Never run these commands against `darb`.

## Environment boundary

- Database: `darb_routes_qa` only
- API: `http://localhost:3100`
- Admin: `http://localhost:5174`
- API route management: enabled process-locally
- Admin route management: enabled process-locally
- Maps: disabled
- Route provider: disabled
- Demo features and demo reset: disabled

Start from a securely loaded local `DATABASE_URL` without printing it, then change only its parsed database path in the current PowerShell process:

```powershell
$qaDatabaseUrl = [System.UriBuilder]$env:DATABASE_URL
$qaDatabaseUrl.Path = 'darb_routes_qa'
$qaDatabaseUrl.Query = ''
$qaDatabaseUrl.Fragment = ''
$env:DATABASE_URL = $qaDatabaseUrl.Uri.AbsoluteUri
$env:ROUTE_QA_ADMIN_PASSWORD = Read-Host 'Disposable QA admin password (12+ characters)' -MaskInput
```

The QA administrator password has no default and is hashed only after the database guard passes. Never paste the password into this file, a command, or QA evidence. Prepare once, then verify. Preparation refuses to overwrite an existing `qa-card6-` fixture set. `verify` performs reads only and leaves the fixtures intact.

```powershell
npm run qa:routes -- prepare --confirm-disposable
npm run qa:routes -- verify --confirm-disposable
```

In an API terminal, retain the guarded process-local `DATABASE_URL` and run:

```powershell
$env:APP_ENV = 'local'
$env:PORT = '3100'
$env:CORS_ORIGINS = 'http://localhost:5174'
$env:ENABLE_DEMO_FEATURES = 'false'
$env:ROUTE_MANAGEMENT_ENABLED = 'true'
$env:MAPS_ENABLED = 'false'
$env:ROUTE_PROVIDER = 'disabled'
npm run dev:api
```

In a separate Admin terminal, run:

```powershell
$env:VITE_APP_ENV = 'local'
$env:VITE_ENABLE_DEMO_FEATURES = 'false'
$env:VITE_API_BASE_URL = 'http://localhost:3100'
$env:VITE_ROUTE_MANAGEMENT_ENABLED = 'true'
npm run dev -w @darb/admin -- --port 5174
```

## Fixture identities

All route and stop keys are synthetic and use the fixed `qa-card6-` prefix.

| Scenario | Fixed identity | Expected state |
| --- | --- | --- |
| A | `qa-card6-a-active-stop` | Active stop visible in the stop catalog |
| B | `qa-card6-b-retired-stop` | Retired stop visible with the retired filter |
| C | `qa-card6-c-empty-route` | Retired route with no versions and no current version |
| D | `qa-card6-d-draft-route` | Valid two-stop draft, ready for editing |
| E | `qa-card6-e-invalid-route` | Draft with a missing Arabic name and no stops; publication must remain blocked |
| F | `qa-card6-f-current-route` | Published current version with valid passenger movement |
| G | `qa-card6-g-paused-route` | Paused current version |
| H | `qa-card6-f-current-route`, version 1 | Retired historical version |
| I | `qa-card6-f-current-route`, version 2 | Published parcel-compatible current version |
| J | `qa-card6-f-current-route` | Three-version history: retired, published, and draft |
| K | `qa-card6-f-current-route`, version 3 | Cloned draft with three ordered stops |
| L | `qa-card6-l-retired-route` | Retired route with no current version |

Supporting active stops use `qa-card6-shared-middle-stop` and `qa-card6-shared-destination-stop`. The service-region and route-group keys also use the same fixed prefix.

## Manual checklist

Authenticate with the synthetic QA administrator and the locally supplied password; do not record the login identifier or password in QA evidence.

Before making any mutation, run the guarded read-only verifier and confirm all 12 A-L fixture scenarios pass exactly. This exact fixture check belongs before human mutations. Human edits intentionally change fixture state, so exact verification is expected to differ afterward until an operator performs guarded cleanup and prepare again.

1. At `http://localhost:5174/#/routes`, confirm the directory appears first with one Create route action, compact search/status/direction/service-region filters, bounded pagination, textual route/current-version statuses, and Open on each result. Search for `qa-card6-`, exercise each filter, clear the filters, and open scenarios C, D, and F from their directory results. Any unexpected status value must render the localized generic status label rather than exposing a raw enum value.
2. Open Create route. Confirm the focused dialog contains only route key, direction group, service region, and direction; Cancel, Escape, and the close button return focus without creating a route. Submit whitespace-only required values and confirm inline validation remains inside the dialog. Create a disposable synthetic route only if the fixture set is not being preserved.
3. In Overview, confirm separate Route identity, Current version summary, Publish readiness, Lifecycle, and small Map status sections. Scenario E must show textual readiness failures and keep Publish unavailable. Open Route actions for draft, published, paused, and retired examples; confirm only state-valid actions appear and destructive/reasoned actions use the confirmation dialog.
4. In Versions, confirm scenario J shows bounded newest-first history and a current marker. Select multiple versions and verify only one detail workspace is shown. On draft K, enter Edit draft, change a field, Cancel, and confirm the authoritative value returns. For an existing UTC activation instant, confirm the input shows the equivalent local wall-clock time and that saving and reopening does not shift the instant. Confirm published, paused, and retired versions remain immutable with no edit form.
5. In Stops, open Add existing stop and confirm already-selected stops are absent. Open Create new stop and confirm the focused form contains only stop key, region, bilingual names, latitude, and longitude with manual-coordinate guidance. Open Edit for an eligible active unused stop and confirm its key is read-only. Clear either coordinate and try out-of-range values; confirm a localized inline coordinate error appears, no update request is sent, and the field is not coerced to zero. Correct both coordinates and confirm the inline error clears. Confirm valid zero remains a numeric zero when submitted, then restore the fixture value. Cancel each dialog and verify focus returns to its trigger. Open retirement for an active stop and confirm the reason form itself shows the localized audit guidance; submitting one valid reason must send exactly one request without a second browser confirmation prompt, while Cancel sends none.
6. On a draft with at least two memberships, use the labeled Move up and Move down buttons from the keyboard. Confirm boundary controls disable appropriately, the visual order and sequence stay contiguous, and no drag-and-drop interaction is required. Toggle a permission, remove/add a stop as appropriate, then Save order and confirm the authoritative result reloads.
7. Exercise ordinary rejected create, draft-save, stop create/edit/order, publish, and lifecycle attempts as available. Confirm each localized error stays with its dialog, Versions editor, Stops list, readiness/lifecycle area, or action flow; no mutation error should replace the directory/detail load surface or expose an internal API message. Directory/catalog and route-detail load failures must use one sanitized page-level notice. After retiring a disposable route, confirm the refreshed directory shows one success notice and no stale workspace feedback.
8. For a stale `409`, use two Admin tabs: keep a draft editor, Stops tab, or current-version lifecycle dialog open in one tab; mutate the same route in the other; then submit the stale action. Confirm there is no success message, exactly one authoritative route reload occurs in Network, the same route and logical tab remain open, the selected version is reconciled, and localized conflict guidance appears beside the affected flow. If that authoritative reload is made to fail, confirm only the affected Stops or Lifecycle area reports the reload failure and no duplicate page-wide error appears.
9. Switch between Arabic and English. Arabic must use RTL page/dialog copy while route keys, IDs, coordinates, and English values remain LTR-isolated. English must use LTR copy. In the workspace tabs, confirm Left/Right arrows follow the visual direction in each locale while Home/End still select the first/last tab. Confirm route, version, and stop statuses remain readable text and are not conveyed by color alone.
10. Repeat the directory, Overview, Versions, Stops, action-menu, and dialog checks at desktop width and approximately 560px. At 560px, directory and stop entries must reflow as one-column cards, tabs may scroll horizontally without forcing the page to scroll, dialog bodies must scroll vertically, and all primary, move, remove, and confirmation controls must remain visible without a table dependency.
11. Confirm Map status remains a small honest unavailable state in the workspace. No provider, map lookup, GPS, geocoding, snapped-road, or verified-location claim should appear.
12. Keep DevTools Console and Network open throughout. Confirm no Card 6 warnings or errors, duplicate mutation requests, unbounded history/catalog requests, raw internal messages, credentials, provider details, geometry payloads, or demo-reset headers appear.

Do not expect the exact A-L verifier to remain green after the mutation steps above. To restore the canonical 12-scenario fixture set, finish the QA session, run the guarded cleanup command below, run guarded prepare again, and then rerun the read-only verifier. Do not clean up while the current fixture set is being preserved for handoff.

## Cleanup

Cleanup deletes only the exact QA actor and rows reached from route/stop roots whose keys start with `qa-card6-`. It clears current-version pointers and removes memberships, audit/idempotency rows, versions, routes, stops, and the synthetic actor in dependency order. It does not call demo reset and does not drop the database.

Run only when human QA is finished:

```powershell
npm run qa:routes -- cleanup --confirm-disposable
```
