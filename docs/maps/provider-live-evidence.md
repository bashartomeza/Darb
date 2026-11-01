# M7D1B provider live evidence

Evidence date: 2026-08-08 (Asia/Hebron). `M7D1B_PROVIDER_LIVE_EVIDENCE=EVIDENCE_APPROVED_AWAITING_HUMAN_MERGE`. Provider selection: `NO_PROVIDER_APPROVED_YET`.

This report uses the corrected corridor fixture and the 30-location/60-query expanded public fixture under `docs/maps/fixtures/`. They contain public planning points and no user address, current location, passenger, merchant, phone-associated place, or driver data. The same unchanged 60 queries were benchmarked against open-data-only Pelias, Photon, official Google address Geocoding API v4, and separately Google Places Text Search (New); all failed the primary 95% gates ([comparison](geocoder-comparison.md)).

## Credential and execution result

Credential availability was checked categorically in the approved process environment, approved local non-example API environment files, and repository CI secret names. No value was printed or copied into an artifact.

| Provider | Local credential | CI credential name | Live classification | Geocodes | Arabic cases | Routes | Human review |
|---|---|---|---|---:|---:|---:|---|
| Mapbox | NOT_AVAILABLE | NOT_AVAILABLE | NOT_EXECUTED | 0 | 0 | 0 | NOT_EXECUTED |
| Google | AVAILABLE_DEMO_KEY | NOT_REQUIRED_FOR_LOCAL_EVIDENCE | EXECUTED_EVIDENCE_ONLY | 60 address + 60 Places | 30 each | corrected 4 + 2 controls | address 21/60; Places top-1 48/60; routes 0 available |
| HERE | NOT_AVAILABLE | NOT_AVAILABLE | NOT_EXECUTED | 0 | 0 | 0 | NOT_EXECUTED |
| Stadia | NOT_AVAILABLE | NOT_AVAILABLE | NOT_EXECUTED | 0 | 0 | 0 | NOT_EXECUTED |
| OSM self-hosted Valhalla + evaluated Nominatim | NOT_REQUIRED | NOT_REQUIRED | EXECUTED | 60 | 30 | 12 | 12 structural PASS; access CONDITIONAL |

The existing harness was invoked once for each unavailable hosted provider. Mapbox, HERE, and Stadia retained the expected `credential_unavailable` safe category, null acceptance and latency fields, zero samples, and process exit 2. Google was later executed through a separately supplied Demo Key without exposing or persisting the key. The separate keyless OSM/Valhalla run used a local digest-pinned service and current regional extract; routing and geocoding remain separate.

## Harness readiness evidence

The deterministic fake ran 10 sequential local operations: 8/8 fixture geocodes (4 Arabic and 4 English) and 2/2 fixture routes, with no failures. This establishes adapter-contract and fixture readiness only. Fake correctness and timings are not live provider quality, Palestine road validity, or service performance.

The hosted-provider harness uses `performance.now()` monotonic timing; operations are sequential; warm/cold state is uncontrolled; failures remain in the sample count; retry is bounded to at most one; request timeout is 4 seconds. Geocode and routing p50/p95 are calculated separately. A small route sample cannot establish credible p95 and is reported as `INSUFFICIENT_EVIDENCE`.

Environment: local Windows 11 workstation and ordinary developer network. No controlled network shaping, cache reset, or provider-region pinning was used. Google address Geocoding v4 and Places Text Search timings are bounded evidence from this environment; Mapbox, HERE, and Stadia remain `NOT_EXECUTED / null`. Empty Google route responses have recorded request latency but no credible route-performance p95.

## Mandatory-gate rubric

No aggregate score can conceal a failed or missing mandatory gate.

