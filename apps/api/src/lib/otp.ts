import { randomInt, randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { otpCodeDigest, keyedDigestMatches, type VersionedKey } from "./keyedDigest.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "./audit.js";
import type { EmailDelivery } from "../services/emailAuth.js";

export type OtpDeliveryResult =
  | { status: "accepted"; providerMessageId: string }
  | { status: "rejected" | "unknown"; providerMessageId?: string };

export interface OtpProvider {
  readonly name: string;
  /**
   * Whether receiving the code proves control of the phone number. True for the fake (demo/test) provider
   * that simulates SMS; false for email delivery, which proves the mailbox only.
   */
  readonly provesPhone?: boolean;
  send(input: { phoneE164: string; email?: string; code: string; locale: "ar" | "en"; expiresAt: Date; idempotencyKey: string }): Promise<OtpDeliveryResult>;
}

/** Delivers the one-time code by email (Masari sends no SMS). Nothing but the delivery outcome is returned or logged. */
export class EmailOtpProvider implements OtpProvider {
  readonly name = "email";
  readonly provesPhone = false;
  constructor(private readonly delivery: EmailDelivery) {}

  async send(input: { email?: string; code: string; locale: "ar" | "en"; expiresAt: Date; idempotencyKey: string }): Promise<OtpDeliveryResult> {
    if (!input.email) return { status: "rejected" };
    try {
      await this.delivery.send({ to: input.email, locale: input.locale, purpose: "phone_code", actionToken: input.code, expiresAt: input.expiresAt });
      return { status: "accepted", providerMessageId: input.idempotencyKey };
    } catch {
      return { status: "unknown" };
    }
  }
}

export class FakeOtpProvider implements OtpProvider {
  readonly name = "fake";
  readonly outbox = new Map<string, string>();
  constructor(private readonly result: "accepted" | "rejected" | "unknown" = "accepted") {}

  async send(input: { phoneE164: string; code: string }): Promise<OtpDeliveryResult> {
    if (this.result !== "accepted") return { status: this.result };
    const id = randomUUID();
    this.outbox.set(id, input.code);
    return { status: "accepted", providerMessageId: id };
  }
}

export function generateOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

const OTP_DISPATCH_LEASE_SECONDS = 120;

class OtpStateUnavailableError extends Error {}

async function releaseDispatchClaim(
  db: PrismaClient,
  input: { attemptId: string; claimId: string; restoreStatus: "created" | "otp_sent" }
) {
  await db.onboardingAttempt.updateMany({
    where: { id: input.attemptId, status: "otp_dispatching", otp_dispatch_claim_id: input.claimId },
    data: {
      status: input.restoreStatus,
      otp_dispatch_claim_id: null,
      otp_dispatch_started_at: null
    }
  });
}

export async function dispatchOtpChallenge(
  db: PrismaClient,
  provider: OtpProvider,
  input: { attemptId: string; key: VersionedKey; ttlSeconds: number; maxAttempts: number; maxResends?: number; resendCooldownSeconds?: number; locale?: "ar" | "en"; requestId?: string; now?: Date }
) {
  const now = input.now ?? new Date();
  const claimId = randomUUID();
  const staleBefore = new Date(now.getTime() - OTP_DISPATCH_LEASE_SECONDS * 1_000);
  const claimed = await db.onboardingAttempt.updateMany({
    where: {
      id: input.attemptId,
      expires_at: { gt: now },
      // Invited attempts must hold a redemption; open-signup attempts have no invitation.
      AND: [{ OR: [{ invitation_id: null }, { redemption: { isNot: null } }] }],
      OR: [
        { status: { in: ["created", "otp_sent"] }, otp_dispatch_claim_id: null },
        { status: "otp_dispatching", otp_dispatch_started_at: { lte: staleBefore } }
      ]
    },
    data: { status: "otp_dispatching", otp_dispatch_claim_id: claimId, otp_dispatch_started_at: now }
  });
  if (claimed.count !== 1) throw new Error("otp_attempt_unavailable");

  const attempt = await db.onboardingAttempt.findFirstOrThrow({
    where: { id: input.attemptId, otp_dispatch_claim_id: claimId },
    select: { id: true, phone_e164: true, delivery_email: true, current_challenge_id: true }
  });
  const restoreStatus = attempt.current_challenge_id ? "otp_sent" as const : "created" as const;
  const acceptedCount = await db.otpChallenge.count({
    where: { onboarding_attempt_id: attempt.id, delivery_status: "accepted" }
  });
  if (input.maxResends !== undefined && acceptedCount >= input.maxResends + 1) {
    await releaseDispatchClaim(db, { attemptId: attempt.id, claimId, restoreStatus });
    throw new Error("otp_resend_limit");
  }
  const lastAccepted = await db.otpChallenge.findFirst({
    where: { onboarding_attempt_id: attempt.id, delivery_status: "accepted", last_sent_at: { not: null } },
    orderBy: { last_sent_at: "desc" },
    select: { last_sent_at: true }
  });
  if (
    lastAccepted?.last_sent_at &&
    input.resendCooldownSeconds &&
    lastAccepted.last_sent_at.getTime() + input.resendCooldownSeconds * 1_000 > now.getTime()
  ) {
    await releaseDispatchClaim(db, { attemptId: attempt.id, claimId, restoreStatus });
    throw new Error("otp_resend_cooldown");
  }
  const latest = await db.otpChallenge.findFirst({
    where: { onboarding_attempt_id: attempt.id },
    orderBy: { generation: "desc" },
    select: { generation: true }
  });
  const code = generateOtpCode();
  const challengeId = claimId;
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
  try {
    await db.$transaction(async (tx) => {
      const challenge = await tx.otpChallenge.create({
        data: {
          id: challengeId,
          onboarding_attempt_id: attempt.id,
          generation: (latest?.generation ?? 0) + 1,
          provider: provider.name,
          code_digest: otpCodeDigest(challengeId, code, input.key),
          code_key_version: input.key.version,
          max_attempts: input.maxAttempts,
          expires_at: expiresAt,
          delivery_updated_at: now,
          request_id: input.requestId
        }
      });
      await auditEvent(tx, {
        action: AuditAction.otp_challenge_created,
        entityType: "OtpChallenge",
        entityId: challenge.id,
        metadata: { provider: provider.name, request_id: input.requestId ?? null }
      });
    });
  } catch (error) {
    await releaseDispatchClaim(db, { attemptId: attempt.id, claimId, restoreStatus });
    throw error;
  }

  let delivery: OtpDeliveryResult;
  try {
    delivery = await provider.send({
      phoneE164: attempt.phone_e164,
      email: attempt.delivery_email ?? undefined,
      code,
      locale: input.locale ?? "ar",
      expiresAt,
      idempotencyKey: challengeId
    });
  } catch {
    delivery = { status: "unknown" };
  }

  if (delivery.status !== "accepted") {
    await db.$transaction(async (tx) => {
      await tx.otpChallenge.update({
        where: { id: challengeId },
        data: { delivery_status: delivery.status, delivery_updated_at: new Date() }
      });
      await tx.onboardingAttempt.updateMany({
        where: { id: attempt.id, status: "otp_dispatching", otp_dispatch_claim_id: claimId },
        data: {
          status: restoreStatus,
          otp_dispatch_claim_id: null,
          otp_dispatch_started_at: null
        }
      });
      await auditEvent(tx, {
        action: AuditAction.otp_dispatch_rejected,
        entityType: "OtpChallenge",
        entityId: challengeId,
        metadata: { provider: provider.name, delivery_status: delivery.status, request_id: input.requestId ?? null }
      });
    });
    return { accepted: false as const, challengeId, deliveryStatus: delivery.status };
  }

  let promoted = false;
  try {
    promoted = await db.$transaction(async (tx) => {
      await tx.otpChallenge.update({
        where: { id: challengeId },
        data: { delivery_status: "accepted", provider_message_id: delivery.providerMessageId, last_sent_at: now, delivery_updated_at: now }
      });
      await tx.otpChallenge.updateMany({
        where: { onboarding_attempt_id: attempt.id, id: { not: challengeId }, superseded_at: null, consumed_at: null },
        data: { superseded_at: now }
      });
      const promotion = await tx.onboardingAttempt.updateMany({
        where: {
          id: attempt.id,
          status: "otp_dispatching",
          otp_dispatch_claim_id: claimId,
          expires_at: { gt: now }
        },
        data: {
          current_challenge_id: challengeId,
          status: "otp_sent",
          otp_dispatch_claim_id: null,
          otp_dispatch_started_at: null
        }
      });
      if (promotion.count !== 1) throw new OtpStateUnavailableError();
      await auditEvent(tx, {
        action: AuditAction.otp_dispatch_accepted,
        entityType: "OtpChallenge",
        entityId: challengeId,
        metadata: { provider: provider.name, request_id: input.requestId ?? null }
      });
      return true;
    });
  } catch (error) {
    if (!(error instanceof OtpStateUnavailableError)) throw error;
    await db.otpChallenge.update({
      where: { id: challengeId },
      data: {
        delivery_status: "accepted",
        provider_message_id: delivery.providerMessageId,
        last_sent_at: now,
        delivery_updated_at: now,
        superseded_at: now
      }
    });
  }
  return promoted
    ? { accepted: true as const, challengeId, deliveryStatus: delivery.status }
    : { accepted: false as const, challengeId, deliveryStatus: delivery.status, reason: "stale_dispatch" as const };
}

export async function verifyOtpChallenge(
  db: PrismaClient,
  input: { attemptId: string; code: string; key: VersionedKey; now?: Date }
) {
  const now = input.now ?? new Date();
  const attempt = await db.onboardingAttempt.findUnique({
    where: { id: input.attemptId },
    include: { current_challenge: true }
  });
  const challenge = attempt?.current_challenge;
  if (
    !attempt ||
    !challenge ||
    attempt.status !== "otp_sent" ||
    attempt.expires_at <= now ||
    challenge.onboarding_attempt_id !== attempt.id ||
    challenge.delivery_status !== "accepted" ||
    challenge.superseded_at ||
    challenge.consumed_at ||
    challenge.expires_at <= now ||
    (challenge.locked_until !== null && challenge.locked_until > now) ||
    challenge.attempt_count >= challenge.max_attempts ||
    challenge.code_key_version !== input.key.version
  ) return { verified: false as const, reason: "unavailable" as const };

  const matches = keyedDigestMatches(challenge.code_digest, `masari:otp:${challenge.id}`, input.code, input.key);
  if (!matches) {
    try {
      await db.$transaction(async (tx) => {
        const incremented = await tx.otpChallenge.updateMany({
          where: {
            id: challenge.id,
            delivery_status: "accepted",
            consumed_at: null,
            superseded_at: null,
            attempt_count: { lt: challenge.max_attempts },
            expires_at: { gt: now }
          },
          data: { attempt_count: { increment: 1 } }
        });
        if (incremented.count !== 1) throw new OtpStateUnavailableError();
        const eligibleAttempt = await tx.onboardingAttempt.updateMany({
          where: { id: attempt.id, status: "otp_sent", current_challenge_id: challenge.id, expires_at: { gt: now } },
          data: { status: "otp_sent" }
        });
        if (eligibleAttempt.count !== 1) throw new OtpStateUnavailableError();
        const current = await tx.otpChallenge.findUniqueOrThrow({ where: { id: challenge.id } });
        if (current.attempt_count >= current.max_attempts) {
          await tx.otpChallenge.update({ where: { id: challenge.id }, data: { locked_until: challenge.expires_at } });
          await tx.onboardingAttempt.updateMany({
            where: { id: attempt.id, current_challenge_id: challenge.id, status: "otp_sent" },
            data: { status: "locked", otp_dispatch_claim_id: null, otp_dispatch_started_at: null }
          });
        }
        await auditEvent(tx, {
          action: AuditAction.otp_verification_failed,
          entityType: "OtpChallenge",
          entityId: challenge.id,
          metadata: { reason: "invalid" }
        });
      });
    } catch (error) {
      if (error instanceof OtpStateUnavailableError) return { verified: false as const, reason: "unavailable" as const };
      throw error;
    }
    return { verified: false as const, reason: "invalid" as const };
  }

  try {
    await db.$transaction(async (tx) => {
      const consumed = await tx.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          delivery_status: "accepted",
          consumed_at: null,
          superseded_at: null,
          attempt_count: { lt: challenge.max_attempts },
          expires_at: { gt: now }
        },
        data: { consumed_at: now, attempt_count: { increment: 1 } }
      });
      if (consumed.count !== 1) throw new OtpStateUnavailableError();
      const transitioned = await tx.onboardingAttempt.updateMany({
        where: { id: attempt.id, status: "otp_sent", current_challenge_id: challenge.id, expires_at: { gt: now } },
        data: {
          status: "phone_verified",
          verified_at: now,
          otp_dispatch_claim_id: null,
          otp_dispatch_started_at: null
        }
      });
      if (transitioned.count !== 1) throw new OtpStateUnavailableError();
      await auditEvent(tx, { action: AuditAction.otp_verified, entityType: "OtpChallenge", entityId: challenge.id });
    });
  } catch (error) {
    if (error instanceof OtpStateUnavailableError) return { verified: false as const, reason: "unavailable" as const };
    throw error;
  }
  return { verified: true as const };
}
