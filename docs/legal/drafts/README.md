# Draft legal texts

Status: **drafts written by the development team's assistant. They have not been reviewed by a lawyer and are not legal advice.** Publish them only after a qualified lawyer in Palestine has read and approved them.

Files (publish all six as one consent release, see `docs/admin/consent-management.md` and runbook section 8):

| Document type | English | Arabic |
| --- | --- | --- |
| `terms` | `terms.en.md` | `terms.ar.md` |
| `privacy` | `privacy.en.md` | `privacy.ar.md` |
| `adult_self_attestation` | `adult-attestation.en.md` | `adult-attestation.ar.md` |

Each file is the exact text to paste into the Admin console (no front matter, under 30,000 characters).

## Facts the drafts state that must stay true
If any of these change, change the text before publishing.

- Minimum age 18; one account per person.
- Email one-time codes; Google sign-in is optional.
- Driver documents are deleted automatically 90 days after the review decision (`DRIVER_DOCUMENT_RETENTION_DAYS=90`).
- The Ask Masari text goes to an external AI provider (`ASSISTANT_PROVIDER`).
- Payments are between the user and the driver; Masari does not process them.
- Governing law is "the laws applicable in Palestine"; contact is the in-app support option (no email address or postal address is given).

## Points for the lawyer
- Governing law, jurisdiction and the liability limits in Terms sections 11 and 13.
- Whether a postal address, company name and registration number must appear.
- Retention periods in Privacy section 5 against Palestinian record-keeping duties.
- Whether the data-subject rights wording needs to follow a specific statute.
- Whether the Arabic wording should be reviewed by a native legal translator.