| Gate | Requirement | Mapbox | Google | HERE | Stadia |
|---|---|---|---|---|---|
| G1 | Provider-neutral architecture compatibility | PASS | PASS | PASS | PASS |
| G2 | ≥95% acceptable Palestine geocoding/search | NOT_EXECUTED | FAIL (address 21/60; Places top-1 48/60) | NOT_EXECUTED | NOT_EXECUTED |
| G3 | Acceptable Arabic quality | NOT_EXECUTED | FAIL (address 11/30; Places 25/30) | NOT_EXECUTED | NOT_EXECUTED |
| G4 | Human-approved Palestine route validity | NOT_EXECUTED | INSUFFICIENT_EVIDENCE (all corrected controls empty) | NOT_EXECUTED | NOT_EXECUTED |
| G5 | Credible routing p95 under 2 seconds | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE |
| G6 | Compatible rights for every canonical field | UNRESOLVED | FAIL | FAIL | UNRESOLVED |
| G7 | Attribution/display compatibility | CONDITIONAL | CONDITIONAL | CONDITIONAL | CONDITIONAL |
| G8 | Privacy/DPA acceptability | CONDITIONAL | UNRESOLVED | UNRESOLVED | CONDITIONAL |
| G9 | Commercial feasibility | CONDITIONAL | UNRESOLVED | UNRESOLVED | CONDITIONAL |
| G10 | Operational quota/support suitability | CONDITIONAL | UNRESOLVED | UNRESOLVED | CONDITIONAL |

G1 is based on the already-approved M7D1 adapters and deterministic tests, not live evidence. Google fails G6 for the proposed shared canonical record because the published indefinite geocode exception is end-user-specific and logically isolated, while Routes content storage is restricted. HERE fails G6 under standard public terms because results cannot form Darb's multi-year canonical record without separate rights. Mapbox and Stadia remain unresolved because their geocode paths can be made conditional, but published route-result persistence rights do not approve every proposed field.

## OSM self-hosted candidate gates

| Gate | Result | Evidence |
|---|---|---|
| G1 provider-neutral compatibility | PASS | Local Valhalla responses normalized without production integration |
| G2 Palestine road coverage | CONDITIONAL | 12 expanded public routes passed structurally; real-world access/full coverage remain unproved |
| G3 route validity | PASS | corrected 4/4 required routes and 12/12 expanded structural routes |
| G4 route latency | PASS | process-cold p95 66.984 ms; warm p95 14.627 ms; mixed 20-way p95 25.110 ms |
| G5 Arabic geocoding | FAIL | 26/30 (`86.7%`) expanded strict result |
| G6 geocoding quality | FAIL | 51/60 (`85.0%`) overall, below 95% |
| G7 canonical-storage compatibility | UNRESOLVED | systematic canonical route geometry requires legal review |
| G8 attribution compatibility | CONDITIONAL | requirement documented; final renderer absent |
| G9 privacy | PASS | local-only fixture processing; no third-party provider |
| G10 operational complexity/cost | CONDITIONAL | feasible footprint; production SRE/TCO not approved |

Pelias reached 10/30 Arabic, 15/30 English and 25/60 overall. Photon reached 19/30 Arabic, 26/30 English and 45/60 overall. Both were localhost-only and had zero errors in the bounded 20-way performance sample, but quality—not transport latency—is disqualifying. `PELIAS_GEOCODING_CANDIDATE=FAIL`, `PHOTON_GEOCODING_CANDIDATE=FAIL`, and `GEOCODING_RECOMMENDATION_CANDIDATE=NONE`.

Google address Geocoding API v4 returned 60/60 API responses but passed only 11/30 Arabic, 10/30 English and 21/60 overall after functional public-place review; p50/p95 were 111.201/128.934 ms. The separately appropriate Places Text Search benchmark returned 60/60 responses and passed 25/30 Arabic, 23/30 English, and 48/60 overall at rank 1; top-5 was 52/60 and p50/p95 were 224.7181/277.3053 ms. It materially improves named-place search but still fails all 95% gates. `GOOGLE_ADDRESS_GEOCODING_QUALITY=FAIL`, `GOOGLE_PLACES_SEARCH_QUALITY=FAIL`, `GOOGLE_PLACES_STORAGE_COMPATIBILITY=RESTRICTED`, and `GOOGLE_PLACE_ID_STORAGE=PERMITTED_WITH_REFRESH_POLICY`. Detailed evidence is in [address Geocoding v4](google-palestine-geocoding-evidence.md), [Places Text Search](google-palestine-places-text-search-evidence.md), and the [official product review](google-product-methodology-review.md).

