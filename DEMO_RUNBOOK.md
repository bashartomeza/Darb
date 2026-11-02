# Darb MySQL Demo Runbook

This runbook operates the approved Darb judge story without source-code knowledge. The demo is Arabic-first and uses only the locked Hebron / PPU / Bab Al-Zawiya to Bethlehem corridor.

## 1. Required software

- Node.js 22.17.1 or compatible Node 22, npm 10.9.2 or newer.
- MySQL 8.0.46 or a Prisma-supported compatible MySQL 8 server, reachable on local port 3306 with a disposable `darb_demo` database. The real/pilot `darb` database must never be used for this runbook.
- Flutter 3.44.6 stable and Dart 3.12.2.
- Android SDK 36, `adb`, Java 21, and AVD `Medium_Phone_API_36.0`.
- A Chromium browser for the React admin console.

Do not run `npm audit fix --force`.

## 2. Environment variables

Open a PowerShell terminal at the repository root and set local values. The values below are placeholders, not real secrets:

```powershell
$env:DATABASE_URL = "mysql://<user>:<password>@localhost:3306/darb_demo"
$env:DEMO_RESET_ALLOWED_DATABASES = "darb_demo"
$env:APP_ENV = "demo"
$env:JWT_SECRET = "<at-least-32-random-characters>"
$env:DEMO_RESET_KEY = "<local-demo-reset-key>"
$env:DEMO_PASSENGER_PASSWORD = "<local-demo-passenger-password>"
$env:DEMO_DRIVER_PASSWORD = "<local-demo-driver-password>"
$env:DEMO_MERCHANT_PASSWORD = "<local-demo-merchant-password>"
$env:DEMO_ADMIN_PASSWORD = "<local-demo-admin-password>"
$env:CORS_ORIGINS = "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175"
$env:PORT = "3000"
$env:VITE_API_BASE_URL = "http://localhost:3000"
$env:VITE_APP_ENV = "demo"
$env:VITE_ENABLE_DEMO_FEATURES = "true"
$env:VITE_DEMO_ADMIN_PHONE = "+970590000005"
$env:VITE_DEMO_ADMIN_PASSWORD = $env:DEMO_ADMIN_PASSWORD
$env:VITE_DEMO_RESET_KEY = $env:DEMO_RESET_KEY
```

Use the same safe local environment in every terminal that starts or validates the demo. Never place real values in Git, screenshots, or presenter notes.

## 3. Exact startup order

1. Start MySQL and confirm port 3306 is listening. Provision the disposable `darb_demo` database with `utf8mb4`; never point the rehearsal at `darb`.
2. From the repository root, run `npm install`, `npm run prisma:validate`, `npm run prisma:generate`, `npm run db:migrate`, and `npm run db:migrate:status`.
3. In terminal A, set the API environment variables above and run `npm run dev:api`.
4. Confirm `http://localhost:3000/api/v1/health` returns `{"ok":true,"service":"darb-api"}`.
5. In terminal B, set `VITE_API_BASE_URL=http://localhost:3000` and run `npm run dev:admin`.
6. Start `Medium_Phone_API_36.0` and wait until `adb devices` reports `emulator-5554` in state `device`.
7. Install the final APK with `adb install -r apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`.
8. Run `npm run demo:preflight` and require every check to pass.
9. Run `npm run demo:smoke`; a JSON line with `"ok":true` is the ready signal.
10. Open the admin URL and launch Darb on the emulator.

Do not terminate a process occupying a required port until its ownership is understood.

## 4. API URL and port

- Host API: `http://localhost:3000`
- Health: `http://localhost:3000/api/v1/health`
- Android emulator API: `http://10.0.2.2:3000`
- Smoke default: `http://localhost:3000`

The debug APK must be built with:

```powershell
Set-Location apps/mobile
flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

## 5. Admin URL

The preferred Vite URL is `http://localhost:5173`. Ports 5174 and 5175 are also supported by API CORS if Vite selects one because the preferred port is occupied. Read the URL printed by Vite and use that exact URL.

## 6. Emulator

- AVD name: `Medium_Phone_API_36.0`
- Expected device: `emulator-5554`
- Platform: Android 16 / API 36

Check readiness with `adb devices`. If the emulator is offline, cold boot the AVD and rerun the preflight rather than changing the APK URL.

## 7. APK path

`apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`

This APK embeds `http://10.0.2.2:3000`, which is Android Emulator's alias for the host API on port 3000.

## 8. Demo credentials

These are intentionally seeded demo-only accounts:

| Role | Phone | Password | Surface |
| --- | --- | --- | --- |
| Passenger | `+970590000001` | local `DEMO_PASSENGER_PASSWORD` value | Flutter |
| Selected driver | `+970590000002` | local `DEMO_DRIVER_PASSWORD` value | Flutter |
| Alternate driver | `+970590000003` | local `DEMO_DRIVER_PASSWORD` value | API visibility proof |
| Merchant | `+970590000004` | local `DEMO_MERCHANT_PASSWORD` value | Flutter |
| Admin | `+970590000005` | local `DEMO_ADMIN_PASSWORD` value | React admin |

The mobile login screen includes passenger, selected-driver, and merchant presets. The reset key is not a demo account credential and must never be displayed on an unauthorized role screen.

## 9. Reset procedure

Preferred presenter reset:

1. Log in to the admin console.
2. Enter the local reset key only in the reset panel if required.
3. Select **Reset demo** / **إعادة ضبط العرض** once.
4. Wait for confirmation, then refresh dashboard data.

Command-line fallback:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:3000/api/v1/demo/reset `
  -Headers @{ "x-demo-reset-key" = $env:DEMO_RESET_KEY }
```

A clean reset restores 5 users, 2 driver profiles/routes, 1 passenger request, 1 merchant order, 5 parcels, and 3 comparison scenarios; it leaves 0 matches, trips, locations, batches, and comparison runs. A repeated reset must produce the same counts and no duplicates.

## 10. Primary judge script with timing

| Time | Presenter story | Expected proof |
| --- | --- | --- |
| 0:00–0:45 | Explain Palestine's fragmented passenger/parcel trips and the locked corridor. | Arabic-first Darb identity and corridor are visible. |
| 0:45–1:30 | Show the passenger request and run matching. | Compatible route, 93.17% deterministic score, breakdown, and explanation. |
| 1:30–2:30 | Show the merchant's five parcels and create the batch. | Persisted five-parcel batch and 86.12 km estimated saving. |
| 2:30–3:30 | Run the combined match or use **Run Full Demo Sequence** for automation. | One match connects passenger, merchant order/batch, and selected route. |
| 3:30–4:30 | Open the selected driver's inbox and accept. | One combined trip; alternate driver has no match. |
| 4:30–5:30 | Advance valid statuses and simulate multiple points. | Only the next valid action appears; location sequence increases. |
| 5:30–6:30 | Refresh passenger and merchant observers. | Both see the same trip/location; merchant order, parcels, and batch follow status. |
| 6:30–7:30 | Show the admin comparison. | Darb uses 1 trip versus 6, 21.53 km versus 129.19 km, and 43.06 versus 258.38 estimated cost. |
| 7:30–8:00 | Close on shared capacity, fewer trips, and explainable matching. | Winner is Darb; no AI, live GPS, or maps are claimed. |

## 11. Exact role actions and expected results

### Admin

1. Open the console: Arabic and RTL are the default.
2. Log in as admin: deterministic overview data appears.
3. Reset: counts return to the clean values in section 9.
4. Select **Run Full Demo Sequence**: every localized progress step completes or the sequence stops with a visible error.
5. Inspect matching, batch, trip, tracking, and comparison cards: no raw JSON is shown.
6. Switch to English and reload: English/LTR persists under `darb_locale`; switch back to Arabic for the judge story.

### Passenger

1. Use the passenger preset and sign in: `/passenger` opens in Arabic RTL.
2. Open the seeded request or create a locked-corridor request: detail shows pickup, Bethlehem destination, time, and count.
3. Run matching: selected route, score, five scoring components, and Arabic explanation appear.
4. After driver acceptance, refresh and open passenger trip: current status and latest simulated point match the driver's trip.
5. Confirm there are no driver accept/reject, status, or simulation controls.

### Merchant

1. Use the merchant preset and sign in: `/merchant` opens in Arabic RTL.
2. Open the seeded five-parcel order: pickup/destination coordinates are fixed and not editable.
3. Create the parcel batch: one persisted batch shows five parcels, Arabic explanation, and 86.12 km saving.
4. Run matching: merchant-owned safe detail appears with no accept/reject controls.
5. After driver progress, open the connected trip: order, every parcel, batch, trip status, and latest sequence agree; the view is read-only.

