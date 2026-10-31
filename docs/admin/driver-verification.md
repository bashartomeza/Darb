# Admin driver verification

Card 3 adds a dedicated Admin-owned review lifecycle for driver accounts. It does not turn the generic account-status endpoint into an approval endpoint.

## Source and evidence boundary

The pending queue is sourced from `driver_verifications`, created atomically when public onboarding completes for the `driver` role. Migration 19 backfills every existing driver user: an existing `DriverProfile.verified = true` becomes `approved`; every other driver becomes `pending`.

Public onboarding currently collects the driver's display name, normalized phone number, password, role, consent acceptance, and adult self-attestation. It does **not** collect licence files, identity documents, vehicle documents, or other verification evidence. The Admin API therefore returns `evidence.status = "not_collected"`; it never creates fake document rows or fake evidence.

### Admin-recorded evidence

While a verification is `pending`, an Admin can record which kinds of document they sighted (`driver_licence`, `vehicle_registration`, `national_id`, `insurance`, `other`) with an optional note of up to 200 characters, via `POST /api/v1/admin/driver-verifications/:userId/evidence` (`expected_revision`, `kind`, `note`). This is a record of the review, not a document store: **no files and no document numbers are stored**, entries are append-only, capped at 10 per revision, audited, and shown only for the revision they were recorded against. `evidence.status` becomes `recorded` once an entry exists for the current revision; otherwise it stays `not_collected`. Approval does not depend on it. Applicant-side upload, storage, retention and access rules remain undecided and need a legal/security decision before any file handling is built. Migration `20261026120000_driver_verification_evidence` is additive.

### Applicant document upload (server storage)

A driver whose application is `pending` can add documents from the pending-review screen in the app. This reuses the existing pending-status session (`Authorization: Onboarding <token>`); no new sign-in path is created.

- `GET /api/v1/onboarding/driver-documents` lists the applicant's documents for the current revision and the limits.
- `POST /api/v1/onboarding/driver-documents?kind=<kind>` uploads one file as the raw request body. JPEG, PNG and PDF only, decided by the file's leading bytes (the declared type is ignored), at most 5 MB, at most 6 per revision.
- `DELETE /api/v1/onboarding/driver-documents/:id` removes one of the applicant's own documents while the application is pending.
- `GET /api/v1/admin/driver-verifications/:userId/documents/:documentId` is Admin-only. It returns the file as a `no-store`, `nosniff` attachment and records an audit entry for every view.

Files are written to `DRIVER_DOCUMENTS_DIR` under a random 48-character name with owner-only permissions; the database holds only metadata (kind, type, size, SHA-256, storage key). The feature is **off unless** `DRIVER_DOCUMENTS_ENABLED=true` and `DRIVER_DOCUMENTS_DIR` is an absolute path; when off, the endpoints return 404 and the app hides the card.

