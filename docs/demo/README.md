# M5A visual evidence

These screenshots were captured from the real local React/Vite admin console and the Android 16/API 36 emulator during M5A. They document the final Arabic RTL and English LTR states, not mocked screens.

- `admin-*`: Arabic login, Arabic completed dashboard/results, and English dashboard/comparison.
- `mobile-passenger-*`: Arabic request/match/observer/trip, English dashboard, and controlled API-outage retry state.
- `mobile-driver-*`: Arabic own-route inbox/match/lifecycle/completion and English dashboard.
- `mobile-merchant-*`: Arabic dashboard/order/batch/read-only trip and English trip.

Technical IDs and coordinates are intentionally visible where they demonstrate real API state. No JWT, reset key, password hash, database credential, or unauthorized phone number is shown.

## Where the data is saved

`scripts/test-env/start.ps1` runs the API on the permanent MySQL database `darb`. Everything created in the apps is stored there and is still there after a refresh, an app restart or a server restart. Before the API starts, the script applies any pending migrations (log: `.staging-data/test-env/migrate.log`). The demo reset always refuses `darb` (`apps/api/src/lib/demoResetSafety.ts`), and `start.ps1` lists no database as resettable in this mode.

For scripted checks that wipe data (`run-checks.mjs`, `reset-data.ps1`), start with `start.ps1 -Disposable`, which uses the separate `darb_demo` database.

## Sending the verification emails for real (optional)

By default the demo only writes the normal-user six-digit email code to `.staging-data/test-env/email-codes.txt`. To also send it from `basharto30@gmail.com`:

1. In that Google account turn on 2-step verification, then create an App Password (Google Account → Security → App passwords). It is 16 letters.
2. In your own terminal run `pwsh -NoProfile -File scripts/test-env/set-mail-password.ps1` and paste it at the hidden prompt. It is stored in Windows Credential Manager, never in a file or the repo.
3. Restart: `stop.ps1` then `start.ps1`. The start message says "real emails are sent from ...".

The file is still written, and a failed send shows in `.staging-data/test-env/api.err.log` without blocking sign-up. Darb sends no SMS, so the demo mirrors production: a phone code is emailed to the address the app collected (the invitation's contact email, the open sign-up email, or the account's own email for the phone step), using the same `phone_code` message; the code is always in `otp.txt` too. Seeded invitations use `DEMO_CODE_INBOX` as their contact email when it is set. The fixed QA numbers `+97059000200x` and `+97059000300x`, and `@example.com` addresses, are not emailed, because the scripted checks read their codes from the file. Remove the password any time with `set-mail-password.ps1 -Remove`.
