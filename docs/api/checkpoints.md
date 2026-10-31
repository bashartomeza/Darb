# Checkpoint / barrier feed

`GET /api/v1/checkpoints` returns the barriers drawn on the passenger and driver
maps. It requires a trusted active session, and the path does not exist unless
`CHECKPOINTS_ENABLED` is on — a client that ignores `capabilities.checkpoints_available`
gets a `404` rather than an empty list it might read as "no barriers".

## Why this is a proxy, not a direct call

The current local adapter targets a PostgREST table; its relationship to the
historical partner endpoint and compatibility with the authoritative provider
are **unverified**. The mobile app does **not** call it
directly. Doing so would ship the upstream key inside the APK, put a second
network origin outside the session boundary, and leave the app parsing a schema
owned by another team. The key lives in server config; the app sees one
authenticated Masari endpoint.

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `CHECKPOINTS_ENABLED` | — | Requires `MAPS_ENABLED` |
| `CHECKPOINTS_URL` | when enabled | Must be HTTPS |
| `CHECKPOINTS_API_KEY` | when enabled | Never leaves the server |
| `CHECKPOINTS_TIMEOUT_MS` | no | 500–15000, default 6000; includes response-body consumption |
| `CHECKPOINTS_CACHE_TTL_SECONDS` | no | 0–3600, default 60 |

## Response

```json
{
  "checkpoints": [
    {
      "id": "7",
      "name_ar": "حاجز الكونتينر",
      "name_en": "Container Checkpoint",
      "latitude": 31.7054,
      "longitude": 35.2024,
      "status": "closed",
      "updated_at": "2026-08-01T10:00:00Z"
    }
  ],
  "fetched_at": "2026-08-01T10:05:00Z",
  "stale": false
}
```

`status` is one of `open`, `congested`, `closed`, `unknown`. An upstream value
that does not map to the first three becomes `unknown`, never `open` — an
unconfirmed barrier must not render as passable.

`stale: true` means the upstream read failed and this is the last good response
still in cache. The mobile map labels it.

## Upstream tolerance

The upstream column names are not pinned by a contract we control, so each field
accepts several spellings (`lat`/`latitude`, `name_en`/`title_en`/`name`,
`status`/`state`/`condition`, and so on — see `services/checkpoints.ts`). A row
that still yields no usable coordinate is **dropped**, not placed at a default
position.

A genuinely empty array remains a valid local response. A nonempty array with
no usable rows is rejected; it must not replace good cached data with a fresh
empty success. These are local adapter rules, not an approved upstream contract.

## Transport resource safeguards

Automatic redirects are disabled, including same-origin redirects. A redirect
is rejected without following its location or forwarding either authentication
header. Operators must obtain owner approval for the exact backend endpoint.

The deadline stays active through response-body consumption. The adapter also
rejects JSON exceeding **1,000,000 decoded bytes**, checking declared length
early and counting streamed bytes independently (including chunked/compressed
responses). This adopts the existing server JSON resource budget in
`apps/api/src/maps/http.ts`; it is not a provider-specific feed-size, row-count,
or pagination assumption. Nothing is truncated. Real-feed compatibility with
this bound still requires owner-approved evidence before activation.

Timers are cleared and response readers/bodies are cancelled on rejection;
cancellation completion cannot extend the deadline. JavaScript cannot preempt
synchronous JSON parsing; bounded input limits that work and elapsed monotonic
time is checked before returning a successful snapshot.

## Failure

| Condition | Status | Body `error` |
| --- | --- | --- |
| Upstream unreachable / timed out | 503 | `checkpoints_upstream_unreachable` |
| Upstream returned non-2xx, including redirects | 503 | `checkpoints_upstream_rejected` |
| Upstream returned a non-array, unparseable/oversized body, or entirely unusable nonempty array | 502 | `checkpoints_upstream_invalid` |

The upstream hostname, key, and error text never reach the client. A failure is
never converted into an empty barrier list.

## Historical observation — unverified; not operational authorization

An earlier note dated 2026-09-01 reported this upstream rejection:

```
GET .../rest/v1/checkpoints  ->  401
{"code":"42501","message":"permission denied for table checkpoints"}
```

That historical observation does not establish current authentication, grants,
RLS behavior, the authoritative data source, or the provider contract. It is
not a recommendation to grant anonymous/public reads or weaken RLS.

Keep checkpoint capability disabled and fail-closed. The provider/security owner
must approve the exact endpoint, a least-privilege backend principal with only
the necessary authorized reads, authentication/header requirements, and redacted
response/coordinate/status/freshness/failure documentation. Any permission change
requires separate owner approval; this task authorizes none.

`CHECKPOINT_PROVIDER = UNVERIFIED_BLOCKED`

`CREDENTIAL_ROTATION = PENDING_OWNER_CONFIRMATION`

The owner must independently confirm historical credential revocation/rotation
without supplying credentials. Neither synthetic tests nor source removal prove
live provider compatibility or revocation. Replacement credentials belong only
in approved backend secret storage; never include them in mobile artifacts,
documentation, logs, or review evidence.
