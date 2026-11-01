# M7D1B OSM self-hosted operational evaluation

Evidence date: 2026-08-07. Candidate: `OSM_SELF_HOSTED_VALHALLA`. This is a disposable developer-machine evaluation, not production architecture or capacity approval.

## Observed footprint and deployment boundary

The current 119.35 MB Geofabrik extract independently rebuilt into a 196.25 MB Valhalla tile directory in about 261 seconds. The earlier run observed about 257 MiB warm service memory and about 730 MiB peak sampled build memory. A bounded 20-way request batch completed without error. These results make the stack operationally credible for further evaluation, but do not establish HA, recovery objectives, multi-region behavior or sustained throughput.

The evidence service used a digest-pinned container, fixed public fixture inputs, POST requests and a localhost-only port. It had no credential, public ingress, Darb database connection, arbitrary base URL or path into staging/production. Production must not depend on `tile.openstreetmap.org` or `nominatim.openstreetmap.org`; those community services are not a Darb SLA.

The independent Nominatim import took about 332 seconds, reached roughly 3 GiB peak observed memory, and occupied about 3.2 GB including roughly 2.1 GB of retained WAL; the database itself reported about 1.19 GB. PostgreSQL/PostGIS, replication/update design, backups, restore testing, vacuum/index maintenance and WAL controls make `NOMINATIM_OPERATIONAL_COMPLEXITY=HIGH`. Valhalla's immutable-graph rebuild/promotion model is `VALHALLA_OPERATIONAL_COMPLEXITY=MODERATE`.

## Production work still required

A later independently approved design would need:

- a licensed extract/update source and documented ODbL compliance;
- daily-diff or fresh-extract automation with checksum verification, reproducible tile builds, validation and atomic blue/green promotion;
- rollback to a known graph, health/readiness checks, request deadlines, bounded queues and resource limits;
- monitoring for graph age, build failures, route error classes, latency, saturation and disk growth;
- backups only where they are more efficient than deterministic rebuilds, plus tested disaster recovery;
- network isolation, authentication from Darb services, TLS between hosts, patching and container provenance controls;
- production packaging that never shell-traces database credentials (the original disposable wrapper did; the corrected evidence script redirects xtrace and the independent rerun found zero secret-bearing trace patterns);
- broader route/vehicle/access testing and human review before production use;
- an explicit renderer/tile choice and visible OpenStreetMap attribution.

Geofabrik publishes daily regional extracts, while Nominatim and Valhalla each require their own update/rebuild lifecycle. A safe first production model would build and validate away from the serving instance, then switch immutable artifacts. In-place graph mutation is not approved here. The independent serving-container restart-to-ready result was p50/p95 `8.140/10.039 s`; the earlier `~1.03 s` result was not reproduced.

## Privacy, cost and vendor characteristics

Self-hosting can keep canonical stop coordinates and route requests inside Darb-controlled infrastructure and avoids third-party request telemetry. That is a privacy advantage, not automatic compliance: infrastructure logs, access control, retention, backups and regional hosting still need review. There is no per-request vendor fee in this evidence run, but compute, storage, bandwidth, observability, on-call work, upgrades and ODbL compliance are real costs. Operational gate G10 is therefore `CONDITIONAL`.

| Dimension | OSM/Valhalla observed or known | Google current state |
|---|---|---|
| Palestine route quality | Corrected 4/4 required routes and 12/12 expanded routes passed structural review; operational access remains conditional | Corrected coordinate and Place-ID controls returned HTTP 200 with empty route arrays; `INSUFFICIENT_EVIDENCE` |
| Arabic geocoding/search | Expanded strict result 26/30 Arabic and 51/60 overall, below 95% | Address Geocoding v4 11/30 Arabic and 21/60 overall; Places Text Search 25/30 Arabic and 48/60 top-1; both FAIL |
| Canonical geometry rights | ODbL; route-output/storage classification needs legal review | Published standard Routes persistence is restricted for the proposed record |
| Calculation latency | Warm p95 14.627 ms; process-cold request p95 66.984 ms; mixed 20-way p95 25.110 ms | Hosted address/Places latency observed; no route-performance result because no route object was returned |
| Vendor lock-in | Open data and open-source engine; graph/config behavior still engine-specific | Managed platform; content/storage and display constraints remain unapproved |
| Infrastructure cost | Self-funded compute/storage/operations; no per-call fee measured | Demo evidence only; production billing/account approval unresolved |
| Attribution | OpenStreetMap attribution and license access required | Google attribution/display rules apply |
| Maintenance | Darb owns imports, graph builds, updates, monitoring and incidents | Managed service, account/SLA still unreviewed |
| Offline/self-host | Supported and demonstrated locally | Not established for this design |

Routing, geocoding, tiles and rendering remain separable. A future stack could combine MapLibre, properly sourced OSM-derived tiles, Valhalla and Nominatim/Pelias, but none is integrated or enabled by M7D1B.

## Gate summary

| Gate | Result | Basis |
|---|---|---|
| G1 provider-neutral compatibility | PASS | Valhalla output normalized into the existing route concepts without production coupling |
| G2 Palestine road coverage | CONDITIONAL | broader public samples passed structurally; real-world access and full coverage remain unproved |
| G3 route validity | PASS | corrected 4/4 required and 12/12 expanded structural routes |
| G4 route latency | PASS | cold and warm p95 below 2 seconds |
| G5 Arabic geocoding | FAIL | 26/30 (`86.7%`) on the expanded representative set |
| G6 geocoding quality | FAIL | 51/60 (`85.0%`) overall, below 95% |
| G7 canonical-storage compatibility | UNRESOLVED | systematic canonical route geometry requires legal review |
| G8 attribution compatibility | CONDITIONAL | requirement is understood; final renderer is intentionally absent |
| G9 privacy | PASS | local evidence sent no fixture/user data to a routing/geocoding provider |
| G10 operational complexity/cost | CONDITIONAL | feasible footprint, but production SRE/TCO evidence is incomplete |

`OSM_VALHALLA_CANDIDATE=CONDITIONAL`. Failed geocoding gates do not invalidate Valhalla routing, because Darb may select separate routing and geocoding systems. Final provider selection remains `NO_PROVIDER_APPROVED_YET`.
