# Task 19C implementation ledger

Baseline: PR #62, `e2d7b354f197750c1478e93dee0f4506047585b8`,
tree `5c0f66e6efbdab508d4f82a9600b488b157ffacf`.
Only synthetic fixtures are public. No live provider access was performed.

| Area | Baseline evidence / cause | Correction and regression |
| --- | --- | --- |
| 19C.1 Transport | Documented-shaped loopback object fails legacy adapter with `checkpoints_upstream_invalid`; that service expects PostgREST arrays with coordinates. | Separate fixed-target backend adapter; X-Api-Key only; no redirects; bounded decoded body and whole-operation deadline. Synthetic two-origin, stalled header/body, oversized, malformed, network and HTTP failure tests. Legacy adapter unchanged. |
| 19C.2 Mapping | Existing research parser deliberately rejects provider IDs and cannot represent partner metadata. | Separate names-only provider DTO preserves stable IDs and raw change timestamps. Duplicate names remain distinct; duplicate IDs and more than seven records per city reject the whole limited feed. Empty lists remain valid. No coordinates or traffic inference. |
| 19C.3 Capability and authorization | Baseline explicit limited capability is absent; proposed flag/key inputs are ignored. | Separate default-disabled gate, dedicated backend key, Passenger/Driver read authorization, complete-profile/session checks; legacy ordinary capability response preserved. Research publication guard unchanged. |
| 19C.4 Shared quota | No partner-key coordinator exists; per-user requests would exhaust the documented budget. | Existing MySQL counter row coordinates conservative reservations and durable Retry-After cooldown. Instance-local cache/single-flight coalesces reads. Real MySQL concurrency, lock-wait time and restart tests; no migration. Demo-reset combination rejected. |
| 19C.5 Mobile | Baseline action stays hidden when only the new limited capability is supplied (widget RED). | Existing directory components, Arabic city grouping/search and neutral messaging reused through a presentation projection. Explicit limited notice and accurately labelled raw timestamps. Actor/revision fencing, account-switch late responses, withdrawal and error tests. Research parser unchanged. |
| 19C.6 Security | New header and secret field need coverage within supported structured log depths. | Logger adds dedicated environment field and lower/title-case HTTP header variants, including quoted redaction paths for hyphens. Synthetic secret capture tests. No real keys used. |
| 19C.7 Dependency gate | Fresh full/production audits fail on unchanged PR #62 manifests: body-parser high advisory and fast-uri moderate advisories (AJV inherits fast-uri). | Pin body-parser 2.4.0, fast-uri 3.1.9 and required compatible qs 6.16.1; update only those lock entries. No force audit, exceptions or policy changes. Full validation rerun. |

RED diagnostics and final successful logs are stored separately in local ignored
Task 19C evidence. Early analyzer findings were brace-style issues in the new
Dart files; they were corrected rather than suppressed. A test-first regression
also caught shortening a long Retry-After into a local maximum; the implementation
now preserves representable values and holds the budget for unrepresentable ones.

Independent review of immutable `44f5ea02fea319b7db7b46bab746ac995df47269`
identified a P2: failed persistence of a received 429 left only a short shared
reservation. A real-MySQL RED then reproduced a second-instance grant after 2700
milliseconds despite Retry-After 90. The correction persists a hold before HTTP
and releases it only through owner-fenced settlement; a failed cooldown write or
crash retains the shared hold. Regression coverage also rejects stale settlement.
This intentionally requires operator investigation after an unresolved attempt,
rather than silently retrying against an unknown cooldown. No schema was added.
An additional RED/GREEN covers a received 429 crossing the local deadline;
its cooldown is persisted before applying the ordinary deadline rejection.
Review of `27b050ca40d01e5cfb129daebd8980a1222b59d5` found that a peer could
cache the hard-hold sentinel locally even after its owner settled normally.
An actual-service RED reproduces that permanent local unavailability. Shared
denial caching is now bounded to five seconds; durable database authorization
is still checked before every HTTP request. Synthetic two-instance and real
MySQL recovery regressions verify the peer resumes without a process restart.

The dependency security-floor test was updated to assert the new patched pins,
including body-parser, after its existing deep-equality assertion correctly
rejected the changed manifest. Its exact-version policy remains enforced.

The [adapter and operator guide](limited-partner-directory.md) describes bounds,
source selection, deployment prerequisites and the separate read-only secure
conformance procedure. Offline fixtures establish local behavior only; they do
not prove live provider conformance or full redistribution permission.

No schemas, historical migration SQL/checksums, research manifest, private
173-record dataset, live coordinate adapter, matching, booking or route logic
were changed. No feature was enabled. No merge or deployment is authorized.

A later real-MySQL run exposed a deadlock during 24 concurrent first-time key
reservations. The lease implementation rotated the counter primary key while
other transactions entered its composite unique index. The correction retains
the stable counter primary key and fences attempts with its locked monotonic
count instead. The same concurrency assertion is retained unchanged; no
transaction error, assertion, timeout or security policy is suppressed.
