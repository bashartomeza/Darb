# Authenticated route catalog

`GET /api/v1/capabilities` requires a trusted active session and returns only
safe booleans: canonical route catalog, canonical multi-route entry, canonical
matching, maps, checkpoints, and live tracking availability. It exposes no
environment names or configuration values. M7C2 uses it as the authoritative
mobile navigation gate.

M7B exposes public-ready contracts but requires the existing live authentication middleware.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/v1/routes?page=1&limit=25` | Active routes whose current version is published or paused |
| GET | `/api/v1/routes/:id` | One eligible current route/version |
| GET | `/api/v1/route-versions/:id/stops` | Ordered stops for an eligible current version |

## Coordinates and geometry (changed in M7D)

Through M7C the public catalog withheld coordinates unconditionally: stop order
and permissions were textual selection authority, never map geometry. **That is
no longer true.** The mobile map needs real positions, and the alternative —
shipping a coordinate set to the client some other way — would have meant a
second, unversioned source of truth for where a stop is.

The rule is now conditional on `MAPS_ENABLED`:

| `MAPS_ENABLED` | Public stop | Public version |
| --- | --- | --- |
| `false` (default) | no `latitude`/`longitude` | no `geometry` |
| `true` | six-decimal `latitude`/`longitude` | `geometry` summary, plus `encoded`/`encoding` once `geometry_status` is `available` |

`MAPS_ENABLED` requires `ROUTE_MANAGEMENT_ENABLED`, and `capabilities.maps_available`
reports the resolved value, so a client never has to guess whether coordinates
are coming. Geometry that is still `pending` or `unavailable` returns
`encoded: null` — clients then join the ordered stops rather than draw an
invented shape.

What did **not** change: `geometry_provider`, `geometry_checksum`, drafts,
retired routes, non-current versions, audit/actor metadata, idempotency records,
and credentials are still never exposed.

Pagination is bounded to 50 rows. When route management is disabled, list returns `{ enabled: false, routes: [], total: 0 }`; detail and stops return `404`. Unauthenticated calls return `401`.

The catalog includes bilingual names/descriptions, the approved current lifecycle and geometry-readiness summary, active dates, and ordered permission flags.

Public responses also omit route/stop creation and update timestamps, version publication/pause timestamps, internal membership IDs, origin/destination foreign-key IDs, the parent service-route foreign-key ID, and stop lifecycle/retirement metadata. Stable route, version, and stop IDs remain because clients need them for approved catalog navigation; sequence and permission flags remain because they are operational catalog content.

These contracts are not consumed by Flutter in M7B. Passenger, merchant, driver, matching, batching, and trip entry remain on the legacy deterministic path until M7C.
