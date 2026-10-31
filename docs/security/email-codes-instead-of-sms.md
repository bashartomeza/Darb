# One-time codes by email instead of SMS

Decision (owner): Masari does not use SMS, in demo or production. Every code that used to be texted is emailed through the existing SMTP delivery (`EMAIL_DELIVERY=smtp`, `smtpEmailDelivery.ts`). Setting `OTP_PROVIDER=email` selects this behaviour; SMTP is the only delivery requirement for go-live.

## What goes by email

| Flow | Where the code goes |
| --- | --- |
| Invited sign-up (passenger, driver, merchant) | The `contact_email` the Admin entered with the invitation. The applicant never types an address. |
| Open driver / shop-owner sign-up | The email the applicant types in the first step (stored on the attempt as `delivery_email`). |
| Phone step after email sign-up | The account's own verified email. |

Messages are bilingual (EN and AR), show only the six-digit code and "the code expires in N minutes", and contain no link. Every existing safeguard is unchanged: attempt caps, resend cooldown and resend cap, keyed code digests, no code in logs or API responses. The daily send cap (`OTP_MAX_SENDS_PER_PHONE_DAY`) is counted per phone and, separately, per receiving email address. Open sign-up also has a per-email start cap.

## Trade-off: an email proves the mailbox, not the phone

Receiving a code at an email address proves control of that mailbox. It does not prove control of the phone number typed next to it. The safe minimum:

1. **Admin invitation: the phone is trusted.** The Admin vouches for the phone and email pair, and the applicant must present the invitation code and the exact invited phone. The account is created with `phone_verified_at` set, so phone sign-in works as before. The proven email also becomes the account's verified email.
2. **Open sign-up and the phone step after email sign-up: the phone is unverified.** The account stores the phone but leaves `phone_verified_at` empty. Phone sign-in is refused for any account without `phone_verified_at` (existing rule in `/auth/login`), so an unverified phone can never be used as a sign-in identity; those users sign in with their verified email. An open applicant's proven email is stored as the verified email so they can sign in.
3. **No account can take another account's phone.** Phone numbers stay unique. Confirming a phone already owned by another account answers `phone_already_in_use` (profile step) or `registration_conflict` (onboarding), and an email already used by another account is refused the same way at the end of open sign-up.

Provider flag: the fake provider (demo, tests) simulates SMS and keeps `provesPhone` true; the email providers set it to false, which is what switches the stored phone to unverified.

Residual risks (accepted, to be revisited if the product needs phone-verified behaviour such as calling or SMS-only recovery): an unverified number can be squatted by someone who registers it first through open sign-up (driver and merchant accounts still pass Admin review, and the squatter cannot sign in by phone); the Admin can resolve a disputed number by contacting the real owner. A later release can add a real phone proof without changing these flows.

## Operations

- Invitations created before this change have no contact email; they can be verified only with the fake provider. Re-issue them with an email when `OTP_PROVIDER=email`.
- `OTP_PROVIDER=email` without `EMAIL_DELIVERY=smtp` is refused at startup; the preflight script checks the same.
- If SMTP is down the start/resend answers "verification temporarily unavailable" and the applicant retries; nothing is lost.
- Migration `20261029200000_email_otp_contact` adds two nullable columns (`invitations.contact_email`, `onboarding_attempts.delivery_email`).
