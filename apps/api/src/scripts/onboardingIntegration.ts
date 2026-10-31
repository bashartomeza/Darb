import { createHash } from "node:crypto";
import { config } from "../config.js";
import { consumeAbuseCounter } from "../lib/abuseCounters.js";
import { claimIdempotency, completeIdempotency } from "../lib/idempotency.js";
import { recordConsent } from "../lib/consents.js";
import { createInvitation, consumeInvitation, revokeInvitation } from "../lib/invitations.js";
import { abuseSubjectDigest, idempotencyKeyDigest } from "../lib/keyedDigest.js";
import { FakeOtpProvider, dispatchOtpChallenge, verifyOtpChallenge, type OtpProvider } from "../lib/otp.js";
import { consumeOnboardingSession, createOnboardingSession, revokeOnboardingSessions } from "../lib/onboardingSessions.js";
import { createOnboardingAttempt } from "../lib/onboardingAttempts.js";
import { normalizePhoneToE164 } from "../lib/phone.js";
import { prisma } from "../lib/prisma.js";
import { DEMO_ACCOUNTS } from "../modules/demoReset.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

async function main() {
  const onboarding = config.onboarding;
  assert(config.invitationsEnabled && onboarding, "Invitation foundation must be enabled for integration validation");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin", demo_account: true } });
  const schemaTables = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN
      ('invitations','invitation_redemptions','onboarding_attempts','otp_challenges','onboarding_sessions','consent_releases','consent_documents','user_consents','abuse_counters','idempotency_records')
  `;
  assert(Number(schemaTables[0].n) === 10, "Onboarding foundation tables are incomplete");
  const utf8Tables = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN
      ('invitations','invitation_redemptions','onboarding_attempts','otp_challenges','onboarding_sessions','consent_releases','consent_documents','user_consents','abuse_counters','idempotency_records')
      AND table_collation LIKE 'utf8mb4%'
  `;
  assert(Number(utf8Tables[0].n) === 10, "Onboarding foundation character set is not utf8mb4");
  const binaryDigestColumns = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM information_schema.columns
    WHERE table_schema = DATABASE() AND collation_name = 'ascii_bin' AND (
      (table_name = 'invitations' AND column_name IN ('code_digest', 'intended_phone_digest')) OR
      (table_name = 'onboarding_attempts' AND column_name IN ('phone_digest', 'request_ip_digest', 'registration_grant_digest')) OR
      (table_name = 'otp_challenges' AND column_name = 'code_digest') OR
      (table_name = 'onboarding_sessions' AND column_name = 'token_digest') OR
      (table_name = 'consent_documents' AND column_name = 'content_digest') OR
      (table_name = 'user_consents' AND column_name = 'ip_digest') OR
      (table_name = 'abuse_counters' AND column_name = 'subject_digest') OR
      (table_name = 'idempotency_records' AND column_name IN ('scope_digest', 'idempotency_key', 'request_digest'))
    )
  `;
  assert(Number(binaryDigestColumns[0].n) === 13, "Keyed digest columns are not byte-collated");
  const phone = normalizePhoneToE164("0590000001", { region: "PS" });

  const { invitation } = await createInvitation(prisma, {
    createdById: admin.id,
    intendedRole: "passenger",
    intendedPhone: phone,
    phoneRegion: "PS",
    expiresAt: new Date(Date.now() + 86_400_000),
    keys: { code: onboarding.keys.invitationCode, phone: onboarding.keys.phoneDigest }
  });
  for (const mismatch of [
    { intendedRole: "driver" as const, phone },
    { intendedRole: "passenger" as const, phone: "+970590000002" }
  ]) {
    let rejected = false;
    try {
      await createOnboardingAttempt(prisma, {
        invitationId: invitation.id,
        intendedRole: mismatch.intendedRole,
        phone: mismatch.phone,
        phoneKey: onboarding.keys.phoneDigest,
        expiresAt: new Date(Date.now() + 1_800_000)
      });
    } catch {
      rejected = true;
    }
    assert(rejected, "Mismatched invitation role or phone created an onboarding attempt");
  }
  const attempt = await createOnboardingAttempt(prisma, {
    invitationId: invitation.id,
    intendedRole: "passenger",
    phone,
    phoneKey: onboarding.keys.phoneDigest,
    expiresAt: new Date(Date.now() + 1_800_000),
    requestId: "integration-attempt"
  });

  const unrelatedInvite = await createInvitation(prisma, {
    createdById: admin.id,
    intendedRole: "passenger",
    intendedPhone: phone,
    phoneRegion: "PS",
    expiresAt: new Date(Date.now() + 86_400_000),
    keys: { code: onboarding.keys.invitationCode, phone: onboarding.keys.phoneDigest }
  });
  const mismatchedConsumption = await consumeInvitation(prisma, {
    invitationId: unrelatedInvite.invitation.id,
    onboardingAttemptId: attempt.id
  });
  assert(!mismatchedConsumption.consumed, "Invitation was consumed by an attempt bound to another invitation");
  const unredeemedAttempt = await createOnboardingAttempt(prisma, {
    invitationId: unrelatedInvite.invitation.id,
    intendedRole: "passenger",
    phone,
    phoneKey: onboarding.keys.phoneDigest,
    expiresAt: new Date(Date.now() + 1_800_000)
  });
  let unredeemedDispatchRejected = false;
  try {
    await dispatchOtpChallenge(prisma, new FakeOtpProvider(), {
      attemptId: unredeemedAttempt.id,
      key: onboarding.keys.otpCode,
      ttlSeconds: onboarding.otpTtlSeconds,
      maxAttempts: onboarding.otpMaxAttempts
    });
  } catch (error) {
    unredeemedDispatchRejected = error instanceof Error && error.message === "otp_attempt_unavailable";
  }
  assert(unredeemedDispatchRejected, "Unredeemed invitation attempt dispatched an OTP");
  const singleAttemptInvite = await createInvitation(prisma, {
    createdById: admin.id,
    intendedRole: "passenger",
    intendedPhone: phone,
    phoneRegion: "PS",
    expiresAt: new Date(Date.now() + 86_400_000),
    keys: { code: onboarding.keys.invitationCode, phone: onboarding.keys.phoneDigest }
  });
  const concurrentAttemptResults = await Promise.allSettled(Array.from({ length: 8 }, () =>
    createOnboardingAttempt(prisma, {
      invitationId: singleAttemptInvite.invitation.id,
      intendedRole: "passenger",
      phone,
      phoneKey: onboarding.keys.phoneDigest,
      expiresAt: new Date(Date.now() + 1_800_000)
    })
  ));
  assert(concurrentAttemptResults.filter((result) => result.status === "fulfilled").length === 1,
    "One-use invitation created more than one onboarding attempt");

  const redemptionResults = await Promise.all(
    Array.from({ length: 12 }, () => consumeInvitation(prisma, { invitationId: invitation.id, onboardingAttemptId: attempt.id }))
  );
  assert(redemptionResults.filter((result) => result.consumed).length === 1, "Concurrent invitation redemption was not single-use");

  const raceInvite = await createInvitation(prisma, {
    createdById: admin.id, intendedRole: "driver", intendedPhone: "+970590000002", phoneRegion: "PS",
    expiresAt: new Date(Date.now() + 86_400_000), keys: { code: onboarding.keys.invitationCode, phone: onboarding.keys.phoneDigest }
  });
  const raceAttempt = await createOnboardingAttempt(prisma, {
    invitationId: raceInvite.invitation.id, intendedRole: "driver", phone: "+970590000002",
    phoneKey: onboarding.keys.phoneDigest, expiresAt: new Date(Date.now() + 1_800_000)
  });
  await Promise.allSettled([
    consumeInvitation(prisma, { invitationId: raceInvite.invitation.id, onboardingAttemptId: raceAttempt.id }),
    revokeInvitation(prisma, { invitationId: raceInvite.invitation.id, revokedById: admin.id, reason: "integration race" })
  ]);
  const raceFinal = await prisma.invitation.findUniqueOrThrow({ where: { id: raceInvite.invitation.id } });
  assert((raceFinal.used_count === 1) !== Boolean(raceFinal.revoked_at), "Invitation use/revoke race produced an invalid terminal state");

  const acceptedProvider = new FakeOtpProvider();
  const first = await dispatchOtpChallenge(prisma, acceptedProvider, {
    attemptId: attempt.id,
    key: onboarding.keys.otpCode,
    ttlSeconds: onboarding.otpTtlSeconds,
    maxAttempts: onboarding.otpMaxAttempts,
    maxResends: onboarding.otpMaxResends,
    resendCooldownSeconds: onboarding.otpResendCooldownSeconds
  });
  assert(first.accepted, "Fake OTP acceptance failed");
  const code = [...acceptedProvider.outbox.values()][0];
  assert(code && /^\d{6}$/.test(code), "Fake OTP outbox did not retain a six-digit code");
  const rejected = await dispatchOtpChallenge(prisma, new FakeOtpProvider("rejected"), {
    attemptId: attempt.id,
    key: onboarding.keys.otpCode,
    ttlSeconds: onboarding.otpTtlSeconds,
    maxAttempts: onboarding.otpMaxAttempts,
    maxResends: onboarding.otpMaxResends,
    resendCooldownSeconds: onboarding.otpResendCooldownSeconds,
    now: new Date(Date.now() + (onboarding.otpResendCooldownSeconds + 1) * 1000)
  });
  assert(!rejected.accepted, "Rejected OTP provider result was accepted");
  const afterReject = await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  assert(afterReject.current_challenge_id === first.challengeId, "Rejected resend invalidated the prior challenge");

  const verificationResults = await Promise.all(
    Array.from({ length: 12 }, () => verifyOtpChallenge(prisma, { attemptId: attempt.id, code, key: onboarding.keys.otpCode }))
  );
  assert(verificationResults.filter((result) => result.verified).length === 1, "Concurrent OTP verification was not single-consume");

  const resendInvite = await createInvitation(prisma, {
    createdById: admin.id, intendedRole: "passenger", intendedPhone: phone, phoneRegion: "PS",
    expiresAt: new Date(Date.now() + 86_400_000), keys: { code: onboarding.keys.invitationCode, phone: onboarding.keys.phoneDigest }
  });
  const resendAttempt = await createOnboardingAttempt(prisma, {
    invitationId: resendInvite.invitation.id, intendedRole: "passenger", phone,
    phoneKey: onboarding.keys.phoneDigest, expiresAt: new Date(Date.now() + 1_800_000)
  });
  assert((await consumeInvitation(prisma, {
    invitationId: resendInvite.invitation.id, onboardingAttemptId: resendAttempt.id
  })).consumed, "Resend-test invitation was not redeemed");
  const oldProvider = new FakeOtpProvider();
  const oldChallenge = await dispatchOtpChallenge(prisma, oldProvider, {
    attemptId: resendAttempt.id, key: onboarding.keys.otpCode, ttlSeconds: onboarding.otpTtlSeconds,
    maxAttempts: onboarding.otpMaxAttempts, maxResends: onboarding.otpMaxResends,
    resendCooldownSeconds: onboarding.otpResendCooldownSeconds
  });
  assert(oldChallenge.accepted, "Initial resend-test challenge failed");
  let cooldownEnforced = false;
  try {
    await dispatchOtpChallenge(prisma, new FakeOtpProvider(), {
      attemptId: resendAttempt.id, key: onboarding.keys.otpCode, ttlSeconds: onboarding.otpTtlSeconds,
      maxAttempts: onboarding.otpMaxAttempts, maxResends: onboarding.otpMaxResends,
      resendCooldownSeconds: onboarding.otpResendCooldownSeconds
    });
  } catch (error) {
    cooldownEnforced = error instanceof Error && error.message === "otp_resend_cooldown";
  }
  assert(cooldownEnforced, "OTP resend cooldown was not enforced");
  const replacementProvider = new FakeOtpProvider();
  const replacement = await dispatchOtpChallenge(prisma, replacementProvider, {
    attemptId: resendAttempt.id, key: onboarding.keys.otpCode, ttlSeconds: onboarding.otpTtlSeconds,
    maxAttempts: onboarding.otpMaxAttempts, maxResends: onboarding.otpMaxResends,
    resendCooldownSeconds: onboarding.otpResendCooldownSeconds,
    now: new Date(Date.now() + (onboarding.otpResendCooldownSeconds + 1) * 1_000)
  });
  assert(replacement.accepted, "Accepted resend replacement failed");
  const oldStored = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: oldChallenge.challengeId } });
  assert(Boolean(oldStored.superseded_at), "Accepted resend did not supersede the previous challenge");
  const oldCode = [...oldProvider.outbox.values()][0];
  const replacementCode = [...replacementProvider.outbox.values()][0];
  assert(!(await verifyOtpChallenge(prisma, { attemptId: resendAttempt.id, code: oldCode, key: onboarding.keys.otpCode })).verified, "Superseded OTP remained verifiable");
  assert((await verifyOtpChallenge(prisma, { attemptId: resendAttempt.id, code: replacementCode, key: onboarding.keys.otpCode })).verified, "Accepted replacement OTP was not verifiable");

  const concurrentInvite = await createInvitation(prisma, {
    createdById: admin.id, intendedRole: "passenger", intendedPhone: phone, phoneRegion: "PS",
    expiresAt: new Date(Date.now() + 86_400_000), keys: { code: onboarding.keys.invitationCode, phone: onboarding.keys.phoneDigest }
  });
  const concurrentAttempt = await createOnboardingAttempt(prisma, {
    invitationId: concurrentInvite.invitation.id, intendedRole: "passenger", phone,
    phoneKey: onboarding.keys.phoneDigest, expiresAt: new Date(Date.now() + 1_800_000)
  });
  assert((await consumeInvitation(prisma, {
    invitationId: concurrentInvite.invitation.id, onboardingAttemptId: concurrentAttempt.id
  })).consumed, "Concurrent-resend invitation was not redeemed");
  const concurrentInitial = await dispatchOtpChallenge(prisma, new FakeOtpProvider(), {
    attemptId: concurrentAttempt.id, key: onboarding.keys.otpCode, ttlSeconds: onboarding.otpTtlSeconds,
    maxAttempts: onboarding.otpMaxAttempts, maxResends: onboarding.otpMaxResends
  });
  assert(concurrentInitial.accepted, "Concurrent resend initial challenge failed");
  let releaseProvider!: () => void;
  let providerStarted!: () => void;
  const providerStartedPromise = new Promise<void>((resolve) => { providerStarted = resolve; });
  const providerReleasePromise = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const slowProvider: OtpProvider = {
    name: "fake",
    async send() {
      providerStarted();
      await providerReleasePromise;
      return { status: "accepted", providerMessageId: "concurrent-provider-message" };
    }
  };
  const resendNow = new Date(Date.now() + (onboarding.otpResendCooldownSeconds + 1) * 1_000);
  const slowDispatch = dispatchOtpChallenge(prisma, slowProvider, {
    attemptId: concurrentAttempt.id, key: onboarding.keys.otpCode, ttlSeconds: onboarding.otpTtlSeconds,
    maxAttempts: onboarding.otpMaxAttempts, maxResends: onboarding.otpMaxResends,
    resendCooldownSeconds: onboarding.otpResendCooldownSeconds, now: resendNow
  });
  await providerStartedPromise;
  let duplicateDispatchRejected = false;
  try {
    await dispatchOtpChallenge(prisma, new FakeOtpProvider(), {
      attemptId: concurrentAttempt.id, key: onboarding.keys.otpCode, ttlSeconds: onboarding.otpTtlSeconds,
      maxAttempts: onboarding.otpMaxAttempts, maxResends: onboarding.otpMaxResends,
      resendCooldownSeconds: onboarding.otpResendCooldownSeconds, now: resendNow
    });
  } catch (error) {
    duplicateDispatchRejected = error instanceof Error && error.message === "otp_attempt_unavailable";
  }
  assert(duplicateDispatchRejected, "Concurrent OTP resend bypassed the durable dispatch claim");
  const reclaimProvider = new FakeOtpProvider();
  const reclaimedDispatch = await dispatchOtpChallenge(prisma, reclaimProvider, {
    attemptId: concurrentAttempt.id, key: onboarding.keys.otpCode, ttlSeconds: onboarding.otpTtlSeconds,
    maxAttempts: onboarding.otpMaxAttempts, maxResends: onboarding.otpMaxResends,
    resendCooldownSeconds: onboarding.otpResendCooldownSeconds,
    now: new Date(resendNow.getTime() + 121_000)
  });
  assert(reclaimedDispatch.accepted, "Stale OTP dispatch claim was not safely reclaimed");
  releaseProvider();
  const slowResult = await slowDispatch;
  assert(!slowResult.accepted && slowResult.reason === "stale_dispatch", "Late provider result replaced a newer dispatch claimant");
  const fencedAttempt = await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: concurrentAttempt.id } });
  assert(fencedAttempt.current_challenge_id === reclaimedDispatch.challengeId && fencedAttempt.status === "otp_sent",
    "Late provider result changed the current OTP challenge or attempt status");
  const staleChallenge = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: slowResult.challengeId } });
  assert(Boolean(staleChallenge.superseded_at), "Late provider result remained verifiable after claim loss");
  const reclaimedCode = [...reclaimProvider.outbox.values()][0];
  await prisma.onboardingAttempt.update({ where: { id: concurrentAttempt.id }, data: { status: "cancelled" } });
  assert(!(await verifyOtpChallenge(prisma, {
    attemptId: concurrentAttempt.id, code: reclaimedCode, key: onboarding.keys.otpCode
  })).verified, "Cancelled onboarding attempt verified an OTP");
  const unconsumedReclaimedChallenge = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: reclaimedDispatch.challengeId } });
  assert(!unconsumedReclaimedChallenge.consumed_at, "Cancelled attempt consumed its OTP challenge");
  let cancelledDispatchRejected = false;
  try {
    await dispatchOtpChallenge(prisma, new FakeOtpProvider(), {
      attemptId: concurrentAttempt.id, key: onboarding.keys.otpCode, ttlSeconds: onboarding.otpTtlSeconds,
      maxAttempts: onboarding.otpMaxAttempts
    });
  } catch (error) {
    cancelledDispatchRejected = error instanceof Error && error.message === "otp_attempt_unavailable";
  }
  assert(cancelledDispatchRejected, "Cancelled onboarding attempt dispatched another OTP");

  const lockInvite = await createInvitation(prisma, {
    createdById: admin.id, intendedRole: "passenger", intendedPhone: phone, phoneRegion: "PS",
    expiresAt: new Date(Date.now() + 86_400_000), keys: { code: onboarding.keys.invitationCode, phone: onboarding.keys.phoneDigest }
  });
  const lockAttempt = await createOnboardingAttempt(prisma, {
    invitationId: lockInvite.invitation.id, intendedRole: "passenger", phone,
    phoneKey: onboarding.keys.phoneDigest, expiresAt: new Date(Date.now() + 1_800_000)
  });
  assert((await consumeInvitation(prisma, {
    invitationId: lockInvite.invitation.id, onboardingAttemptId: lockAttempt.id
  })).consumed, "Lock-test invitation was not redeemed");
  const lockProvider = new FakeOtpProvider();
  await dispatchOtpChallenge(prisma, lockProvider, {
    attemptId: lockAttempt.id, key: onboarding.keys.otpCode, ttlSeconds: onboarding.otpTtlSeconds,
    maxAttempts: onboarding.otpMaxAttempts, maxResends: onboarding.otpMaxResends
  });
  const realLockCode = [...lockProvider.outbox.values()][0];
  const wrongCode = realLockCode === "999999" ? "000000" : "999999";
  for (let index = 0; index < onboarding.otpMaxAttempts; index += 1) {
    await verifyOtpChallenge(prisma, { attemptId: lockAttempt.id, code: wrongCode, key: onboarding.keys.otpCode });
  }
  const lockedAttempt = await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: lockAttempt.id } });
  assert(lockedAttempt.status === "locked", "OTP attempt limit did not lock the attempt");
  assert(!(await verifyOtpChallenge(prisma, { attemptId: lockAttempt.id, code: realLockCode, key: onboarding.keys.otpCode })).verified, "Locked OTP challenge remained verifiable");

  const keyDigest = idempotencyKeyDigest("onboarding-integration", "same-key", onboarding.keys.idempotency);
  const scopeDigest = idempotencyKeyDigest("onboarding-integration-scope", attempt.id, onboarding.keys.idempotency);
  const requestDigest = createHash("sha256").update("same-request").digest("hex");
  const claims = await Promise.all(
    Array.from({ length: 12 }, () => claimIdempotency(prisma, {
      operation: "onboarding-integration",
      scopeDigest,
      keyDigest,
      keyVersion: onboarding.keys.idempotency.version,
      requestDigest,
      expiresAt: new Date(Date.now() + 3_600_000)
    }))
  );
  assert(claims.filter((claim) => claim.kind === "claimed").length === 1, "Idempotency claim was not single-owner");
  const claimed = claims.find((claim) => claim.kind === "claimed")!;
  await completeIdempotency(prisma, {
    recordId: claimed.record.id,
    claimVersion: claimed.record.claim_version,
    resourceType: "OnboardingAttempt",
    resourceId: attempt.id,
    responseStatus: 201
  });
  const replay = await claimIdempotency(prisma, {
    operation: "onboarding-integration", scopeDigest, keyDigest, keyVersion: onboarding.keys.idempotency.version,
    requestDigest, expiresAt: new Date(Date.now() + 3_600_000)
  });
  assert(replay.kind === "replay" && replay.record.resource_id === attempt.id, "Idempotency replay lost its stable resource reference");
  const conflict = await claimIdempotency(prisma, {
    operation: "onboarding-integration", scopeDigest, keyDigest, keyVersion: onboarding.keys.idempotency.version,
    requestDigest: createHash("sha256").update("different-request").digest("hex"), expiresAt: new Date(Date.now() + 3_600_000)
  });
  assert(conflict.kind === "conflict", "Idempotency payload conflict was not detected");
  const staleKey = idempotencyKeyDigest("onboarding-expiry", "stale-key", onboarding.keys.idempotency);
  const staleScope = idempotencyKeyDigest("onboarding-expiry-scope", attempt.id, onboarding.keys.idempotency);
  const staleClaim = await claimIdempotency(prisma, {
    operation: "onboarding-expiry", scopeDigest: staleScope, keyDigest: staleKey,
    keyVersion: onboarding.keys.idempotency.version, requestDigest, expiresAt: new Date(Date.now() - 1_000)
  });
  assert(staleClaim.kind === "claimed", "Initial stale idempotency claim was not created");
  const reclaimed = await claimIdempotency(prisma, {
    operation: "onboarding-expiry", scopeDigest: staleScope, keyDigest: staleKey,
    keyVersion: onboarding.keys.idempotency.version,
    requestDigest: createHash("sha256").update("replacement").digest("hex"), expiresAt: new Date(Date.now() + 3_600_000)
  });
  assert(reclaimed.kind === "claimed", "Expired idempotency record was not safely reclaimable");
  assert(reclaimed.record.claim_version === staleClaim.record.claim_version + 1, "Idempotency reclaim was not version-fenced");
  let staleCompletionRejected = false;
  try {
    await completeIdempotency(prisma, {
      recordId: staleClaim.record.id,
      claimVersion: staleClaim.record.claim_version,
      resourceType: "OnboardingAttempt",
      resourceId: attempt.id,
      responseStatus: 201
    });
  } catch (error) {
    staleCompletionRejected = error instanceof Error && error.message === "idempotency_claim_lost";
  }
  assert(staleCompletionRejected, "A stale idempotency processor completed a reclaimed claim");

  const onboardingSession = await createOnboardingSession(prisma, {
    attemptId: attempt.id, key: onboarding.keys.onboardingSession, ttlSeconds: 600
  });
  const storedOnboardingSession = await prisma.onboardingSession.findUniqueOrThrow({ where: { id: onboardingSession.session.id } });
  assert(storedOnboardingSession.token_digest !== onboardingSession.token, "Raw onboarding token was stored");
  const sessionConsumes = await Promise.all(Array.from({ length: 10 }, () => consumeOnboardingSession(prisma, {
    token: onboardingSession.token, key: onboarding.keys.onboardingSession
  })));
  assert(sessionConsumes.filter(Boolean).length === 1, "Onboarding session was not single-consume");
  const revocableSession = await createOnboardingSession(prisma, {
    attemptId: attempt.id, key: onboarding.keys.onboardingSession, ttlSeconds: 600
  });
  await revokeOnboardingSessions(prisma, { attemptId: attempt.id, reason: "integration revocation" });
  assert(!(await consumeOnboardingSession(prisma, { token: revocableSession.token, key: onboarding.keys.onboardingSession })), "Revoked onboarding session remained usable");
  const expiredSession = await createOnboardingSession(prisma, {
    attemptId: attempt.id, key: onboarding.keys.onboardingSession, ttlSeconds: 1, now: new Date(Date.now() - 10_000)
  });
  assert(!(await consumeOnboardingSession(prisma, { token: expiredSession.token, key: onboarding.keys.onboardingSession })), "Expired onboarding session remained usable");
  const invalidatedSession = await createOnboardingSession(prisma, {
    attemptId: attempt.id, key: onboarding.keys.onboardingSession, ttlSeconds: 600
  });
  await prisma.onboardingAttempt.update({ where: { id: attempt.id }, data: { status: "cancelled" } });
  assert(!(await consumeOnboardingSession(prisma, {
    token: invalidatedSession.token, key: onboarding.keys.onboardingSession
  })), "Onboarding session survived cancellation of its owning attempt");
  let invalidSessionIssueRejected = false;
  try {
    await createOnboardingSession(prisma, { attemptId: attempt.id, key: onboarding.keys.onboardingSession, ttlSeconds: 600 });
  } catch (error) {
    invalidSessionIssueRejected = error instanceof Error && error.message === "onboarding_session_attempt_unavailable";
  }
  assert(invalidSessionIssueRejected, "Cancelled attempt received an onboarding session");
  await prisma.onboardingAttempt.update({ where: { id: attempt.id }, data: { status: "phone_verified" } });

  const consentDocument = await prisma.consentDocument.create({
    data: { document_type: "terms", version: "integration-v1", locale: "ar", content_digest: createHash("sha256").update("integration terms").digest("hex"), effective_at: new Date() }
  });
  let unapprovedConsentRejected = false;
  try {
    await recordConsent(prisma, { documentId: consentDocument.id, userId: admin.id, source: "integration" });
  } catch (error) {
    unapprovedConsentRejected = error instanceof Error && error.message === "consent_document_unavailable";
  }
  assert(unapprovedConsentRejected, "Consent was recorded against an unapproved legal document");
  await prisma.consentDocument.update({
    where: { id: consentDocument.id },
    data: { legal_approved_at: new Date(), legal_approved_by: "integration-review" }
  });
  await recordConsent(prisma, { documentId: consentDocument.id, userId: admin.id, source: "integration", requestId: "integration-request" });
  let duplicateConsentRejected = false;
  try { await recordConsent(prisma, { documentId: consentDocument.id, userId: admin.id, source: "integration" }); } catch { duplicateConsentRejected = true; }
  assert(duplicateConsentRejected, "Consent acceptance was not immutable and unique");
  const temporaryConsentUser = await prisma.user.create({
    data: {
      name: "Consent retention test",
      phone: "+970590009999",
      password_hash: "integration-only-unused-password-hash",
      role: "passenger",
      demo_account: true
    }
  });
  await recordConsent(prisma, {
    documentId: consentDocument.id, userId: temporaryConsentUser.id, source: "integration"
  });
  let consentCascadeBlocked = false;
  try {
    await prisma.user.delete({ where: { id: temporaryConsentUser.id } });
  } catch {
    consentCascadeBlocked = true;
  }
  assert(consentCascadeBlocked, "Deleting a user erased retained consent evidence");

  const abuseDigest = abuseSubjectDigest("integration", "subject", onboarding.keys.abuse);
  const abuseResults = await Promise.all(Array.from({ length: 20 }, () => consumeAbuseCounter(prisma, {
    bucketType: "integration",
    subjectDigest: abuseDigest,
    digestVersion: onboarding.keys.abuse.version,
    windowSeconds: 3_600,
    limit: 5
  })));
  assert(abuseResults.filter((result) => result.allowed).length === 5, "Durable abuse limit did not admit exactly the configured count");
  assert(new Set(abuseResults.map((result) => result.count)).size === 20, "Concurrent abuse consumers did not receive exact serialized counts");
  const counter = await prisma.abuseCounter.findFirstOrThrow({ where: { bucket_type: "integration", subject_digest: abuseDigest } });
  assert(counter.count === 20, "Durable abuse counter lost concurrent increments");
  const blocked = await consumeAbuseCounter(prisma, { bucketType: "integration", subjectDigest: abuseDigest, digestVersion: onboarding.keys.abuse.version, windowSeconds: 3_600, limit: 5 });
  assert(!blocked.allowed, "Durable abuse counter allowed a request above the limit");
  for (const bucketType of ["otp_phone_day", "otp_ip_hour", "otp_invitation", "otp_verification_failure", "registration_completion", "admin_invitation_create"]) {
    const digest = abuseSubjectDigest(bucketType, "independent-subject", onboarding.keys.abuse);
    const result = await consumeAbuseCounter(prisma, {
      bucketType, subjectDigest: digest, digestVersion: onboarding.keys.abuse.version, windowSeconds: 3_600, limit: 2
    });
    assert(result.allowed && result.count === 1 && result.retryAfterSeconds > 0, `Independent abuse bucket failed: ${bucketType}`);
  }

  const api = (process.env.API_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  const operationalWithOnboardingToken = await fetch(`${api}/api/v1/passenger/requests`, {
    headers: { authorization: `Bearer ${onboardingSession.token}` }
  });
  assert(operationalWithOnboardingToken.status === 401, "Operational authentication accepted an onboarding token");
  for (const path of ["/api/v1/onboarding/start", "/api/v1/onboarding/otp/send", "/api/v1/onboarding/complete"]) {
    assert((await fetch(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status === 404, `${path} must not exist`);
  }
  const loginResponse = await fetch(`${api}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: DEMO_ACCOUNTS.admin.email, password: config.demo!.adminPassword })
  });
  assert(loginResponse.ok, "Admin login failed for invitation integration");
  const token = (await json(loginResponse)).access_token;
  const passenger = await prisma.user.findFirstOrThrow({ where: { role: "passenger", demo_account: true } });
  const passengerLogin = await fetch(`${api}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: DEMO_ACCOUNTS.passenger.email, password: config.demo!.passengerPassword })
  });
  const passengerToken = (await json(passengerLogin)).access_token;
  const forbidden = await fetch(`${api}/api/v1/admin/invitations`, { headers: { authorization: `Bearer ${passengerToken}` } });
  assert(forbidden.status === 403, "Non-admin invitation access was not forbidden");
  const unsafeMetadataResponse = await fetch(`${api}/api/v1/admin/invitations`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      role: "merchant", phone: "+970590000004", region: "PS", metadata: { phone_e164: "+970590000004" }
    })
  });
  assert(unsafeMetadataResponse.status === 400, "Admin invitation accepted arbitrary sensitive metadata");
  const privateCampaign = "operator-private-campaign";
  const createResponse = await fetch(`${api}/api/v1/admin/invitations`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "merchant", phone: "+970590000004", contact_email: "Invitee@Example.com", region: "PS", campaign: privateCampaign })
  });
  const created = await json(createResponse);
  assert(createResponse.status === 201 && typeof created.code === "string", "Admin invitation creation failed");
  assert(Boolean(createResponse.headers.get("x-request-id")), "Admin invitation response omitted request ID");
  assert(!JSON.stringify(created).includes("digest"), "Admin invitation create response exposed a digest");
  assert(created.invitation.contact_email === "i***@example.com" && !JSON.stringify(created).includes("invitee@example.com"), "Admin invitation response must mask the contact email");
  const createAudit = await prisma.auditEvent.findFirstOrThrow({
    where: { action: "invitation_created", entity_id: created.invitation.id },
    orderBy: { created_at: "desc" }
  });
  const createAuditMetadata = createAudit.metadata as Record<string, unknown>;
  const createAuditText = JSON.stringify(createAuditMetadata);
  assert(
    JSON.stringify(Object.keys(createAuditMetadata).sort()) ===
      JSON.stringify(["intended_role", "request_id"]),
    "Invitation creation audit exceeded its metadata allowlist"
  );
  assert(
    !createAuditText.includes(privateCampaign) &&
      !createAuditText.includes("+970590000004"),
    "Invitation creation audit retained operator text or phone data"
  );
  const listResponse = await fetch(`${api}/api/v1/admin/invitations?campaign=${encodeURIComponent(privateCampaign)}`, { headers: { authorization: `Bearer ${token}` } });
  const listed = await json(listResponse);
  assert(listResponse.ok && Array.isArray(listed.invitations) && listed.invitations.length === 1, "Admin invitation listing failed");
  assert(!("code" in listed.invitations[0]) && !JSON.stringify(listed).includes("digest"), "Admin invitation list exposed sensitive material");
  const exactPhoneResponse = await fetch(`${api}/api/v1/admin/invitations?phone=${encodeURIComponent("+970590000004")}&region=PS`, { headers: { authorization: `Bearer ${token}` } });
  const exactPhoneList = await json(exactPhoneResponse);
  assert(exactPhoneResponse.ok && exactPhoneList.total === 1, "Exact normalized phone invitation filter failed");
  const invalidPage = await fetch(`${api}/api/v1/admin/invitations?limit=51`, { headers: { authorization: `Bearer ${token}` } });
  assert(invalidPage.status === 400, "Invitation pagination bounds were not enforced");
  const revokeResponse = await fetch(`${api}/api/v1/admin/invitations/${created.invitation.id}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ reason: "integration cleanup" })
  });
  assert(revokeResponse.ok && (await json(revokeResponse)).invitation.status === "revoked", "Admin invitation revocation failed");
  const revokeAudit = await prisma.auditEvent.findFirstOrThrow({
    where: { action: "invitation_revoked", entity_id: created.invitation.id },
    orderBy: { created_at: "desc" }
  });
  assert(!JSON.stringify(revokeAudit.metadata).includes("integration cleanup"), "Invitation revocation audit retained free-form reason text");
  const repeatedRevoke = await fetch(`${api}/api/v1/admin/invitations/${created.invitation.id}/revoke`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ reason: "integration repeated revoke" })
  });
  assert(repeatedRevoke.ok, "Repeated invitation revocation was not idempotently safe");
  const auditText = JSON.stringify(await prisma.auditEvent.findMany({ select: { metadata: true } }));
  for (const sensitiveValue of [
    phone,
    invitation.code_digest,
    invitation.intended_phone_digest,
    raceInvite.code,
    oldCode,
    replacementCode,
    reclaimedCode,
    onboardingSession.token,
    keyDigest,
    abuseDigest,
    created.code,
    privateCampaign,
    "integration cleanup",
    "integration revocation"
  ]) {
    assert(!auditText.includes(sensitiveValue), "Audit metadata retained onboarding secret, digest, phone, or free-form reason material");
  }

  const resetResponse = await fetch(`${api}/api/v1/demo/reset`, {
    method: "POST",
    headers: { "x-demo-reset-key": config.demo!.resetKey }
  });
  assert(resetResponse.ok, "Protected demo reset failed after onboarding integration");
  const residualCounts = await Promise.all([
    prisma.invitation.count(),
    prisma.invitationRedemption.count(),
    prisma.onboardingAttempt.count(),
    prisma.otpChallenge.count(),
    prisma.onboardingSession.count(),
    prisma.userConsent.count(),
    prisma.abuseCounter.count(),
    prisma.idempotencyRecord.count(),
    prisma.consentDocument.count(),
    prisma.consentRelease.count(),
    prisma.authSession.count(),
    prisma.refreshToken.count()
  ]);
  assert(residualCounts.every((count) => count === 0), "Protected demo reset left onboarding or session foundation records");

  console.log("Onboarding foundation integration passed: single-use invitation, atomic OTP, idempotency, durable abuse controls, gated admin API, no public routes, clean demo reset.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Onboarding integration failed");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
