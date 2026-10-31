# Email and Google Auth rollout

## Current gate

Auth is not ready for human QA until approved email/SMS delivery is integrated,
the disposable QA deployment exists, final security reviews are clean, and all
four hosted CI lanes pass. The real database gate was exercised on MySQL 8.0.46
on 2026-09-15. Unit fixtures alone never satisfy this gate.

## Configuration

| Variable | Required behavior |
| --- | --- |
| `GOOGLE_PASSENGER_SIGNUP_MODE` | `disabled` by default; `allowlist` or `open` only in local/test/demo until approved production delivery integration lands. Existing linked login remains independent of signup mode. |
| `GOOGLE_MOBILE_SERVER_CLIENT_ID` | Single mobile server OAuth audience; unset disables mobile Google. |
| `GOOGLE_ADMIN_WEB_CLIENT_ID` | Single distinct Admin Web audience; unset disables Admin Google. |
| `GOOGLE_PASSENGER_ALLOWLIST_HMACS` | Exact comma-separated lower-case SHA-256 HMACs of canonical email with domain `masari:google-passenger-allowlist`, using the auth action key. Nonempty in allowlist mode. Never publish entries through capabilities. |
| `AUTH_ACTION_TOKEN_PEPPER` | Separate random server-only secret, at least 32 characters; never reuse JWT/refresh pepper. |
| `AUTH_ACTION_TOKEN_KEY_VERSION` | Positive version, default 1. Rotating the sole active key intentionally invalidates pending proofs; tell users to restart the flow. |
| `OTP_PROVIDER` | Existing invitation/public-onboarding setting. `fake` remains forbidden in staging/production. `email` is the production value: it also supplies the profile phone-step provider (the code goes to the account's verified email; the phone stays unverified). |

The deprecated `GOOGLE_OAUTH_CLIENT_IDS` never supplies either new endpoint's
audience. Admin reads its public client ID from `/api/v1/auth/capabilities`.
Mobile must use its official Google SDK and the matching server client ID.
No email/password or phone flow can bypass consent/profile state checks.

Service boundaries currently accept injected `EmailDelivery` and
`PhoneVerificationProvider`. The application does not instantiate an approved
adapter. A production deployment must not label an in-memory/test implementation
as approved. The production adapter integration must include explicit credentials,
sender ownership, delivery idempotency/timeouts, sanitized errors, and a real
delivery smoke test before enabling signup. Legal release validity is rechecked
inside the completion transaction; six reviewed Arabic/English documents must be
published through the existing release workflow. Test legal text is never suitable
for staging or production.

## Disposable MySQL runtime rehearsal

Run from the repository with a supported installed MySQL server executable:

```powershell
$env:AUTH_REHEARSAL_MYSQLD = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe'
npm.cmd run test:integration:auth-migration -- --confirm-disposable
```

The harness ignores caller DATABASE_URL. It creates a new short temporary data
directory, uses no MySQL option files, chooses a free nondefault loopback port,
generates a random root credential, disables MySQL X, and creates only exact
`masari_auth_rehearsal_*` databases. It shuts down its instance in `finally`.
It retains temporary data and redacted evidence for inspection; do not delete an
existing MySQL service directory. A subsequent cleanup must target only the exact
generated temporary directory after confirming the process has exited.

The harness extracts immutable `origin/production-readiness` schema/migrations,
deploys the baseline, inserts a synthetic legacy Google user, and then applies the
current Auth migrations. A separate fresh database receives all current
migrations. Each scenario repeats deployment and checks Prisma migration status.
The runtime test uses actual Prisma/MySQL transactions and service code to check:

- A Google proof creates a one-time grant and no pre-consent account.
- Concurrent first registration commits one passenger, one identity, three
  consents, and one session. The losing request never becomes an implicit login.
- Both provider/subject and user/provider uniqueness constraints reject conflicts.
- Phone remains null/required until verification; verification commits an E.164
  phone, timestamp and complete state; replay is rejected.
- Failure after session insertion rolls back action consumption, User, identity,
  consents and session; retrying the same grant succeeds.
- Legacy `google_sub` survives and is backfilled, and repeated deployment is a no-op.

Google credential verification and SMS delivery are deterministic test boundaries
in this database rehearsal. Their live provider smoke tests are separate gates.
The old fixture helper now exits with `runtime_rehearsal_required` when invoked as
a command so it cannot be mistaken for successful real-database evidence.

## Migration and rollback

Retain all historical migrations. Apply the additive Auth schema migration first,
then the separate Google backfill. The backfill preflight rejects conflicting
subject/user mappings before its single durable INSERT. Do not infer ownership
from email or phone. Resolve a dirty legacy mapping through reviewed identity
evidence and rerun in a disposable rehearsal before deployment.

MySQL DDL is not transactionally reversible. An incomplete DDL migration requires
inspection and a forward repair, or restoring the rehearsal snapshot before
traffic cutover. Application transaction rollback is tested separately above.
Do not deploy an old binary after null phones/passwords are allowed: first disable
new signup and prove the candidate rollback binary handles the expanded schema.
Keep the database expanded; do not drop identities/phone state to roll code back.

Removal of `google_sub` needs a separate approved migration after full legacy
mapping reconciliation, rehearsed backup/restore, no old readers/writers,
identity ownership collision review, rollback compatibility evidence, and an
independent deployment approval. This PR never removes it.

## Threat model and release evidence

| Threat | Control / evidence |
| --- | --- |
| Google email collision takes over existing account | provider+subject identity; explicit reauthenticated link; email collision returns conflict without link/session |
| Privilege escalation through signup | strict request schemas; new passenger only; Admin requires existing linked active Admin |
| Signup before consent / stale legal release | encrypted short-lived grant; no pre-consent User; current release validated inside atomic completion |
| Profile bypass through direct API call | server-side complete-profile middleware, status/version checks and restricted route allowlist |
| Proof theft/replay or concurrent completion | keyed digest-only action rows, expiry/purpose/subject binding, consume CAS and serializable transactions |
| Password reset enumeration or secret logs | uniform public response; sanitized delivery failures; credential redaction tests |
| SMS guessing / number collision | persistent issuance cap, one guess per proof, verified atomic transition, phone uniqueness and no automatic account merge |
| Unsafe production rollout | disabled default; strict distinct audiences; empty allowlist rejected; production signup blocked pending approved adapters |
| Fake rehearsal evidence | executable fails without confirmation; new isolated MySQL only; baseline/fresh deploy and runtime service assertions |

Before marking `READY_FOR_HUMAN_QA`, attach exact commit references for API/Admin/
Mobile tests, typechecks/builds, audit/security artifacts, CodeRabbit and Codex
Security reviews, real MySQL evidence, hosted Admin/Backend-MySQL/Mobile/Security
CI, and a disposable QA URL with actual delivery/Google smoke evidence. Open only
one draft Auth PR against production-readiness after the earlier gates pass.
No merge is part of this workflow. Card 7 PR #40 stays outside this change.
