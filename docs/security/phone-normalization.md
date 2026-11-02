# Global phone normalization

Darb uses exact-pinned `libphonenumber-js` full metadata and one strict server wrapper (`extract: false`) for phone validity and canonical identity. Valid international input must begin with `+`; spaces, hyphens, parentheses, Latin digits, Arabic-Indic digits, and Eastern Arabic/Persian digits are accepted as presentation variants. The canonical result stored, compared, digested, and used by phone-keyed abuse controls is E.164.

Local-format input is accepted only when the caller supplies an explicit two-letter ISO country/region context supported by the phone library. Darb never assumes Palestine—or any other country—for an ambiguous local number. The current Admin and Flutter interfaces do not provide a country selector, so they require explicit international `+` input. Existing clients may continue to submit Palestinian local format with explicit `region=PS`.

Input is bounded to 32 characters before parsing. Empty input, controls, letters, extensions, malformed or multiple plus signs, `00`-prefixed input without region context, unknown regions/calling codes, ambiguous local input without a region, and invalid numbering-plan ranges are rejected. Different canonical E.164 values remain different identities; no country code is rewritten into another.

Lookup storage uses `HMAC-SHA-256(phone context + key version + canonical E.164)` plus key version. Raw input and canonical E.164 must never be logged, audited, used directly as a persisted rate-limit key, or returned by invitation APIs. Formatting variants normalize before user lookup, digest derivation, idempotency payloads, and phone-keyed abuse counters, preventing duplicate identities and formatting-based limit bypass.

Phone validity and OTP delivery capability are separate. The local fake OTP provider has no country allow-list. Any future SMS provider with coverage limits must report a delivery capability result such as `OTP_DELIVERY_REGION_UNSUPPORTED`; it must not redefine a valid global phone as `INVALID_PHONE`.

Run `npm run phone:preflight` before any future phone-policy data migration. It emits only total, valid, invalid, and collision counts and exits nonzero on any invalid row or canonical collision.
