# Admin approvals: driver re-review and merchant onboarding

## Driver re-review

A rejected driver application can be sent back to the pending queue for a fresh decision.

- `POST /admin/driver-verifications/:userId/reopen` with `{expected_revision, reason (3-500 chars)}`.
- Only a **rejected** application at the expected revision can be reopened (`409` otherwise). The account must be `pending` or `active`.
- The application returns to `pending` with a new revision, a fresh `submitted_at`, and cleared reviewer fields. The account status is not touched.
- Every approval, rejection and reopening appends a row to `driver_verification_decisions` (revision decided, decision, reason, admin, time). The detail response returns the latest 20 as `history`, so a re-review never erases what was decided before it. Decisions taken before this feature exist only in the audit log.
- Approved applications stay final.

A rejected applicant cannot sign in (their account is still pending), so reopening is an Admin action, for example after the applicant contacts support. There is still **no document upload**: evidence stays `not_collected` and nothing is labelled "verified documents".

## Merchant approval

New merchants that register through public onboarding start `pending` and cannot sign in.

- `POST /admin/merchant-approvals/:userId/approve` → account becomes `active`.
- `POST /admin/merchant-approvals/:userId/reject` with `{reason (3-500 chars)}` → account becomes `disabled`, its sessions and pending-status sessions are revoked, and the security version is bumped.
- Only a `pending` merchant can be decided (`409` otherwise); the update is a conditional write, so a lost race returns `409`.
- Both decisions are audited as `account_status_changed` with `kind: "merchant_approval"`.
- The generic `PATCH /admin/users/:id/status` still refuses pending → active for non-passengers (`approval_required`); this endpoint is the dedicated path.

In the Admin console, a pending merchant shows **Approve merchant / Reject merchant** in the Users list and detail.
