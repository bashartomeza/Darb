# Mobile onboarding secure state

Onboarding state is stored separately from operational authentication.

Secure storage keys:

- `darb_auth_bundle_v1`: operational access/refresh session bundle.
- `darb_jwt`: legacy operational access token.
- `darb_onboarding_bundle_v1`: onboarding-only bundle.

The onboarding bundle is versioned and fail-closed. Corrupt, unsupported,
incomplete, mixed-purpose, illegal-stage, or expired bundles are cleared.
Pending-status bundles cannot contain continuation/grant credentials, and
continuation bundles cannot contain pending-status credentials.

Allowed stored fields:

- bundle version and workflow type;
- safe stage;
- selected role;
- locale;
- attempt ID for continuation;
- continuation token and expiry;
- registration grant and expiry after OTP verification;
- pending-status token and expiry;
- masked phone;
- resend availability time;
- safe idempotency metadata if needed for recovery.

Continuation, registration-grant, and pending-status expiries come from
additive API response fields representing the actual server session/grant
records. The client does not invent a local token lifetime. On restoration it
revalidates the credential with `/api/v1/onboarding/status` before exposing a
resumable stage.

Never stored:

- raw invitation code;
- OTP;
- password;
- raw phone;
- full authorization header;
- provider details;
- fake OTP outbox data;
- operational JWT or refresh token inside the onboarding bundle.

Token rotation follows a crash-consistent order: validate response, construct a
complete replacement bundle, write it to secure storage, verify the workflow
generation is still current, then publish controller state. A storage failure
does not publish the new stage, and clearing/authenticating invalidates any
late onboarding response.