### Driver

1. Use the selected-driver preset and sign in: active locked forward route appears.
2. Open inbox: only own-route matches appear; the intended combined card shows 1 passenger and 5 parcels.
3. Open detail and accept: exactly one trip is created and duplicate acceptance is a controlled conflict.
4. Advance `accepted -> pickup_started -> picked_up -> in_transit -> delivered -> completed` using only the displayed next action.
5. During transit, simulate at least two points: latest sequence advances from 0 to 1 and observers see the same location.
6. Complete the trip: the next-status action disappears and all timeline stages are complete.

## 12. Expected cross-role state

| Driver trip | Passenger request | Merchant order | Parcels | Batch | Route |
| --- | --- | --- | --- | --- | --- |
| Accepted | Accepted | Assigned | Assigned | Assigned | In trip |
| Picked up | Picked up | Picked up | Picked up | Picked up | In trip |
| In transit | In transit | In transit | In transit | In transit | In trip |
| Delivered | Delivered | Delivered | Delivered | Delivered | In trip |
| Completed | Delivered | Completed | Delivered | Delivered | Completed |

Passenger and merchant observers can read only their connected trip. The selected driver can mutate only the valid lifecycle and tracking. The alternate driver cannot list or open the selected driver's match. Admin can observe all demo data.

## 13. Comparison talking points

- Darb combines one passenger request and one five-parcel batch on an already-compatible route.
- Deterministic rehearsal result: 1 Darb trip versus 6 nearest-driver trips.
- Estimated distance: 21.53 km versus 129.19 km.
- Estimated cost: 43.06 versus 258.38 demo cost units.
- Batching avoids five independent parcel dispatches and reports 86.12 km estimated distance saved.
- Driver utilization is higher because both passenger seats and parcel capacity contribute to one route.
- The scoring breakdown is explainable: corridor overlap, time compatibility, seat capacity, parcel capacity, and pickup proximity.
- These are deterministic hackathon comparison metrics, not live routing or production prices.

## 14. Failure recovery

- **API health fails:** keep the browser/app open, restart terminal A with the same environment values, confirm health, then select Retry/Refresh. The secure mobile session remains safe.
- **Admin network error:** restart API, then use the translated refresh action. Do not reset unless state is uncertain.
- **Invalid login:** use the seeded credential exactly; no token is stored for a failed login.
- **409 duplicate batch or acceptance:** refresh authoritative data; never repeat the mutation blindly. The existing batch/trip is retained.
- **Invalid trip jump:** refresh the driver trip and use only the displayed next action.
- **No compatible route:** reset the demo to restore the verified forward route; do not edit MySQL manually.
- **Emulator app closes:** relaunch it. JWT and `darb_locale` restore; active polling restarts once when its screen is reopened.
- **Vite chooses another port:** use the printed 5174/5175 URL; those origins are already in CORS.
- **Any uncertain state:** run the protected reset, then `npm run demo:smoke`, and restart the eight-minute script.

## 15. Backup plan

1. Keep the Arabic admin dashboard open after a successful **Run Full Demo Sequence**; it contains the complete deterministic proof.
2. Keep the final debug APK installed and the API health URL open in a browser tab.
3. If the emulator becomes unavailable, present the admin sequence plus final screenshots under `docs/demo/screenshots/`, while stating that mobile is an Android emulator build.
4. If the manual cross-role sequence runs long, reset and use the admin full-sequence button, then show the driver inbox and observer screens.
5. Never use manual database edits, reveal reset/JWT/database secrets, or claim excluded features.

## 16. Final shutdown and reset

1. Run the protected reset once to leave deterministic clean data.
2. Confirm `npm run demo:smoke` if the environment will be handed to another presenter; it ends with a clean reset after its recovery check.
3. Log out of mobile roles and close the app.
4. Stop the Vite and API terminals with Ctrl+C.
5. Stop the emulator normally, then MySQL if it is not shared.
6. Clear local terminal environment variables if the machine is shared:

```powershell
Remove-Item Env:DATABASE_URL,Env:JWT_SECRET,Env:DEMO_RESET_KEY -ErrorAction SilentlyContinue
```

The next presenter starts again at section 3; no database correction should be necessary.
