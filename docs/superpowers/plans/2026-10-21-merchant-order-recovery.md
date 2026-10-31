# Task #9 Merchant Order Persistence and Duplicate Prevention

> Implement inline using systematic debugging and TDD; independently review the final diff. User authorization covers implementation and verification without intermediate approval. Stop for a necessary migration or unresolved architecture/product policy.

Goal: one atomic, merchant-scoped saved order per operation, with durable mobile recovery and unchanged Merchant UI.
Starting head: 09a0528689d10a4c938fbf96b5690b378dfb7a70.
Baseline: b372cc3cdc916ef03f1a64da3800786312cb76c4. Existing Draft PR #51; never modify #50.
Architecture: reuse IdempotencyRecord, merchant routes, AuthenticatedApiClient, authenticated actor binding and FlutterSecureStorage. No schema changes, provider access or external service.

## Review focus
- A late response or auth refresh must not submit/clear another account's operation, including logout and return to the same account.
- Persistence or deletion failure, malformed successful response and server failure must retain an uncertain operation.
- Expired client recovery must never mint a replacement key or initiate a mutation; read-only lookup may recover a confirmed saved result.
- Cancellation of navigation cannot establish cancellation of an in-flight database commit; retain that operation until reconciled. Existing confirmed-order cancellation remains authoritative.
- Direct and replay paths must preserve parcel counts, audit count, authorization and legacy no-key response compatibility.

## Implementation / verification ledger
- [x] Inspect exact branch and two-file initial diff; baseline API 629/629 PASS.
- [ ] RED: real Merchant form must send a stable key; simulate commit then lost HTTP response and process restart.
- [ ] RED: expired completed idempotency key must replay rather than reclaim/create; use real MySQL with API authentication.
- [ ] Correct only reproduced API defects; add actor-scoped read-only operation lookup and protect completed merchant claims from expiry reclamation.
- [ ] Add secure per-merchant pending payload/key/time storage and single-flight submission/recovery. Retain unknown outcomes; fence account/session changes; never mutate on mount, expiry or navigation cancellation.
- [ ] GREEN: focused API/storage/controller/app-level tests; real MySQL races, changed payload, actor isolation, rollback after audit/completion failure and actual response loss.
- [ ] Full API/Admin/Flutter/tooling suites, actual disposable MySQL regression, builds, scans and dependency audits. Record pre-existing failures without weakening checks.
- [ ] Independent final review, focused commits, fast-forward push existing branch, all four exact-head hosted workflows, keep draft.

## Initial findings
The screen calls createOrder without a key; pending state is only widget-local. The initial server uses a shared claim helper that reclaims expired completed records, permitting duplicates after retention. The claimed seven-day client refusal is not implemented. No durable recovery or recovery UI flow exists. One high dependency vulnerability was reported by the initial lockfile install; investigate/report separately.

## Verified implementation and bounded review fixes
- First real-form RED: missing idempotency header (null); restart RED: no durable pending payload. App restart recovery and navigation cancellation are now green with no second POST.
- Real MySQL RED: after setting a completed claim's expires_at in the past, the initial API created a different order. Merchant claims now opt into preserving completed records; defaults for other operations are unchanged. Older recovery uses an authenticated read-only header-key lookup.
- Existing order/parcels/audit/claim transaction remains intact. Ten concurrent requests reconcile to one identity. Synthetic post-commit socket destruction verifies lost HTTP response recovery. Test-only triggers verify parcel/audit/completion rollback without schema migrations.
- Secure storage now persists one versioned immutable payload/key/time per merchant before dispatch. Seven-day/future-clock expiry disables mutation, while read-only recovery remains possible. Missing lookup is not proof that an in-flight request failed. Explicit recovery uses the original key/payload; errors, storage corruption and uncertain outcomes never silently replace it.
- Session revisions fence logout, account switching and return to the same account, including dispatch after credential loading/refresh. A shared single-flight runner remains alive across auth transitions. Read-only recovery clears the matching pending operation only after validating the saved order/parcel response.
- Independent review identified a deletion-in-flight and a final-continuation ABA cleanup race. Both were reproduced RED, then fixed by restoring the exact original actor/key before releasing single flight. Another merchant's operation is never overwritten. Failed secure restoration explicitly blocks further replacement submissions in that running app; a platform failure after a confirmed result requires support reconciliation, not an automatic new submission.
- Fast recovery waits for the existing full-screen entrance transition before navigation, avoiding duplicate shell keys. No router lifecycle, layout, pricing, provider or schema changes.

## Verification record before final commit
- Baseline API: 629/629 PASS. Initial concurrent verification had one five-second authRuntimeSafety child-start timeout; sequential final API rerun: 629/629 PASS without changing its timeout.
- Final focused Merchant recovery/controller/repository/real-router widgets: 30/30 PASS.
- Full Admin: 368/368 PASS, typecheck and production build PASS.
- Full Flutter: 313 PASS, 4 FAIL. Exact initial-commit snapshot reproduces the identical four Driver RenderFlex overflow failures: accept/reject pending, production tracking controls, next trip action and driver full-screen navigation.
- Flutter analyzer: same 7 inherited issues in checkpoint/Driver/Passenger files, no new Merchant issues. Global formatter flags 6 inherited non-Merchant files; no formatting assertions are waived.
- Tooling: 55 PASS, 1 FAIL, 0 skipped. Existing migration inventory omits 20261012165000_allow_legacy_offer_lifecycle_timestamps. No migration/checksum/inventory changes made in this task.
- Actual MySQL 8.0.46: merchant matrix PASS; fresh/repeat/status, prior-history upgrade/repeat/status, demo reset, online state, trip association, canonical and shared integrations PASS. Existing combined workflow FAIL is retained in sanitized evidence; no assertions or budgets relaxed.
- Full and production dependency audits each flag one high Vite package vulnerability (three launch-editor advisories). Dependency files remain unchanged; no automatic audit fix or waiver.
- API/Admin builds and production-configured APK PASS; Admin/APK artifact scan PASS. Workflow structural validation and tracked secret scan PASS. New files will also be scanned after staging.
- Independent exact-commit review, browser evidence and all four hosted workflow outcomes are recorded with the immutable final head in the ignored task9 evidence bundle and final delivery. Overall verification remains BLOCKED by inherited full-suite/security failures; do not claim PASS or merge.

## Scope / approvals
No PR #50 modifications, migrations, real database access, provider calls, historical credential use, new dependencies, external services, Figma, redesign, merge or deployment. CodeRabbit not used. Separate baseline remediation or an approved integration baseline is required to clear inherited gates; no unapproved architectural change is made here.
MERGE_GATE = BLOCKED until explicit user approval, with inherited validation blockers still unresolved.
