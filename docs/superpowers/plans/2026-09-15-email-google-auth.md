# Email, Password, and Google Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement consent-gated email/password and Google authentication for mobile and linked-admin-only Google sign-in.

**Architecture:** ExternalIdentity owns provider identity; digest-only AuthActionToken handles proof, reset, registration, and phone confirmation. Existing Masari server-managed session/status/security-version controls remain authoritative.

**Tech Stack:** Express 5, TypeScript, Prisma/MySQL, Vitest, React/Vite, Flutter/Riverpod, Google maintained Node verification, official Flutter Google tooling.

**Spec:** docs/superpowers/specs/2026-09-15-email-google-auth-design.md

## Global Constraints

- Do not touch Card 7, real data, historical migrations, security branch, PRs, merges, or deployment.
- No production code before the relevant focused test has failed for the expected missing behavior.
- Email only for password login; never implicit email linking.
- Self-service accounts are post-consent passengers only.
- Server-side profile middleware protects all operational flows.
- Persist no raw Google credential/profile data.
- Rollout is disabled, allowlist, open; production starts disabled.

---

### Task 1: Disposable migration-rehearsal guard

**Files:** Create scripts/auth-migration-rehearsal.mjs and apps/api/src/tests/authMigrationRehearsal.test.ts. Modify package.json.

**Produces:** npm run test:integration:auth-migration, which rejects non-disposable database names.

- [ ] **Step 1: Write failing test**

