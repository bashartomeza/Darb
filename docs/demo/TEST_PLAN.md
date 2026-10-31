# Masari test plan (Admin site + Android app)

Everything runs on a disposable demo database. Nothing here touches real data, a real SMS provider or the checkpoint provider.

**How to report back:** for each ID write `PASS`, `FAIL` or `SKIP`, and for a FAIL one line saying what you saw (a screenshot helps). Sending only the failures is fine, as long as you say the rest passed.

## 0. Setup

| What | Where |
| --- | --- |
| Admin site | http://localhost:5173 |
| API | http://localhost:3000 (the emulator reaches it as http://10.0.2.2:3000) |
| Admin sign-in | email `demo.admin@masari.app`, password `DEMO_ADMIN_PASSWORD` from `apps/api/.env` |
| Demo app sign-ins (email + password from `apps/api/.env`) | passenger `demo.passenger@masari.app`, driver `demo.driver@masari.app` (and `demo.driver2@masari.app`), merchant `demo.merchant@masari.app` — passwords are `DEMO_PASSENGER_PASSWORD`, `DEMO_DRIVER_PASSWORD`, `DEMO_MERCHANT_PASSWORD` |
| Sign-up invitation codes | `.staging-data/test-env/invitations.txt` (passenger +970590002001, driver +970590002002, merchant +970590002003) |
| Email verification code (normal user sign-up) | the newest line for that email in `.staging-data/test-env/email-codes.txt` (no real email is sent; type the six-digit code into the app) |
| One-time codes (Masari sends no SMS; they go by email) | the newest line of `.staging-data/test-env/otp.txt`; with the demo mail account set up the code is also emailed to the address entered in the app (not for the fixed QA numbers +97059000200x and +97059000300x or `@example.com` addresses) |
| Sample files on the emulator (Downloads) | `licence.jpg` (valid), `vehicle-registration.pdf` (valid), `not-really-an-image.jpg` (text pretending to be a photo) |
| Pending / rejected demo accounts | Demo Pending Merchant, Demo Pending Driver, Demo Rejected Driver (already seeded) |

**Maps need internet.** They load tiles from OpenStreetMap. If a map on the phone is a grey box, the emulator has lost its internet: close it and start it again with `emulator -avd Medium_Phone_API_36.0 -no-snapshot-load -dns-server 8.8.8.8,1.1.1.1`.

Start everything: `pwsh -NoProfile -File scripts/test-env/start.ps1`. Stop: `scripts/test-env/stop.ps1`. Back to a clean starting state at any time: `scripts/test-env/reset-data.ps1` (it makes new invitation codes; the sign-up and approval tests use things up, so reset before repeating them).

## A. Admin site

| ID | Do | Expect |
| --- | --- | --- |
| A01 | Open the site, sign in as the Admin | Overview opens; your name shows in the header |
| A02 | Sign in with a wrong password | A clear error; you stay on the sign-in screen |
| A03 | Switch Arabic ⇄ English | Whole page flips language and direction (right-to-left in Arabic); nothing overlaps or is cut off |
| A04 | Open every item in the left menu, one by one | Each page opens without a crash. Pages that are not built say so plainly (no fake numbers) |
| A05 | Overview cards | Active drivers, Pending approvals (1 right after a reset: the pending demo driver) and Incidents show numbers, not errors |
| A06 | Users: search by name, filter by role and status | Lists narrow correctly; the pending/rejected demo accounts are findable |
| A07 | Users: open a user | Detail shows role, status and no passwords or tokens |
| A08 | Users: suspend a demo passenger with a reason, then reactivate | Status changes and shows in the list; the reason is required for suspend |
| A09 | Merchant approval: Users → filter Pending → Demo Pending Merchant → Approve | Account becomes active. (Then sign that merchant in on the phone: it works) |
| A10 | Reject a different pending merchant (use reset first if none left) with no reason, then with a reason | Without a reason it refuses; with one the account is disabled |
| A11 | Drivers & verification → Pending → Demo Pending Driver | Review panel opens with profile, vehicle section and a decision area |
| A12 | In that review, record evidence: choose "Driver licence", add a short note, Record sighting | It appears in the list with your name and time; the status text changes from "not collected" |
| A13 | Approve the pending driver (enter a vehicle type, seats, parcel capacity) | Status Approved; history shows the decision |
| A14 | Drivers → Rejected → Demo Rejected Driver → Reopen for review (give a reason) | It returns to Pending; history keeps the earlier rejection and shows "Reopened" |
| A15 | Reject a pending driver without a reason | It refuses; with a reason it works |
| A16 | Incidents (after a phone report, see E07) | The report is listed as New; Start review with a note, then Mark resolved; Resolved cannot be changed back |
| A17 | Reports page: change dates, download all three CSV files | Numbers match the lists; files open (Arabic text readable in Excel) |
| A18 | Matching, Shipments & batching, Trips & tracking, Comparison pages | They show the seeded demo data (the combined passenger+parcel trip, the 1-trip-vs-6 comparison) without errors |
| A19 | Sign out, then press the browser Back button | You are not let back into the Admin pages |
| A20 | Reports page → Success metrics (or `GET /api/v1/admin/success-metrics`, and `/export` for the CSV): open it as the Admin, then try it as a passenger and without signing in | Admin: figures for the last 30 days with the previous period for comparison, a CSV download; passenger: refused (403); not signed in: 401; a start date after the end date, or a range over a year, is refused |
| A21 | Matching / Batching page → Simulated comparison tab (or `GET /api/v1/compare/simulation?seed=7`) | Manual, nearest-driver and Masari results, labelled as simulated; the same seed always gives the same numbers, another seed differs; nothing is written; passengers cannot call it |

