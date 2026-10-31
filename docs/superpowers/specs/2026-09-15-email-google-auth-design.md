# Masari Email, Password, and Google Authentication Design

## Status

Approved for planning on 2026-09-15. It authorizes neither implementation, PR creation, merge, deployment, nor real-data access.

## Final rulings

- Email is the primary login identifier; phone/password login is removed.
- Phone remains real normalized E.164 contact/profile data; no placeholder or generated numbers.
- New email/password or Google users are created only after effective Terms, Privacy, and adult-attestation consent are transactionally recorded.
- Google creates passengers only. It never creates/promotes driver, merchant, or admin accounts.
- Google is keyed by provider plus provider_subject. Email never silently links or resolves accounts.
- active account_status permits authentication only. phone_required profile_state is server-enforced and blocks product access.
- Existing google_sub is backfilled but retained through this first migration. Removing it requires a separate approval and rehearsal.

## Audit baseline

origin/production-readiness at 4756ae7 already has email/password, nullable phone/password fields, User.google_sub, Google ID-token validation, and robust server-managed session/security-version/status checks. It is not safe to ship: Google currently looks up google_sub OR email and links by email, registration bypasses consent, there is no server profile-state gate, email verification/reset/set are absent, and Admin Web still submits phone/password.

## Final Prisma model

~~~prisma
enum ProfileState { phone_required complete }
enum ExternalIdentityProvider { google }
enum AuthActionPurpose {
  email_verification password_reset password_set email_change
  google_registration phone_verification
}

model User {
  id                  String @id @default(cuid())
  name                String
  phone               String? @unique @db.VarChar(32)
  phone_verified_at   DateTime?
  email               String? @unique @db.VarChar(191)
  email_verified_at   DateTime?
  password_hash       String?
  profile_state       ProfileState @default(phone_required)
  role                UserRole
  account_status      AccountStatus @default(active)
  security_version    Int @default(1)
  // Existing fields and relations remain.
  external_identities ExternalIdentity[]
  auth_action_tokens  AuthActionToken[]
}

model ExternalIdentity {
  id                      String @id @default(cuid())
  user_id                 String
  provider                ExternalIdentityProvider
  provider_subject        String @db.VarChar(191)
  provider_email_snapshot String? @db.VarChar(191)
  created_at              DateTime @default(now())
  updated_at              DateTime @updatedAt
  last_authenticated_at   DateTime?
  user User @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@unique([provider, provider_subject])
  @@unique([user_id, provider])
  @@index([user_id])
  @@map("external_identities")
}

model AuthActionToken {
  id                String @id @default(cuid())
  purpose           AuthActionPurpose
  user_id           String?
  subject_digest    String? @db.Char(64)
  token_digest      String @unique @db.Char(64)
  token_key_version Int
  payload           Json?
  expires_at        DateTime
  consumed_at       DateTime?
  created_at        DateTime @default(now())
  user User? @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@index([purpose, expires_at, consumed_at])
  @@index([user_id, purpose, expires_at])
  @@map("auth_action_tokens")
}
~~~

AuthActionToken stores only keyed digests and minimal purpose-bound payload. It never stores raw Google ID/access/refresh tokens, passwords, or raw Google profile data.

## Exact migration/backfill

1. Inventory a sanitized production-schema copy by email, phone, google_sub, role, status, and session.
2. Add the schema above, audit actions, and indexes in a new forward-only migration. Never edit historical migrations.
3. Backfill each non-null users.google_sub to ExternalIdentity(provider=google, provider_subject=google_sub). Abort on duplicate subject, orphan, or contradiction; never select an owner automatically.
4. Validate counts, checksums, foreign keys, indexes, and login/session parity. Retain google_sub as a dual-read fallback.
5. Release code that reads ExternalIdentity first and writes only it.
6. Remove google_sub only after separately approved zero-fallback evidence and another rehearsal.

Legacy users missing email receive no inferred email and no phone/password endpoint. Live legacy sessions may enroll/verify email; logged-out users need approved real-phone recovery or audited support proof.

## Registration state machine

~~~text
unidentified
  -> email_proof_pending | google_provider_verified
  -> legal_consent_present
  -> account_created(active, phone_required)
  -> restricted_masari_session
  -> phone_verification_pending
  -> profile_state=complete
  -> full_product_access
~~~

The final transaction consumes a one-time opaque token, rechecks exact effective legal documents, creates User plus Google ExternalIdentity when applicable, writes consents, and creates a normal Masari session. No user is created before consent.

## Exact API contracts

All routes live under /api/v1. Errors remain { error, request_id }. Final session responses retain current safe session/user shape and mobile refresh behavior.