~~~ts
it('rejects a non-disposable rehearsal database', async () => {
  await expect(runAuthMigrationRehearsal({ database: 'masari' }))
    .rejects.toThrow('disposable_database_required');
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm run test -w @masari/api -- authMigrationRehearsal.test.ts

Expected: FAIL because the rehearsal harness is absent.

- [ ] **Step 3: Implement minimum guard**

~~~ts
export function assertDisposableDatabase(name: string) {
  if (!/^masari_auth_rehearsal_[a-z0-9_]+$/.test(name)) {
    throw new Error('disposable_database_required');
  }
}
~~~

- [ ] **Step 4: Verify GREEN**

Run: npm run test -w @masari/api -- authMigrationRehearsal.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add scripts/auth-migration-rehearsal.mjs apps/api/src/tests/authMigrationRehearsal.test.ts package.json
git commit -m "test: guard auth migration rehearsal"
~~~

### Task 2: External identity/profile schema and backfill

**Files:** Modify apps/api/prisma/schema.prisma. Create apps/api/prisma/migrations/timestamp_external_identity_profile_state/migration.sql. Test apps/api/src/tests/authMigrationRehearsal.test.ts.

**Produces:** ProfileState, ExternalIdentity, AuthActionToken, and legacy google_sub backfill.

- [ ] **Step 1: Write failing migration test**

~~~ts
it('backfills google_sub without dropping it', async () => {
  const report = await runAuthMigrationRehearsal(seedLegacyGoogleUser('legacy-sub'));
  expect(report.externalIdentities).toContainEqual(
    expect.objectContaining({ provider: 'google', provider_subject: 'legacy-sub' })
  );
  expect(report.legacyGoogleSubColumnPresent).toBe(true);
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm run test -w @masari/api -- authMigrationRehearsal.test.ts

Expected: FAIL because the table/backfill is absent.

- [ ] **Step 3: Implement minimum schema/migration**

Add exact spec models/indexes, nullable transitional fields, and forward-only backfill. Duplicate subject must abort with report; no automatic user choice.

- [ ] **Step 4: Verify GREEN**

Run: npm run prisma:validate && npm run test -w @masari/api -- authMigrationRehearsal.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/api/prisma apps/api/src/tests/authMigrationRehearsal.test.ts scripts/auth-migration-rehearsal.mjs
git commit -m "feat: add external auth identity schema"
~~~

### Task 3: One-time auth actions and log redaction

**Files:** Create apps/api/src/lib/authActionTokens.ts and its test. Modify apps/api/src/config.ts and apps/api/src/lib/logger.ts.

**Produces:** issueAuthAction, consumeAuthAction, revokeAuthActions.

- [ ] **Step 1: Write failing test**

~~~ts
it('consumes a Google registration token once without persisting raw token', async () => {
  const issued = await issueAuthAction(db, googleRegistrationInput);
  await expect(consumeAuthAction(db, issued.rawToken, 'google_registration'))
    .resolves.toMatchObject({ purpose: 'google_registration' });
  await expect(consumeAuthAction(db, issued.rawToken, 'google_registration'))
    .rejects.toThrow('auth_action_invalid');
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm run test -w @masari/api -- authActionTokens.test.ts

Expected: FAIL because token primitives are absent.

- [ ] **Step 3: Implement minimum primitive**

Use AUTH_ACTION_TOKEN_PEPPER, fixed purpose/expiry, atomic consumption, and redaction for passwords, Google tokens, actions, and refresh tokens.

- [ ] **Step 4: Verify GREEN**

Run: npm run test -w @masari/api -- authActionTokens.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/api/src/lib/authActionTokens.ts apps/api/src/lib/authActionTokens.test.ts apps/api/src/config.ts apps/api/src/lib/logger.ts
git commit -m "feat: add one-time auth actions"
~~~

### Task 4: Complete-profile middleware

**Files:** Create apps/api/src/middleware/profileState.ts and apps/api/src/tests/profileState.test.ts. Modify apps/api/src/app.ts and operational router registration.

**Produces:** requireCompleteProfile returning 403 profile_incomplete.

- [ ] **Step 1: Write failing route-matrix test**

~~~ts
it.each(['/passenger/requests', '/driver/availability', '/merchant/orders', '/trips'])
('blocks a phone-required user at %s', async (path) => {
  await request(app).post(path).set(bearer(phoneRequiredUser))
    .send(validBodyFor(path)).expect(403);
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm run test -w @masari/api -- profileState.test.ts

Expected: FAIL because incomplete users reach handlers.

- [ ] **Step 3: Implement minimum middleware**

Allow only auth/session, me, capabilities, consent reads, and phone verification. Apply guard to every passenger/driver/merchant operational router.

- [ ] **Step 4: Verify GREEN**

Run: npm run test -w @masari/api -- profileState.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/api/src/middleware/profileState.ts apps/api/src/tests/profileState.test.ts apps/api/src/app.ts apps/api/src/modules
git commit -m "feat: gate product routes on complete profile"
~~~

### Task 5: Consent-gated email registration and credential recovery

**Files:** Create apps/api/src/services/emailAuth.ts and apps/api/src/tests/emailAuth.test.ts. Modify auth.ts, rateLimit.ts, config.ts.

**Produces:** email register start/complete, verify, reset, set endpoints.

- [ ] **Step 1: Write failing test**

~~~ts
it('creates no user without verified email and exact effective consents', async () => {
  const start = await request(app).post('/api/v1/auth/mobile/register/start')
    .send(validRegistration).expect(202);
  await request(app).post('/api/v1/auth/mobile/register/complete')
    .send({ registration_token: start.body.registration_token, ...missingConsent })
    .expect(400);
  expect(await prisma.user.count({ where: { email: validRegistration.email } })).toBe(0);
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm run test -w @masari/api -- emailAuth.test.ts

Expected: FAIL because baseline registration bypasses consent.

- [ ] **Step 3: Implement minimum routes**

Use injected delivery, one-time email proof, bcrypt, serializable consent/User/session write, generic reset start, and reset/set session revocation plus security-version increment.

- [ ] **Step 4: Verify GREEN**

Run: npm run test -w @masari/api -- emailAuth.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/api/src/services/emailAuth.ts apps/api/src/tests/emailAuth.test.ts apps/api/src/modules/auth.ts apps/api/src/middleware/rateLimit.ts apps/api/src/config.ts
git commit -m "feat: require verified email and consent"
~~~

### Task 6: Safe Google mobile authentication

**Files:** Create apps/api/src/lib/googleIdentity.ts and apps/api/src/tests/googleAuth.test.ts. Modify auth.ts, config.ts, rateLimit.ts, apps/api/package.json.

**Produces:** subject-only Google lookup and consent-gated passenger signup.

- [ ] **Step 1: Write failing collision test**

~~~ts
it('does not link an unknown Google subject by matching local email', async () => {
  await seedPasswordUser({ email: 'owner@example.com' });
  await request(app).post('/api/v1/auth/mobile/google')
    .send(googleCredential({ sub: 'new-sub', email: 'owner@example.com' }))
    .expect(409);
  expect(await prisma.externalIdentity.count()).toBe(0);
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm run test -w @masari/api -- googleAuth.test.ts

Expected: FAIL because baseline resolves by email.

- [ ] **Step 3: Implement minimum flow**

Use maintained Google verifier, route-specific audience, subject-only lookup, verified email for new signup, one-time registration action, serializable completion, and disabled/allowlist/open eligibility.

- [ ] **Step 4: Verify GREEN**

Run: npm run test -w @masari/api -- googleAuth.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/api/src/lib/googleIdentity.ts apps/api/src/tests/googleAuth.test.ts apps/api/src/modules/auth.ts apps/api/src/config.ts apps/api/src/middleware/rateLimit.ts apps/api/package.json package-lock.json
git commit -m "feat: add safe Google passenger auth"
~~~

### Task 7: Explicit linking, phone verification, legacy enrollment

**Files:** Create phoneVerification.ts plus identityLinking and phoneVerification tests. Modify auth.ts, app.ts, config.ts.

**Produces:** explicit Google link and verified-phone completion.

- [ ] **Step 1: Write failing test**

~~~ts
it('unlocks operations only after verified phone completion', async () => {
  await confirmPhone(phoneRequiredSession, validChallenge);
  await request(app).post('/api/v1/passenger/requests')
    .set(bearer(phoneRequiredSession)).send(validRequest).expect(201);
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm run test -w @masari/api -- phoneVerification.test.ts identityLinking.test.ts

Expected: FAIL because no verified-phone transition exists.

- [ ] **Step 3: Implement minimum actions**

Persist only challenge digests, atomically check E.164 uniqueness/set complete state, require fresh password or verified-email reauth for linking, and keep logged-out legacy recovery disabled without approved provider.

- [ ] **Step 4: Verify GREEN**

Run: npm run test -w @masari/api -- phoneVerification.test.ts identityLinking.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/api/src/services/phoneVerification.ts apps/api/src/tests/identityLinking.test.ts apps/api/src/tests/phoneVerification.test.ts apps/api/src/modules/auth.ts apps/api/src/app.ts apps/api/src/config.ts
git commit -m "feat: add linking and phone completion"
~~~

### Task 8: Strict Admin Web authentication

**Files:** Create apps/api/src/tests/adminAuth.test.ts and Admin Google button/test. Modify Admin App, API client, config, translations, styles, and auth.ts.

**Produces:** admin email/password and linked-admin-only Google login.

- [ ] **Step 1: Write failing test**

~~~ts
it('rejects non-admin credentials before an admin session exists', async () => {
  await request(app).post('/api/v1/auth/admin/login').send(passengerCredentials).expect(401);
  expect(await prisma.authSession.count({ where: { user_id: passenger.id } })).toBe(0);
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm run test -w @masari/api -- adminAuth.test.ts && npm run test -w @masari/admin -- GoogleSignInButton.test.tsx

Expected: FAIL because strict endpoint/UI are absent.

- [ ] **Step 3: Implement minimum endpoint/UI**

Accept active linked Admin subject only for Google, remove phone fields, show Google only through capabilities, and cover Arabic/English, RTL/LTR, focus, loading, cancellation, unavailable state.

- [ ] **Step 4: Verify GREEN**

Run: npm run test -w @masari/api -- adminAuth.test.ts && npm run test -w @masari/admin -- GoogleSignInButton.test.tsx

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/admin/src apps/api/src/tests/adminAuth.test.ts apps/api/src/modules/auth.ts
git commit -m "feat: add strict Admin email Google auth"
~~~

### Task 9: Flutter authentication and restricted-profile UX

**Files:** Create phone verification screen and Google/profile tests. Modify Flutter auth, configuration, router, l10n, and dependencies.

**Produces:** official Google credential use, consent completion, and restricted-profile routing.

- [ ] **Step 1: Write failing widgets**

~~~dart
testWidgets('hides Google when capability is disabled', (tester) async {
  await pumpLogin(capabilities: disabledGoogle);
  expect(find.byKey(const ValueKey('googleSignInButton')), findsNothing);
});
testWidgets('routes phone-required account to verification', (tester) async {
  await pumpAuthenticated(profileState: ProfileState.phoneRequired);
  expect(find.byType(PhoneVerificationScreen), findsOneWidget);
});
~~~

- [ ] **Step 2: Verify RED**

Run: cd apps/mobile && flutter test test/google_auth_flow_test.dart test/profile_completion_test.dart

Expected: FAIL because capability/profile flow is absent.

- [ ] **Step 3: Implement minimum client flow**

Use official Google tooling, persist only Masari tokens, show consent before completion, and keep restricted accounts off product navigation.

- [ ] **Step 4: Verify GREEN**

Run: cd apps/mobile && flutter test test/google_auth_flow_test.dart test/profile_completion_test.dart

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add apps/mobile
git commit -m "feat: add mobile email Google phone-completion auth"
~~~

### Task 10: Rollout controls, rehearsal, and full regression

**Files:** Create rollout/threat-model docs. Modify API config tests, environment templates, auth/session/onboarding documentation.

**Produces:** enforceable disabled/allowlist/open policy and migration evidence.

- [ ] **Step 1: Write failing config test**

~~~ts
it('rejects open Google signup in production without legal releases and approved providers', () => {
  expect(() => createConfig(productionOpenGoogleWithoutProviders))
    .toThrow('google_signup_prerequisite_missing');
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm run test -w @masari/api -- config.test.ts

Expected: FAIL because prerequisites are absent.

- [ ] **Step 3: Implement minimum controls/docs**

Require legal/provider/rehearsal preconditions, HMAC allowlist, rate limits, redacted logs, disposable rehearsal, rollback-before-cutover, and separate google_sub-removal approval criteria.

- [ ] **Step 4: Verify GREEN/full regression**

Run: npm run test -w @masari/api && npm run test -w @masari/admin && cd apps/mobile && flutter test && cd ../.. && npm run test:integration:auth-migration

Expected: all suites PASS; rehearsal uses only disposable database.

- [ ] **Step 5: Commit**

~~~bash
git add docs apps/api/src apps/api/.env.example scripts
git commit -m "docs: add email Google auth rollout controls"
~~~

## Plan self-review

Tasks 2-3 cover schema/backfill/token safety; 4 profile gate; 5 email/password; 6 Google; 7 linking/phone/legacy; 8 Admin; 9 Flutter; 10 rollout/rehearsal. Every task begins with a focused observed RED test and ends green plus commit. Do not execute this plan without explicit instruction.