The corrected Google Routes audit used documented coordinate nesting, a minimal mask, and a correct Place-ID control. Each control and all four corrected coordinate routes returned HTTP 200 with an empty response object and zero routes. This rules out a demonstrated field-mask, nesting, or coordinate-snapping defect, but does not explain the behavior despite official driving coverage. `GOOGLE_ROUTING_RESULT=INSUFFICIENT_EVIDENCE`; Valhalla returned all four reviewed routes and remains the conditional routing candidate.

`OSM_VALHALLA_CANDIDATE=CONDITIONAL`. Routing and geocoding remain separable; the weak Nominatim initial set does not invalidate the Valhalla route result.

## Production/provider approval blockers

M7D1B evidence quality is approved without a provider winner. Mapbox, HERE, and Stadia remain unexecuted and would need separate evidence before any future consideration. Google address and Places quality fail this corpus; its corrected route behavior remains `INSUFFICIENT_EVIDENCE`, and production storage, privacy, commercial, quota, and display design are separately unapproved. The OSM routing candidate still needs real-world access review, ODbL legal approval, renderer attribution design, and production operational/TCO review. These block provider approval and deployment, not closure of the evidence milestone after human merge review.

No generic geocoder is approved as Darb's source of truth. `GOOGLE_DISCOVERY_FALLBACK_CANDIDATE=CONDITIONAL` only for a later optional, ephemeral discovery design; `GOOGLE_CANONICAL_PLACE_SOURCE=REJECTED / NOT_APPROVED`. `CANONICAL_PLACE_CATALOG_DIRECTION=APPROVED`, and the recommended next design milestone is M7D1C — Canonical Palestinian Place Catalog & Search Architecture. M7D1C implementation has not started.

Failure behavior remains covered by deterministic adapter tests for authorization, timeout, rate limit/quota, 5xx, no result, malformed response, bounded retry, circuit breaker, redirect rejection, and credential non-disclosure. Live quota exhaustion or abusive rate testing is prohibited.

The hosted providers produced no live geometry. The self-hosted candidate produced a safe attributed [expanded road-context plot](evidence/osm-valhalla-palestine-routes.png) from public fixture geometry and roads in the exact PBF; it is real local routing evidence, not fake-provider or production-renderer evidence.

## Regression and production-boundary evidence

The Google evidence branch passed local API 271, Admin 54, Flutter 241, and tooling 17, plus typecheck, builds, analysis, workflow validation, dependency policy, and security validation. Exact-head Linux CI applied all 18 migrations from empty, repeated deployment as a no-op, and passed M7C3C1 145, M7C3A 98, M7C1 79, M7H1 reset 45, M7H1 legacy online 21, M7H1 passenger association 12, and public onboarding 76, together with trusted sessions, onboarding foundation, and route lifecycle. Every subsequent documentation-only head must pass the same four exact-head CI workflows before merge review.

Demo preflight passed 22/22. Deterministic smoke remained score 0.9317, sequence 2, trips 1 versus 6, distance 21.53 versus 129.19, cost 43.06 versus 258.38, winner `darb`. Maps remained disabled during the demo and provider calls were zero.

The final repository and focused-content scans found no credential value or credential-bearing provider URL: `SECRET_LEAK_HITS=0`. Staging and production examples remain `ROUTE_MAPS_ENABLED="false"` and `ROUTE_PROVIDER="disabled"`. The Prisma schema and all 18 migrations are unchanged; there is no migration 19, provider persistence/cache, renderer, SDK, GPS/location permission, background location, realtime work, M7D2 work, or M7E work.
