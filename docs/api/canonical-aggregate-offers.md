# Canonical aggregate offers API

These backend-only driver endpoints exist only when the shared-trip gate and its dependencies
are enabled:

- `GET /api/v1/driver/canonical-shared-offers?limit=25`
- `GET /api/v1/driver/canonical-shared-offers/:id`
- `POST /api/v1/driver/canonical-shared-offers/:id/accept`
- `POST /api/v1/driver/canonical-shared-offers/:id/reject`

All endpoints require an authenticated active driver and return only offers owned by that
driver's verified profile and DriverRoute. The limit is bounded to 1–50. Mutations require an
`Idempotency-Key`; reject accepts one existing categorical `CanonicalRejectReason`.

The allowlisted offer response contains ID/version/status, route and ordered public stop labels,
departure and lifecycle timestamps, aggregate passenger/request/order/parcel counts, aggregate
stop events, and a minimum Trip summary after acceptance. It never returns manifest/member IDs,
dispatch IDs, demand IDs, scores, fingerprints, reservation data, driver/passenger/merchant
identity, phones, parcel descriptions, recipient data, coordinates, tokens, or idempotency keys.

Exact accept replay returns the same Trip. Exact reject replay returns the same rejected offer.
Shared endpoints reject legacy offer versions, and existing M7C3A endpoints continue to reject
shared versions. The capability response intentionally does not advertise shared Flutter UI in
M7C3C1.
