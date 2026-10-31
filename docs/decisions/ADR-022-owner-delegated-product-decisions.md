# ADR-022: Product decisions taken under the owner's delegation (2026-10-26)

Status: accepted by the repository owner's delegation. Reversible by the owner at any time.

## Context

On 2026-10-26 the repository owner set the production domain to `masari.aynur.ps`, chose Injazat as the host with server storage, and said that for the remaining open product choices the assistant may "choose the best". This record lists what was chosen so the choices are visible and can be changed. It does not cover decisions that depend on facts or authority outside the repository (below).

## Decisions

| Register item | Decision | Why |
| --- | --- | --- |
| Hosting origin | One origin, `https://masari.aynur.ps`: Admin at `/`, API at `/api/v1`, TLS at a reverse proxy. | One certificate, no cross-origin surface, simplest to operate. See `docs/operations/masari-aynur-ps-deployment.md`. |
| EDIT-17 document storage | Server disk under a configured directory, random file names, metadata only in the database; JPEG, PNG, PDF; 5 MB; 6 per revision. | The owner chose server storage. Content sniffing and per-revision caps limit abuse and disk use. |
| EDIT-17 document retention | 90 days after the application is decided, then deleted; pending applications are never purged. Configurable by `DRIVER_DOCUMENT_RETENTION_DAYS`. | Long enough to answer a dispute after a decision, short enough to limit how long identity documents are held. |
| EDIT-17 re-review | Stays Admin-initiated; a rejected applicant cannot sign in and no applicant-side resubmission is added. | Adding it would need a new sign-in path for rejected accounts, which is a larger security change than the current need justifies. |
| EDIT-16 metrics | Keep the current definitions: Active drivers = verified drivers with a route in service (`active`, `assigned`, `on_trip`); Pending approvals = pending driver verifications; Incidents = unresolved reports. | They are computed from bounded server counts and never inferred from unrelated lists. |
| EDIT-18 Merchant approval | Admin-only approval and rejection; rejection requires a reason and disables the account; approval is not available through the generic status endpoint. | Keeps one audited path and one accountable role. |
| EDIT-13 notifications | Stay in-app, polling only; no push, SMS or email channel. | A channel needs an approved provider and consent text. No preference or retention features until a channel exists. |
| EDIT-14 incidents | Stay a filed-report queue with forward-only triage; the app and Admin both state it is not an emergency channel. | Emergency handling needs staffed response ownership the product does not have. |
| EDIT-15 reports | CSV export only, over real data, capped at 5,000 rows, formula-safe, no contact data. No PDF or Excel until a user asks for them. | Avoids building formats nobody has requested. |

## Deliberately not decided here

These need facts or authority the repository does not hold, so choosing them would be inventing them:

- EDIT-01 to 04: credential injection, one provider-backed request, live conformance (need the operator and the real key).
- EDIT-05: confirmation that the historical credential was revoked or rotated (needs the provider's audit record).
- EDIT-06 and 09: provider contract, usage rights and redistribution permission (need the provider and legal).
- EDIT-07 and 08: observation age and failure presentation for checkpoint data (need a named safety approver; the feature stays disabled and fail-closed).
- EDIT-10: exact-head release verification (needs a concrete release candidate).
- EDIT-19 to 24: fares and payments, canonical monitoring, place catalog, map provider, live tracking, location evidence. Each is a new product area needing its own policy, data or provider approval.
- Registration being opened in production: needs an approved SMS provider and current legal text.

## Consequences

The decisions above are already implemented or documented in the repository. Changing one means changing its setting or opening a new record that supersedes this one.
