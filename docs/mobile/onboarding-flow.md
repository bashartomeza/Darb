# Mobile onboarding flow

M6C2C adds the Flutter client for the existing M6C2B2 controlled public onboarding backend.

The mobile entry is feature-gated by `GET /api/v1/onboarding/config`. When the backend reports `enabled=false`, the login screen hides registration and pending-status recovery. Direct navigation to onboarding shows a safe unavailable state and returns to normal sign-in.

When enabled in local/demo only, the Arabic-first flow is:

1. Select a server-supported role: passenger, driver, or merchant.
2. Enter invitation code and a valid international phone number beginning with `+`.
3. Start the attempt with the canonical global phone policy, current locale, and an idempotency key. The current mobile UI does not guess a country or send an implicit region.
4. Store only the continuation token, attempt ID, masked phone, expiry, resend time, role, and locale.
5. Enter OTP manually. The app never reads fake OTP outbox data.
6. Verify OTP and store the returned registration grant securely.
7. Load the approved consent documents for the current locale.
8. Collect display name, password, confirmation, and the three required acceptances.
9. Complete registration.
10. Passenger accounts return to normal login. Driver and merchant accounts move to pending review.

Every entry revalidates feature availability. A transient config/network
failure hides entry actions but preserves a valid secure continuation or
pending bundle; an authoritative `enabled=false` clears it. Process restoration
queries server status before choosing OTP, account-details, pending, approved,
or unavailable UI. A valid operational session clears stale onboarding state
and always wins routing precedence.

The mobile app does not issue or fabricate an operational session after registration. Existing login, refresh, logout, and role routing remain the only operational-auth path.
