# Mobile email and Google authentication

Email/password login uses `POST /auth/mobile/login`. Phone is contact/profile data. New accounts always use the passenger role; invited driver and merchant onboarding remains separate.

## Registration

- Email: `/auth/mobile/register/start` returns a short-lived registration envelope and emails a verification token. The app stores the envelope only in memory. It displays the current three legal documents from `/auth/consents?locale=ar|en`. The user supplies the email token and explicitly accepts every document before `/auth/mobile/register/complete`.
- Google: the official `google_sign_in` tooling supplies a transient ID token to `/auth/mobile/google`. An existing linked identity receives a Masari session. An unknown identity receives a registration envelope, then requires name and legal acceptance at `/auth/mobile/google/complete-registration`. Email collisions direct the user to their existing account and explicit linking.
- Cancel/restart discards the envelope. No Google profile, Google credential, password, or pre-consent registration grant is written to application storage. Only the existing secure Masari token bundle persists.
- If a legal release changes while accepting it, the app reloads documents and clears acceptance.

## Profile completion and recovery

The API is the authorization authority. New passenger accounts are created with `profile_state` `complete`, so a signed-in user opens product routes immediately; product deep links stay blocked only while a session is unauthenticated.

Login offers password reset and email verification. The account security screen offers password set/change and explicit Google linking, requiring current password or emailed reauthentication proof. Proofs can be pasted from delivery messages. Password changes revoke sessions and return to login.

All new screens inherit Arabic/English locale and RTL/LTR layout, expose labeled controls and errors through live regions, disable duplicate submission, and move focus to proof input after delivery.

## Google configuration

The existing build defines are `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_SERVER_CLIENT_ID`, and optional `GOOGLE_IOS_CLIENT_ID`. Configure the mobile audience separately from Admin. Server `GOOGLE_MOBILE_SERVER_CLIENT_ID` must match the token audience. The Google button is hidden unless both platform configuration and `/auth/capabilities.google_mobile_login_available` allow it; capability errors fail closed.

Server rollout `GOOGLE_PASSENGER_SIGNUP_MODE=disabled|allowlist|open` controls first registrations. An enabled login button does not imply signup permission. The server makes the eligibility decision without exposing allowlist members.

## Verification

Run `flutter test` and `flutter analyze`. Tests cover endpoint contracts, no session before consent, email/Google consent completion, recovery entry points, and Arabic/English directionality. Google credential issuance and real email/SMS delivery still require the disposable QA environment and configured provider/client credentials.