| Route | Request | Response/behavior |
|---|---|---|
| GET /auth/capabilities | none | email/password availability, Google mobile mode/admin availability, phone verification availability; no secrets or allowlist |
| POST /auth/mobile/login | {email,password,device_name} | active verified-email password account gets mobile session |
| POST /auth/mobile/register/start | {name,email,password,locale} | 202 {registration_token,expires_at,next_action:"verify_email"}; no user |
| POST /auth/mobile/register/complete | {registration_token,email_verification_token,locale,consents,adult_self_attestation:true,device_name} | 201 restricted passenger session; serializable consent/account/session write |
| POST /auth/mobile/google | {id_token,device_name} | linked identity gets session; unknown allowed identity gets registration token; email collision returns explicit_link_required and no session |
| POST /auth/mobile/google/complete-registration | {registration_token,name,locale,consents,adult_self_attestation:true,device_name} | 201 restricted passenger session after atomic User/ExternalIdentity/consent/session; name is entered/confirmed on the consent screen, not retained from the raw Google profile |
| POST /auth/admin/login | {email,password,device_name} | active verified-email admin only; no refresh |
| POST /auth/admin/google | {id_token,device_name} | existing linked active Admin only; no email lookup/create/link/promotion |
| POST /auth/identities/google/link | current session + fresh reauth + {id_token} | explicit link only; subject unique |
| POST /auth/email/verify/start and confirm | purpose payload | high-entropy one-time hashed action |
| POST /auth/password/reset/start and confirm | email / action+password | start always 202; confirm revokes sessions and increments security version |
| POST /auth/password/set | current session + fresh reauth + password | supports passwordless accounts; revokes other sessions |
| POST /profile/phone/start-verification and confirm-verification | phone / challenge+code | provider verification writes unique E.164 phone and profile_state=complete |

## Profile-state enforcement

Add requireCompleteProfile immediately after requireAuth. It guards every passenger request/assignment/trip path, merchant order path, driver availability/route/offer path, matching path, and future operational route. phone_required always receives 403 profile_incomplete.

Only me, auth/session management, consent display, capabilities, and profile/phone routes are allowed with phone_required. Client navigation is UX only, never authorization.

## Email/password and phone proof

Registration starts a single-use email proof through an injected approved email provider. Completion requires proof plus the exact effective consents and writes bcrypt password hash. Reset start is non-enumerating 202; reset confirmation consumes the action, changes password, revokes all sessions, increments security_version, and requires new login. Password set for Google-only users requires fresh session plus verified-email reauthentication.

Phone proof uses an injected production provider, rate-limited opaque challenges, digest-only persistence, transactional E.164 uniqueness check, phone_verified_at, and audit evidence. Fake phone providers are forbidden in staging/production.

## Google/link/collision/Admin behavior

Backend verifies RS256 signature, Google issuer, expiry, endpoint-specific audience, sub, and verified email for new signup. Admin accepts only GOOGLE_ADMIN_WEB_CLIENT_ID. Mobile accepts only GOOGLE_MOBILE_SERVER_CLIENT_ID; Android is separately registered by package and signing certificate. Client secrets never enter source, Flutter, Vite, logs, or demo config.

A linked subject signs in even when snapshot email changes. Unknown subject plus matching Masari email returns explicit_link_required; it never links. Linking needs current session and fresh password reauthentication for password users or verified-email reauthentication for passwordless users. Claimed subject is a neutral conflict. Admin has no email fallback and cannot create, link, or promote.

## Rollout/configuration

~~~text
GOOGLE_ADMIN_WEB_CLIENT_ID=
GOOGLE_MOBILE_ANDROID_CLIENT_ID=
GOOGLE_MOBILE_SERVER_CLIENT_ID=
GOOGLE_MOBILE_IOS_CLIENT_ID=
GOOGLE_PASSENGER_SIGNUP_MODE=disabled
GOOGLE_PASSENGER_ALLOWLIST_KEY=
EMAIL_DELIVERY_PROVIDER=disabled
PHONE_VERIFICATION_PROVIDER=disabled
AUTH_ACTION_TOKEN_PEPPER=
AUTH_EMAIL_RATE_LIMIT_MAX=
AUTH_GOOGLE_RATE_LIMIT_MAX=
~~~

Mode is disabled, allowlist, or open. Local/test/demo uses dedicated fixtures. Staging/beta defaults allowlist. Production defaults disabled; open requires current Arabic/English legal releases, approved email/phone providers, rate-limit storage, rehearsal evidence, and release approval. PUBLIC_ONBOARDING_ENABLED remains separate invitation/fake-OTP policy.

## Threat model and test matrix

| Threat | Control |
|---|---|
| Forged/wrong-audience/expired Google token | server validation: signature, RS256, issuer, expiry, route audience |
| Token replay/leakage | HTTPS, redacted logs, single-use keyed-digest actions, atomic consume |
| Email-match takeover | no email linking/resolution |
| Link takeover | explicit action, current session, fresh reauth, unique subject |
| Privilege escalation | active linked-admin endpoint only; no auto-create/promotion |
| Disabled bypass | existing status/session/security-version controls |
| Enumeration/abuse | generic response plus IP and HMAC-normalized email/subject buckets |
| Duplicate signup | serializable transaction + unique indexes |
| Legal bypass | exact effective documents rechecked in completion transaction |

Tests cover Google verification failures; missing email; collisions; all rollout modes; parallel signup; every role/status; linking; reset/set; phone uniqueness; every protected router; Arabic/English RTL/LTR/accessibility; migration duplicate failure/counts/checksums; and rollback-before-cutover.

## Migration rehearsal

Use only an isolated disposable MySQL database restored from a sanitized production-schema snapshot. Record before/after row counts and checksums; apply schema; dry-run and write backfill; validate indexes/foreign keys; run auth/session integration tests; restore snapshot; record timing, locks, rollback point, and exceptions. Never point to real Masari.

## Ready state

READY_FOR_IMPLEMENTATION. Production rollout remains blocked until approved email/phone delivery providers and a disposable rehearsal database exist.