## B. Phone: signing in

| ID | Do | Expect |
| --- | --- | --- |
| B01 | Open the app | Sign-in screen, Arabic by default, right-to-left |
| B02 | Switch to English with the globe icon | Everything flips to English, left-to-right; switch back works |
| B03 | Wrong email/password | A clear "incorrect" message, not a crash or a network error |
| B04 | Sign in as the demo passenger | Passenger home opens |
| B05 | Sign out, sign in as the demo driver, then the demo merchant | Each role sees its own home and tabs, and none of the other roles' screens |
| B06 | Close the app completely and reopen it | You are still signed in (or sent to sign-in, but never to a broken screen) |
| B07 | Turn the emulator's internet off (airplane mode) and open a list | A friendly offline/error message with a retry; no crash |

## C. Phone: creating an account (with an invitation, or openly as a driver or shop owner)

Use the codes in `invitations.txt`. After each sign-up, read the code from `otp.txt`.

| ID | Do | Expect |
| --- | --- | --- |
| C01 | Sign-in screen → "New to Masari? Create an account" | A screen asks "How will you use Masari?" with three choices: Normal user, Driver, Shop owner. Normal user opens the email sign-up form; Driver and Shop owner open the invitation-code and phone screen with the role already chosen; Back returns to sign-in |
| C02 | Enter a wrong code | A clear error; you can try again |
| C03 | Choose Shop owner (invitation code and +970590002003), enter the right code (from `otp.txt`), then name, a password of at least 15 characters, tick the three consents, Create account | Account created; the screen says the account is pending and an admin review usually takes up to 24 hours |
| C04 | Repeat for the driver (+970590002002) | The screen says "Application under review" and shows a "Verification documents" card |
| C05 | Driver: Add a document → choose `licence.jpg` (type "Driving licence") | It appears in the list as "Driving licence · 1 KB" |
| C06 | Add `vehicle-registration.pdf` with type "Vehicle registration" | It appears in the list |
| C07 | Add `not-really-an-image.jpg` | Refused with "Only JPEG, PNG or PDF files can be uploaded"; nothing added |
| C08 | Tap the bin on one document | It disappears from the list |
| C09 | Try to add more than 6 documents | After 6 the Add button is disabled or a limit message shows |
| C10 | In the Admin site, open that driver's review | The uploaded documents are listed with a Download button; the downloaded file opens and is the right file |
| C11 | Try to sign in on the phone as the new (pending) driver | You are not let in (account pending), with a clear message |
| C12 | Admin approves that driver (A13), then press Refresh in the app's pending screen | It now says approved and offers sign-in; sign-in works |
| C13 | Admin approves the shop owner from C03 (A09), then sign in on the phone with their phone number and password | Same pending → approved path; the merchant home opens |
| C14 | Use an invitation code twice, or a code with the wrong phone | Refused without revealing why |
| C15 | Sign-in screen → "Check an existing application" with a pending applicant's phone and password | Shows the application status |
| C16 | Shop owner (pending, from C03): Add a document → choose `licence.jpg` (type "Commercial register") | The pending screen shows "Verification documents" asking for the commercial register, national ID and shop photo; the file appears in the list as "Commercial register · 1 KB" |
| C17 | In the Admin site, Users → the pending shop owner → Approve (or Reject) | The shop owner's documents are listed with a Download button before you decide; the downloaded file opens and is the right file |
| C18 | Create account → Normal user → name, an email ending in @example.com, a password of at least 12 characters → Sign up; type the six-digit code from `email-codes.txt`, tick the three documents, Continue; then enter a phone such as +970590003020, Send code, type the code from `otp.txt`, Continue | The passenger home opens; no invitation code and no admin approval were needed |
| C19 | Open registration (the local test environment turns it on). Create account → Driver. Leave the invitation code empty (it says "Invitation code (optional)"), enter a new phone such as +970590004001, Send code, type the code from `otp.txt` | The code screen opens without any invitation code |
| C20 | Enter a wrong code, then the right one; then name, a password of at least 15 characters, tick the three consents, Create account | Account created; the screen says "Upload your documents" (not "Application under review"); the button "Send for review" is disabled and lists what is still needed |
| C21 | Add `licence.jpg` (Driving licence) and `vehicle-registration.pdf` (Vehicle registration) only | "Send for review" stays disabled; "Still needed" names the national ID |
| C22 | In the Admin site, look in Users and the driver approvals queue for that driver | The driver is not in the review queue yet; approving or rejecting is refused (not submitted) |
| C23 | Add a National ID document, then press "Send for review" | The screen changes to "Application under review" and says review usually takes up to 24 hours |
| C24 | In the Admin site open the driver approvals queue | The driver is listed; the three documents have Download buttons and open correctly; Approve works; the phone then signs in |
| C25 | Create account → Shop owner with no invitation code (+970590004002); upload commercial register and national ID only | "Send for review" stays disabled until the shop photo is added; then it submits and the shop owner appears in Users as a pending merchant that can be approved |
| C26 | Open registration, start with a phone number that already has an account, type the code from `otp.txt`, then fill the form | The first screens look exactly like a new number; only at Create account does it say the registration could not be completed |
| C27 | Start sign-up again with the same phone number twice, then use the first code | The older attempt no longer works; only the newest code and screen continue |
| C28 | Request a code for the same phone more than 5 times in a day, or start more than 10 sign-ups from the one phone in an hour | The app shows a "too many attempts" message; no further codes are produced in `otp.txt` |
| C29 | Sign-in screen → "Check an existing application" for the C20 driver before documents are sent | It shows "Upload your documents", not "under review" |
| C30 | Invitation codes still work: repeat C03 or C04 with a code from `invitations.txt` | Created as before; the application is under review at once (no extra "Send for review" step) |
| C31 | Create account → Normal user → name, email ending @example.com, password of 12+ characters → Sign up; read the code from the newest line for that email in `email-codes.txt` and type it | The code is six digits (not a long token) and finishes the sign-up; typing the same code again later does not work |
| C32 | Start another email sign-up and type a wrong six-digit code five times, then the right code | Each wrong code is refused; after the fifth even the right code is refused and no account exists; start again to get a new code |
| C33 | In the six-digit box try 5 digits, 7 digits, letters, or a space in the middle | Refused before it is checked (the Continue button stays disabled or the API answers 400) |
| C34 | Sign-in screen → Forgot password → enter the email; read the code from `email-codes.txt`; enter email + code + a new password. Also try an email that has no account | The screen says the same thing for known and unknown emails and no email is produced for the unknown one; the new password signs in, the old one does not; the same code cannot be used twice |
| C35 | Forgot password: type a wrong six-digit code five times, then the right one | The reset is locked; the right code is refused; ask for a new code |
| C36 | Open registration (as C19): Driver, no invitation code, new phone such as +970590005xxx; wrong then right phone code; name, password, consents | Account created with no invitation; the app says "Upload your documents", not "under review" (API: onboarding status `documents_required`) |
| C37 | Press "Send for review" (API: `POST /onboarding/application/submit`) with no documents, then with only the licence and registration | Refused with 409 `documents_required`, listing the missing documents (3 first, then 1); nothing is submitted |
| C38 | Admin site: look for that driver in the approvals queue and try to approve or reject by API before it was submitted | Not in the queue; approve and reject answer 409 `application_not_submitted`; the driver cannot sign in |
| C39 | Add the national ID, press "Send for review" (twice) | Accepted ("Application under review"); a second press does nothing new; the driver is now in the admin queue with three documents |

