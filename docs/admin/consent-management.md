# Consent release management

Darb stores operational consent content as plain UTF-8 text in MySQL. The server canonicalizes text to Unicode NFC, converts CRLF/CR newlines to LF, preserves all other whitespace, bounds each localized document to 30,000 characters and 32,000 UTF-8 bytes, and calculates the SHA-256 digest. Admin clients never submit a digest and no server process fetches an external content URL.

A release is one opaque version identifier and exactly six documents: Terms, Privacy Notice and Adult 18+ Attestation in Arabic and English. Draft creation and edits are atomic. Every edit requires the current release revision; stale requests fail with HTTP 409. Approved content cannot be edited through the service.

The supported lifecycle is:

1. Create a complete draft with its intended activation time.
2. Review all six plain-text documents.
3. Record legal approval only after external real-world approval. This freezes document identity and content.
4. At or after the intended time, explicitly activate the release. One serializable transaction retires the previous release and activates the replacement at the same server timestamp.
5. Retire the current release only with an explicit confirmation that onboarding will become unavailable.

The Admin endpoints are under `/api/v1/admin/consent-releases` and require an active Admin session. The Settings screen is the supported UI. Draft, approval, activation, replacement and retirement transitions emit safe audit metadata without document content.

Public onboarding remains fail-closed. A current set exists only when exactly one effective release contains all six documents, every document is legally approved, effective and not retired, and every stored body matches its digest. Draft, approved-but-not-activated, retired, incomplete, ambiguous or corrupted releases are never returned by the public consent endpoint.

This workflow contains no legal wording and does not establish legal approval. Privacy/legal owners must supply and approve the actual Arabic and English documents before any release is activated.

## Manual QA

- Confirm the empty Settings state reports `NOT READY` and contains no prefilled legal wording.
- Create a draft with all six documents and verify Arabic fields are RTL and English fields are LTR.
- Open the same draft in two sessions, save from one, and confirm the stale save from the other fails and reloads the authoritative revision.
- Review all six documents, record legal approval with the explicit confirmation, and confirm editing is no longer offered.
- At or after the intended time, activate the release and confirm onboarding becomes `READY`.
- Create and approve a replacement, activate it, and confirm the previous release becomes retired without an incomplete or ambiguous public set.
- Retire the current release, acknowledge the onboarding-disable warning, and confirm onboarding becomes `NOT READY`.
