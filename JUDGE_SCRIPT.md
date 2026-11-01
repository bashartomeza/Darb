# Darb Judge Script — 8:00

Use Arabic as the primary language. Keep the admin comparison ready in the browser and the Android emulator beside it. The product is frozen: do not improvise unbuilt features or change data during the presentation.

## Before the clock

- Confirm `npm run demo:preflight` is 22/22 and `npm run demo:smoke` returns `"ok":true` against the explicitly allow-listed disposable demo database.
- Run one protected reset, open `http://localhost:5173`, and leave the mobile app on the Arabic login screen.
- If a live step fails, use the backup instruction in that row once; do not debug in front of judges.

## Exact timeline

| Time | Presenter speech cue | Device/app action | Expected result and judge screen | Key value | Transition | Backup |
| --- | --- | --- | --- | --- | --- | --- |
| 0:00–0:45 | “Separate passenger and parcel trips waste available seats, parcel capacity, distance, cost, and time. Darb starts with one locally relevant corridor: Hebron, PPU, and Bab Al-Zawiya to Bethlehem.” | Show the Arabic admin header and locked corridor. | Judges watch admin: Arabic RTL identity and corridor are visible. | One locked corridor | “Now let us follow one passenger on that corridor.” | Show `admin-login-ar.png`, then `admin-dashboard-ar.png`. |
| 0:45–1:30 | “The passenger makes a structured booking in Arabic. The MVP keeps the corridor locked so the demo is predictable and the request is operational, not free-form.” | On mobile, choose Passenger, open the seeded request, then its match result. | Judges watch mobile: pickup, destination, request state, selected route, and no driver controls. | Arabic-first structured request | “The same corridor also carries local merchant demand.” | Show `mobile-passenger-request-ar.png` and `mobile-passenger-match-ar.png`. |
| 1:30–2:30 | “The merchant has five parcels going toward Bethlehem. Darb groups compatible parcels into one route-aware batch instead of dispatching each separately.” | Switch to Merchant; open the seeded order and batch. | Judges watch mobile: five parcels, persisted batch, explanation, and fixed corridor-compatible destinations. | 5 parcels; 86.12 km estimated saving | “The next question is which existing route can carry both needs.” | Show `mobile-merchant-order-batch-ar.png`. |
| 2:30–3:30 | “Darb creates one combined passenger-and-merchant assignment. The choice is explainable: corridor overlap, pickup proximity, time, confidence, and capacity.” | Show the admin match card or passenger match result and point to the breakdown. | Judges watch score, route, Arabic explanation, and scoring components—not raw JSON. | Score `0.9317` | “That assignment is delivered only to its selected route owner.” | Show `mobile-passenger-match-ar.png` and state that the API rehearsal proves alternate-driver isolation. |
| 3:30–4:30 | “The selected driver sees only matches connected to their route. The alternate driver sees none. Accepting this one card creates exactly one combined trip.” | Switch to Driver, open the combined inbox and match, then accept. | Judges watch mobile: 1 passenger, 5 parcels, own-route match, one created trip. | Selected driver: 1; alternate driver: 0 | “One driver action now advances every connected operational state.” | Show `mobile-driver-inbox-ar.png`; if acceptance was pre-run, open the active trip. |
| 4:30–5:30 | “Only the next valid trip action is offered. Tracking is deterministic simulation for this hackathon—not live GPS—and every point has an increasing sequence.” | Advance to in-transit, simulate points 0–2, then complete if time permits. | Judges watch driver timeline and location progress; invalid action buttons disappear. | Final documented sequence `2` | “The driver owns mutations; the passenger and merchant only observe.” | Show `mobile-driver-trip-ar.png` and `mobile-driver-trip-completed-ar.png`. |
| 5:30–6:30 | “The passenger sees the same trip and latest location. The merchant sees the order, all five parcels, batch, trip, and location move together. Both views are read-only.” | Open passenger trip, then merchant trip. | Judges watch synchronized observer screens with no accept, status, or simulation controls. | One shared trip and location | “The operational story is useful; the comparison shows why it matters.” | Show `mobile-passenger-observer-ar.png` and `mobile-merchant-trip-ar.png`. |
| 6:30–7:30 | “Against our deterministic nearest-driver baseline, Darb uses one trip instead of six. Estimated distance falls from 129.19 to 21.53 and demo cost from 258.38 to 43.06. Darb wins because it uses existing capacity together.” | Return to the Arabic admin comparison table. | Judges watch the comparison, batching benefit, utilization, winner, and completed trip. | Trips 1/6; distance 21.53/129.19; cost 43.06/258.38; winner Darb | “This is the measurable result of sharing one corridor.” | Show `admin-results-ar.png`. |
| 7:30–8:00 | “Darb is locally focused, Arabic-first, capacity-aware, and explainable. Future work could evaluate more corridors and live data, but today we are showing the implemented deterministic MVP—without claiming AI, GPS, maps, or payments.” | Hold on the comparison winner and corridor. | Judges see the proven MVP scope and final value statement. | Shared capacity, fewer trips, transparent choice | “Thank you—we are ready for questions.” | Stay on `admin-results-ar.png`; do not open new screens. |

## Presenter guardrails

- Say “deterministic simulated tracking,” not live tracking.
- Say “demo comparison metrics,” not production prices or measured city-wide savings.
- Say “expansion potential,” not implemented multi-city, AI, GPS, maps, payments, registration, or deployment.
- If the sequence becomes uncertain, stop live mutations, show the ordered backup walkthrough, and preserve the remaining speaking timeline.
