# Feature walkthrough: notifications, incidents, reports, approvals

An optional companion to `JUDGE_SCRIPT.md` (which stays the frozen 8-minute story). Use it for Q&A, a longer slot, or your own pre-demo check. Everything here runs on the disposable `masari_demo` database. Never use the real `masari` database.

## Before you start

1. Follow `README_DEMO_START.md` through step 7 (MySQL, API, Admin, emulator).
2. `npm run demo:smoke` then `npm run demo:features`: both must print `"ok":true`.
3. For the approval screens, after a protected reset run `npm run demo:seed-approvals` (adds three labelled demo accounts) and, to rehearse without clicking, `npm run demo:approvals`. **That smoke consumes the seeded accounts** (it approves them), so re-run the seed before a manual walkthrough. A protected reset removes them.

Seeded accounts (passwords are your local `DEMO_*_PASSWORD` values):

| Role | Sign-in email | Phone | Notes |
| --- | --- | --- |
| Passenger | demo.passenger@masari.app | +970590000001 | has the seeded request |
| Driver | demo.driver@masari.app / demo.driver2@masari.app | +970590000002 / +970590000003 | route owners |
| Merchant | demo.merchant@masari.app | +970590000004 | has the five-parcel order |
| Admin | demo.admin@masari.app | +970590000005 | Admin console |
| Pending merchant | demo.pending.merchant@masari.app | +970590000006 | after `demo:seed-approvals` |
| Rejected driver | demo.rejected.driver@masari.app | +970590000007 | after `demo:seed-approvals` |
| Pending driver | demo.pending.driver@masari.app | +970590000008 | after `demo:seed-approvals` |

## 1. In-app notifications (≈2 min)

1. As the Admin, run the matching step from the main story (or have it pre-run): **Driver** now has a bell badge "1" → open it → "New match offer".
2. Driver accepts the match. Switch to **Passenger** and **Merchant**: each bell shows "Your request was accepted"; the Notifications tab shows the same list.
3. Driver advances the trip (pickup → picked up → in transit). Passenger and Merchant each get a "Trip update" entry per status (within about 10 seconds; the inbox polls).
4. Tap an entry: its dot disappears and the badge drops. "Mark all as read" clears the rest.

Say: "There is no push service; the app polls while the inbox or bell is on screen." Do not say push, SMS or email.

## 2. Reporting a problem (≈1.5 min)

1. As **Passenger**, open the active trip → **Report a problem** → pick *Delay*, type a sentence → **Send report**. The sheet states this is not an emergency service.
2. In the **Admin** console → *Incidents & safety*: the report is listed as New, and the Overview "Incidents" card shows 1.
3. Open it → **Start review** (add a note) → **Mark resolved**. Resolved is final.
4. Back on the Passenger phone: two new inbox entries ("under review", "resolved"). The Passenger never sees the Admin note.

Say: "A follow-up queue for recorded reports", never "emergency response".

## 3. Reports and export (≈1 min)

Admin console → *Reports*: counts by status for requests, orders (with parcels), trips and matches, driver totals, and a date range. Download the three CSVs; open one in Excel (Arabic reads correctly). On the Merchant phone, the *Reports* tab shows the merchant's own orders, parcels and deliveries by status.

Say: "Real counts from stored records. No PDF, no cost or earnings figures, because the system has no pricing data."

## 4. Merchant approval and driver re-review (≈2 min, needs the seed)

1. Admin → *Users* → filter *Pending*. **Demo Pending Merchant** shows *Approve merchant / Reject merchant*. Approve → account becomes active (they can now sign in on the phone). Rejecting needs a reason and disables the account.
2. Admin → *Drivers* → filter *Rejected* → **Demo Rejected Driver** → *Reopen for review* with a reason. The application returns to *Pending* and the *Decision history* keeps the earlier rejection. Approve it (enter a vehicle) to show the full path; history now reads Approved / Reopened / Rejected.

Say: "Reopening is an Admin action. There is no document upload yet, so nothing is labelled verified documents."

## Guardrails

- These features are real but small. Do not claim push notifications, emergency response, PDF/Excel reports, document verification or live tracking.
- If a step stalls, stop live changes and move on; run `npm run demo:features` afterwards to confirm the stack is healthy.