## D. The main story (passenger + merchant + driver)

Run after a reset so the seeded data is fresh. Use the demo accounts.

| ID | Do | Expect |
| --- | --- | --- |
| D01 | Passenger: open the seeded request and its match | The request and a match result are shown |
| D02 | Merchant: open the seeded order | Five parcels and their batch are shown |
| D03 | Admin: open the Matching page; if there is no match yet, run matching | One combined passenger+parcel match exists, with a score breakdown |
| D04 | Driver (the selected one): open the inbox | The match is there; the other driver's inbox is empty |
| D05 | Driver: accept the match | Exactly one trip is created |
| D06 | Driver: advance pickup → picked up → in transit (and simulate points) | Only the next valid action is offered each time |
| D07 | Passenger and merchant: open their trip | Both see the same trip and the same latest location; read-only |
| D08 | Passenger and merchant: bell and Notifications tab | A "match accepted" and "trip update" entries; tapping one clears its dot; "Mark all as read" works |
| D09 | Driver: complete the trip | Trip shows completed on all three phones and in the Admin |
| D10 | Tracking wording | Anywhere location appears it is described as simulated, never as live GPS |

## E. Smaller features

| ID | Do | Expect |
| --- | --- | --- |
| E01 | Driver: Earnings/performance tab | Completed-trip counts shown; earnings says it is not tracked (no invented amount) |
| E02 | Same tab, acceptance rate | Under 5 answered offers it says the rate appears after 5; after accepting/rejecting 5 offers it shows a percentage and "x of y" |
| E03 | Driver: reject an offer and accept another (needs fresh offers: reset) | The numbers in E02 move accordingly |
| E04 | Merchant: Reports tab | Orders, parcels and deliveries by status; matches the Admin report for that merchant |
| E05 | Passenger on a trip: Report a problem → Delay → write a sentence → Send | Confirmation; the sheet says it is not an emergency service |
| E06 | Send 11 reports without any being resolved | The 11th is refused with a message about too many open reports |
| E07 | Admin: Incidents | The report from E05 is there (see A16); after you resolve it, the passenger gets two new notifications and does not see your internal note |
| E08 | Driver: go online/offline | The state changes once per tap and survives closing the app |
| E09 | Passenger (route entry switched on): home → Send a parcel → pick a route and stops, size S or M, receiver name and phone, tick the forbidden-items box → Send parcel | Submit stays disabled until everything is filled and the box is ticked; the parcel then appears under My parcels as "Finding a driver"; the receiver's phone is shown masked |
| E10 | Same form: try size L, a phone that is too short, or leave the box unticked | Large is not offered; the others block Send parcel |
| E11 | Passenger: create parcels until you have 3 in flight, then a 4th | The 4th is refused with a message about the maximum number of parcels |
| E12 | Passenger: cancel a parcel that is still "Finding a driver" (confirm the dialog) | It becomes Cancelled and the receiver details are shown as erased; once a driver has been offered or assigned the parcel there is no Cancel button |
| E13 | Admin: Deliveries page, "Passenger parcels" section | The parcel is listed with its tracking state in English and Arabic; no receiver name, phone or note anywhere |
| E14 | Admin → create three stops and a route, publish it (API: `/admin/stops`, `/admin/service-routes`, versions, stops, publish). Needs the route switches (the local test environment turns them on) | The route appears in the public route catalogue (`GET /routes`) |
| E15 | Admin → the route's "Estimated fares" tab (API: `PUT /admin/service-routes/:id/fares`): set seat 15.00, parcel S 7.00, M 9.00 with a reason; then try amount 0, 12.5 agorot, a 2-letter reason, a passenger account, and the same fares again | Saved with your name in the history; 0, fractions and a too-short reason are refused (400), a passenger is refused (403), saving unchanged fares answers 409 `fare_unchanged` |
| E16 | Passenger requests 2 seats on that route (API: `POST /passenger/route-requests`); the Admin then raises the seat fare to 20.00; the passenger repeats the same request key, then makes a new one | The route list and the request show the fare as an estimate paid directly to the driver (2 x 15.00 = 30.00); after the change the first request still says 15.00 (frozen), a new request says 20.00 |
| E17 | Passenger parcel (API: `POST /passenger/parcels` with an `Idempotency-Key`): size S, receiver name and phone, forbidden-items box ticked; send the same key again | Created as "Finding a driver"; the receiver phone is shown masked; the second send returns the same parcel and creates no second one; a different body with the same key is refused (409) |
| E18 | Same call with size L, a 3-digit phone, the box unticked or missing, a drop-off before the pickup, a 1-letter name, or an unknown field | Each is refused with 400 (or a 4xx for the stops); nothing is created |
| E19 | Open that parcel as another passenger, a driver, a shop owner and signed out; then the Admin parcel list (`GET /admin/passenger-parcels`) | Others get 404, 403 or 401; the Admin list shows the parcel but no receiver name, phone or note |
| E20 | Create parcels until 3 are in flight, then a 4th | The 4th is refused with 409 `passenger_parcel_limit_reached` |
| E21 | Cancel a parcel that is still "Finding a driver"; cancel it again; then create a new one | Cancelled, receiver name, phone and note erased; a second cancel is refused (409); the freed slot allows a new parcel |
| E22 | As the sender open the parcel's delivery code (API: `GET /parcel-orders/:id/handover`, `POST .../handover/regenerate`) | The state never shows the code; "Get a new code" returns a six-digit code once; others get 404; an Admin cannot re-issue it (403) |
| E23 | Shop owner → bulk orders (API: `POST /merchant/orders/bulk/preview`): paste a CSV with 5 rows (one has size Q); also try as a passenger | The preview lists the valid orders, the bad row with its row number and an Arabic message, and a batch plan; nothing is created; passengers are refused |
| E24 | Submit the CSV without an Idempotency-Key, then with the bad row and without "skip invalid" | Both are refused (400) and no order is created |
| E25 | Submit the valid rows with an Idempotency-Key, then send exactly the same upload again; then submit with "skip invalid" | First: 3 orders created; the retry creates nothing (all "replayed", the same order numbers, the order list still has 3); skipping the bad row creates the valid ones and reports 1 failed |
| E26 | Preview or submit a CSV with 51 rows; then one with exactly 50 | 51 rows: rejected as a whole with `csv_too_many_rows` and nothing created; 50 rows are accepted by the preview |
| E27 | Passenger assistant with no AI key (Assistant on the passenger home): "from Bab Al-Zawiya to Bethlehem Center tomorrow at 8am with 2 seats", and the same in Arabic | The rule-based fallback fills pickup, destination, time and 2 seats for review; admins and signed-out users cannot use it; an empty message is refused |
| E28 | Ask the assistant for a ride to Nablus (English and Arabic) | A clear reply that the place is not supported yet, listing the supported places as suggestions |
| E29 | Send the assistant something it cannot read; then Admin → Incidents → uncertain assistant requests (API: `GET /admin/ai-uncertain-requests`); resolve it with a note | A clear request is not queued; the unclear one is queued once with its reason and no passenger identity; resolving needs the current revision, a resolved one cannot be resolved again, and the open count drops |
| E30 | Passenger with an accepted trip: step the simulated driver (Simulate step) until it is near the pickup, then open Notifications | Exactly one "your driver is approaching" notification (no coordinates in it), however many steps follow; the shop owner gets none |
| E31 | Driver on an in-transit parcel trip: try Delivered with the normal status button, then confirm with no code, and try to confirm as the passenger or shop owner | The status route refuses (409 `delivery_confirmation_required`), no code is 400, other roles 403; the trip stays in transit |
| E32 | Shop owner: Get a new code for the order (API: `POST /parcel-orders/:id/handover/regenerate`); the driver tries to read or re-issue it | A six-digit code is returned once, attempts remaining 5; the driver gets 404 for both |
| E33 | Driver enters a wrong code five times, then the right code; then the shop owner gets a new code | Wrong codes are refused (422); after five, even the right code is refused (429 `handover_locked`) and the order shows locked; a new code unlocks it |
| E34 | Driver enters the right code; the Admin opens the trip (API: `GET /admin/trips/:id`) | The trip becomes delivered; the Admin sees it confirmed by receiver code and not flagged; the code is shown nowhere; confirming again is refused |
| E35 | Passenger rates the finished trip: before completion, 0 and 6 stars, then 5 stars, then again; drivers and shop owners try to rate or read it | Before completion 409 `trip_not_completed`; 0, 6 and 4.5 are 400; 5 stars saved (201); a second rating 409 `trip_already_rated`; the passenger can see only their own rating; drivers get 403/404 and no driver screen or API shows a star rating |
| E36 | After the trip: driver trust score (Admin → user detail) and `npm run trust:recompute -w @masari/api` against the demo database | A whole number from 0 to 100 with its breakdown and calculation time; the Admin sees the same number; the job reports 0 failed and gives the same score when run again |
| E37 | Second trip: the driver chooses "Receiver unavailable" with no reason, a 9-character reason, a 301-character reason, then a proper reason | The first three are refused (400); the proper one delivers the trip, the Admin trip list and detail show it flagged with the reason, and the sender sees how it was confirmed |
| E38 | Admin approves a new driver with document dates (API: `expiry` on approve): try a licence date in the past, then valid dates | A past date is refused (400 `expiry_date_in_past`); valid dates are saved and the driver appears under "Expiring soon" (within 30 days); a driver cannot read that list |
| E39 | Run the expiry job (`npm run documents:expiry -w @masari/api`) with the licence ending in 5 days, twice | The driver gets one "document expires soon" reminder; the second run adds none; the driver is still approved |
| E40 | Set the licence date to yesterday (database edit on masari_demo) and run the job again; then try to go online | The driver becomes "documents expired", is unverified, gets a notification, and going online is refused with 403 `driver_documents_expired`; a second run restricts nobody twice; the driver still signs in; the Admin sees the driver under "Awaiting driver" |
| E41 | Driver renewal (API: `/driver/document-renewal`): submit with no file, upload a text file, upload a photo, submit | No file: 409; text file: 415; with a photo the application goes to the Admin re-review queue; going online is still refused; passengers cannot use the renewal area |
| E42 | Admin approves the renewal: first without new dates, then with a new licence date | Without new dates it is refused (400); with a new date the driver is approved and verified again at once, the history shows expired and renewal submitted, going online is no longer refused for documents, and the job does not restrict them again |

