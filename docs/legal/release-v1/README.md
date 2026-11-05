# Legal release v1 (drafts for owner and lawyer review)

Status: **drafts. Not reviewed by a lawyer. Not legal advice.** Do not publish until the owner's lawyer has approved all six texts and the placeholders below are filled in. These files replace `docs/legal/drafts/` as the working set; the older drafts are kept only for history.

## Files

| Admin document label (Arabic / English) | Arabic file | English file |
| --- | --- | --- |
| الشروط / Terms | `terms.ar.md` | `terms.en.md` |
| إشعار الخصوصية / Privacy notice | `privacy.ar.md` | `privacy.en.md` |
| إقرار بلوغ 18 عاماً / Adult 18+ attestation | `adult.ar.md` | `adult.en.md` |

Each file starts with a one-line draft banner (a line beginning with `> `). The helper script removes it; if you paste by hand, delete that line and the blank line after it. Each file is plain text, with no front matter, under the 30,000-character limit. In production the server refuses any document shorter than 200 characters.

## Placeholders the owner must complete (in square brackets)

- Legal entity name (Terms, Privacy).
- Registered address (Terms section 17, Privacy section 11).
- Governing law and competent court (Terms section 16).
- Liability limit (Terms section 14).
- "Last updated" date (Terms, Privacy).
- Retention period for trip/order/report records and for logs (Privacy section 5).
- Physical location of the servers and any transfer outside Palestine (Privacy section 8). The repository documents say only that the host is Injazat; it does not say where the servers are.

Also have the lawyer confirm: the 45-minute auto-cancel and the 14-day receiver retention still match the product, and that the Arabic reads naturally. Search for `[` in each file; the script prints what is left.

## Publish step by step

1. Fill in the placeholders in all six files and have them approved.
2. Sign in to the Admin console at https://darb.aynur.ps as an admin. Open Settings, then the consent management page (الإعدادات، ثم "إدارة الموافقات القانونية" / "Consent management").
3. Click **إنشاء مسودة / Create draft**.
4. **معرّف الإصدار / Release version**: for example `1.0.0` (letters, digits, `.`, `_`, `-`; up to 50 characters; cannot be changed after the draft is created).
5. **موعد التفعيل المقصود / Intended activation time**: the earliest time the release may be activated.
6. Paste each file into the matching **النص القانوني بنص عادي / Plain-text legal content** box. The six boxes are labelled by document and language (الشروط / الخصوصية / إقرار 18 عاماً, العربية / الإنجليزية). Arabic boxes are right-to-left.
7. Click **حفظ المسودة / Save draft**, then re-read all six documents.
8. Click **تسجيل الاعتماد القانوني / Record legal approval** and confirm the dialog. Only do this after the real-world legal approval. After this the content can no longer be edited.
9. At or after the intended time, click **تفعيل الإصدار / Activate release** and confirm. The page shows **جاهز للتسجيل / READY for onboarding**.
10. Open the sign-up screen and check that all three documents show the new text in both languages.

If a text must change after approval, create a new release with a new version and repeat the steps; activating it retires the previous one.

### Alternative: generate the request body

The script reads these files and prints the JSON body for `POST /api/v1/admin/consent-releases` (the same shape the Admin console sends). It calls no server and contains no credentials.

```
node scripts/legal/print-release-json.mjs --version 1.0.0 --effective 2026-11-10T09:00:00+02:00 > release.json
node scripts/legal/print-release-json.mjs --version 1.0.0 --effective 2026-11-10T09:00:00+02:00 --strict
```

`--effective` must include an offset. Without `--strict` the script lists unfinished placeholders on stderr and still prints; with `--strict` it refuses. Submitting the body is a separate step by an authenticated admin; approval and activation still happen in the Admin console (steps 8 and 9) or through the `/approve` and `/activate` endpoints. Do not commit `release.json`.