Deployment notes for the server host: put the directory on persistent storage (not the container's ephemeral layer), outside any web root, owned and readable only by the API user, and include it in backups together with the database. Serve the API over HTTPS only. The files are personal documents; do not put the directory on a shared or public volume.

Retention: documents of a decided application (approved or rejected) are deleted after `DRIVER_DOCUMENT_RETENTION_DAYS` (default 90) by `npm run documents:purge -w @masari/api` (after `npm run build`). It is safe to run repeatedly; schedule it daily on the host. Documents of pending applications are never purged, and an applicant can delete their own while pending. The 90-day default is an engineering default; the product owner should confirm it.

Not covered: malware scanning of uploads, encryption of files at rest beyond the host's disk encryption, and applicant-side upload after a rejection (a rejected applicant still cannot sign in, so a re-review stays Admin-initiated).

## Lifecycle and operational effect

- `pending -> approved`: requires the current revision. If no profile exists, the Admin must enter the real vehicle type, seat capacity, and parcel capacity. The transaction creates or verifies the profile and activates only an account whose status is still `pending` from onboarding.
- `pending -> rejected`: requires the current revision and a non-empty normalized reason. The reason is persisted and any existing profile is set to `verified = false`.
- `approved` and `rejected` are terminal for Admin decisions; the only other transitions are the expiry restriction `approved -> documents_expired -> pending -> approved/rejected` described under Document expiry. Duplicate, stale, or conflicting decisions return HTTP 409 and do not partially update the profile or account.
- Suspended or disabled accounts are never reactivated by approval. Account suspension/reactivation remains a separate security control.

Existing driver availability, online-state, and matching gates continue to require `DriverProfile.verified = true`; they also retain their active-account checks. Rejected and unverified drivers therefore remain blocked from driver operations.

## Re-review boundary

Admin-initiated re-review of a rejected application exists (see approvals.md). Applicant-initiated re-review exists only for expired documents (next section). A rejected applicant still cannot sign in, so their re-review stays Admin-initiated.

## Document expiry and re-review

Migration `20261029190000_driver_document_expiry` is additive. Drivers approved before it have no dates and are never restricted by it.

### Recording expiry dates

When approving (first approval or a re-review), the Admin can record the **last valid day** of each document: `licence`, `vehicle_registration`, `insurance` and an optional `contract` end. Send them as `expiry: { licence: "2027-10-28", ... }` (YYYY-MM-DD, UTC calendar dates) in `POST /admin/driver-verifications/:userId/approve`. A date sets the value, `null` clears it, an omitted field keeps what is recorded. Every resulting date must be today or later (`400 expiry_date_in_past`). On a re-review approval the licence date is required (`400 expiry_dates_required`). `POST /admin/driver-verifications/:userId/expiry` (`expected_revision`, `expiry`) corrects the dates of an approved driver. A document is valid through its whole last day and counts as expired from the next UTC midnight.

### The scheduled check

`npm run documents:expiry -w @masari/api` (after `npm run build`; schedule daily, see the deployment guide) runs `runDriverDocumentExpiryCheck`, the same cron-style mechanism as the retention purge. It is idempotent and takes an injectable clock in tests.

- **Reminders.** An approved, active driver gets an in-app notification (English and Arabic) when a document has 30 days left and again at 7 days. One per document, date and tier: reruns, and a job that was down, never duplicate it (a job first running at 5 days left sends only the 7 day notice). Changing a date creates fresh reminders for the new date.
- **Restriction.** The day after any recorded date, the verification moves `approved -> documents_expired` in one transaction: the revision is incremented, `DriverProfile.verified` becomes false, a `documents_expired` entry is added to the decision history, an audit event `driver_documents_expired` is written (no actor, system job) and the driver is notified.
- **Server-side enforcement.** Going online, creating or changing availability, and offering or accepting trips already require `DriverProfile.verified = true` in the API, so the restriction needs no client cooperation. Availability and legacy online-state calls answer `403 driver_documents_expired` (instead of `driver_not_approved`) so the app can explain it. Trips and offers the driver already accepted are not cancelled or changed by the job.

### Renewal by the driver

The driver keeps a normal active session and uses `/api/v1/driver/document-renewal` (requires `DRIVER_DOCUMENTS_ENABLED`, same storage, limits and file checks as applicant uploads):

- `GET /driver/document-renewal` state, uploaded documents for this revision and limits.
- `POST /driver/document-renewal/documents?kind=<kind>` (raw body) and `DELETE /driver/document-renewal/documents/:id`, only while `documents_expired`.
- `POST /driver/document-renewal/submit` needs at least one document (`409 renewal_documents_required`); the verification becomes `pending` with `renewal_submitted_at` set and a `renewal_submitted` history entry. Access stays restricted.

Renewal uploads are never purged before a decision (the retention job only purges approved or rejected applications).

### Admin console

In the driver verification queue the status filter has **Documents expired**, **Expiring soon** (window 7/30/60 days, filter by document; includes documents that expired but were not processed yet) and **Re-review queue** (state: awaiting review / awaiting driver / all). The API equivalents are `GET /admin/driver-verifications/expiring?within_days=&kind=` and `GET /admin/driver-verifications/re-review?state=submitted|awaiting_driver|all`. Review the uploaded documents, then Approve and enter the new dates: approval sets `verified = true`, clears the renewal markers and restores access immediately. Rejecting works as for any application (the driver stays restricted).

### Not covered

The mobile app shows the reminders and a clear message when an action is refused because documents expired; the in-app renewal upload screen for an active driver is not built yet (the API above is ready). Contract end is treated like any other expiry. Automatic restoration without Admin approval is deliberately not supported.

## Admin API

- `GET /api/v1/admin/driver-verifications?status=pending&page=1&limit=50`
- `GET /api/v1/admin/driver-verifications/:userId`
- `POST /api/v1/admin/driver-verifications/:userId/approve`
- `POST /api/v1/admin/driver-verifications/:userId/reject`

All four routes require an authenticated Admin session. Responses use the existing safe Admin user shape and omit password hashes, security versions, session/token data, and unrelated role data.

## Migration and rollback

Migration `20260819150000_driver_verification_approval` is additive: it creates one table, backfills driver lifecycle rows, and adds foreign keys. Existing `driver_profiles.verified` remains the downstream source of operational gating. Before a production rollback, stop writes to the new Admin endpoints; the application can then be rolled back while the additive table remains in place. Dropping the table is not required for application rollback and would discard review reasons and audit linkage.

## Shop-owner documents

Shop owners upload their papers (commercial register or shop licence, national ID, a photo of the shop) from the pending-review screen in the app, up to six files of 5 MB. They use the same server storage and retention rules as driver documents. In Users, open Approve or Reject on a pending merchant: the documents are listed there with a Download button before you decide. Applicants are told that review usually takes up to 24 hours.

## Open registration for drivers and shop owners (no invitation code)

Invitation codes keep working exactly as before. In addition, drivers and shop owners can register **without** a code when the owner turns open registration on. Passengers are never part of this: they register by email or Google.

### The switch

`OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED` (default `false`). When it is `false` the start endpoint answers 404 `onboarding_unavailable` for any request without an invitation code, the app keeps asking for one, and nothing else changes. Turning it on needs `PUBLIC_ONBOARDING_ENABLED=true` (which needs `INVITATIONS_ENABLED=true`) and `DRIVER_DOCUMENTS_ENABLED=true`; the API refuses to start otherwise. `GET /api/v1/onboarding/config` reports `open_registration_roles` (`["driver","merchant"]` when on, `[]` when off) and the app reads it. `OPEN_SIGNUP_MAX_STARTS_PER_HOUR` (default 200) is the shared hourly budget for new open sign-ups.

In staging and production it needs `OTP_PROVIDER=email` (which needs `EMAIL_DELIVERY=smtp`): Masari sends no SMS, so the applicant types an email address in the first step and the one-time code is emailed there. That proves the mailbox, not the phone, so an open applicant's phone number stays unverified (they sign in with the email). See `docs/security/email-codes-instead-of-sms.md`.

### The flow

1. Choose Driver or Shop owner, enter a phone number (invitation field optional) -> `POST /onboarding/attempts` without `invitation_code`. A one-time code is sent.
2. Verify the code, then name, password and the three consents -> the account is created in `pending` state and the app receives a `pending_status` session. `next_action` is `upload_documents`.
3. The applicant uploads the **required** documents (see below) and calls `POST /api/v1/onboarding/application/submit`.
4. The pending screen says review usually takes up to 24 hours. An Admin approves or rejects as usual.

A pending account cannot sign in to any product: login requires `account_status = active`. The only session a pending applicant holds is the narrow `pending_status` one, which reaches onboarding status and document endpoints only.

### What the server enforces

- **Required documents.** Driver: `driver_licence`, `vehicle_registration`, `national_id`. Shop owner: `commercial_register`, `national_id`, `shop_photo`. `insurance` and `other` never count. `submit` answers 409 `documents_required` with `missing_documents` until all are on file, so a modified app cannot skip the step. Submission is idempotent. After submission an applicant cannot delete the last file of a required kind.
- **Not submitted means not reviewable.** `users.review_submitted_at` stays empty until `submit` succeeds. Applicants without it are left out of `GET /admin/driver-verifications` and the pending-approval count, and approve or reject (driver and shop owner) answers 409 `application_not_submitted`. Invited applicants are marked submitted at registration, and migration `20261029120000_open_driver_merchant_signup` backfills every existing driver and shop owner as submitted, so the current queue is unchanged. The Users list exposes `role_context.application_submitted`.
- **Abuse limits** (all keyed digests in `abuse_counters`, no raw phone or IP stored): start is limited per IP (10 per hour), per phone (5 per day) and globally per hour; code sends keep the existing per-phone-per-day and per-IP limits; code entry keeps the existing attempt caps, lockout and resend limits; upload and delete are limited per applicant (30 per hour each) and submit (20 per hour). Only one live open attempt exists per phone: starting again cancels the older attempt and revokes its tokens.
- **No account enumeration.** Start behaves identically whether or not the phone already has an account, and a code is sent either way. A duplicate number only fails at the final registration step, after the caller has proved they hold the phone. Status recovery keeps its generic `invalid_credentials` answer.

### Schema change

Migration `20261029120000_open_driver_merchant_signup` makes `onboarding_attempts.invitation_id` nullable (the unique index stays, so an invitation still backs at most one attempt) and adds `users.review_submitted_at`. It is additive; rolling the application back leaves invited flows working, but a rollback to code that does not know the column must first stop open registration (switch off).

### Not covered

Abandoned open sign-ups (a `pending` account that never submits) are not purged automatically; the document purge only covers decided applications. Malware scanning of uploads is still out of scope.