## F. Things that must NOT work (safety checks)

| ID | Do | Expect |
| --- | --- | --- |
| F01 | Admin site: sign in as a passenger (using a passenger's email and password) | Refused |
| F02 | A pending merchant or driver signs in on the phone | Refused with a clear message |
| F03 | After the Admin rejects a driver with a reason, sign in as that driver | Refused |
| F04 | As a passenger, try to open driver or merchant screens (via the menu only; no URL tricks) | Not reachable |
| F05 | Admin downloads a driver document, then the applicant is approved: can the applicant still upload? | No: uploading is closed once a decision is made |
| F06 | Look through every screen for the words "push notification", "emergency", "live GPS", "payment", "earnings" used as if they work | None claim a feature that is not built |
| F07 | With the open-registration switch off (`OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED=false`, the default everywhere except the local test environment), choose Driver and leave the invitation code empty | The code field is required; sending without one is refused and no code is produced |
| F08 | Call `POST /api/v1/onboarding/application/submit` with a pending driver or shop owner session that is missing a required document (any HTTP client) | 409 `documents_required`, listing what is missing; the application is not submitted |
| F09 | Passenger role without an invitation code, even with the switch on | Refused; passengers always register by email or Google |
| F10 | A submitted driver deletes the only file of a required kind | Refused (documents_required); replacing it by adding a second file first works |

## G. Not in scope (do not report these as bugs)

There is no SMS at all (Masari sends codes by email; the demo reads them from `otp.txt`) and real email delivery (codes come from `email-codes.txt`), push notifications, payments and real money movement (route fares are display-only estimates; earnings amounts are not tracked), live tracking, PDF or Excel exports, maps and the checkpoint feeds (switched off), and anything on a real server (hosting is not set up yet).

## Results

| ID | PASS / FAIL / SKIP | What you saw (for FAIL) |
| --- | --- | --- |
| | | |
