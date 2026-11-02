# Checkpoint data freshness and failure policy

Version: 1.0 (2026-10-26). Status: **approved for demo and development use only**, by the repository owner's delegation ("generate them, it is a demo"). It is **not** a safety approval for production: a named product-safety approver and the data provider must still approve it before real checkpoint information is shown to the public. Until then `CHECKPOINT_STALE_POLICY = APPROVED_FOR_DEMO_ONLY` and the checkpoint features stay disabled by default.

Principle: never present a checkpoint as open, closed or congested because of a timestamp, a cached value or a previous value. When in doubt, show that the information is unavailable.

## Observation age

| Age of the provider's observation timestamp | Presentation |
| --- | --- |
| 0 to 15 minutes | "Updated N minutes ago", with the source named |
| over 15 minutes to 60 minutes | "May be out of date", with the age |
| over 60 minutes | "No recent update"; no status wording at all |
| missing, unparseable, or more than 2 minutes in the future | "No recent update"; the record is treated as having no observation |

The backend decides the bucket from the server's own clock; the app never compares timestamps itself.

## Cache

- A successful response may be served from cache for at most the configured cache interval (`CHECKPOINTS_CACHE_TTL_SECONDS`).
- The observation age rules above apply to the provider's timestamp, not to when we fetched it, so a cached value ages normally.
- Cached data older than 60 minutes of observation age is never served as a current status.

## Failures

| Situation | Behaviour |
| --- | --- |
| Timeout, outage, or network error | Show "Checkpoint information is unavailable". Serve cache only if every record in it is still within 60 minutes of observation age, and mark it stale. |
| Provider rejects our credentials (401/403) | Show unavailable. Do not serve cache. Raise an operator alert; this is a configuration or revocation problem. |
| Malformed or contract-violating response | Show unavailable. Do not serve cache from that response. Log a sanitized error. |
| Provider returns a different record set than expected | Treat as malformed. |

The app must never show "open", "clear" or "safe" wording derived from the absence of a problem.

## Review

Re-read this policy when the provider contract is verified (EDIT-06), when live conformance is run (EDIT-04), and before any production enablement (a named product-safety approver signs, with date).
