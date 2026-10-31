import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { AuditAction, Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { ConsentLocale, ConsentDocumentType, OnboardingRole } from "../generated/prisma/enums.js";
import { consumeAbuseCounter } from "../lib/abuseCounters.js";
import { auditEvent } from "../lib/audit.js";
import { claimIdempotency, completeIdempotency, failIdempotency } from "../lib/idempotency.js";
import { normalizeInvitationCode } from "../lib/invitations.js";
import {
  abuseSubjectDigest,
  hexDigestMatches,
  idempotencyKeyDigest,
  idempotencyPayloadDigest,
  invitationCodeDigest,
  onboardingSessionDigest,
  phoneDigest,
  registrationGrantDigest
} from "../lib/keyedDigest.js";
import {
  FakeOtpProvider,
  dispatchOtpChallenge,
  verifyOtpChallenge,
  type OtpProvider
} from "../lib/otp.js";
import {
  generateOnboardingToken,
  onboardingSessionTokenData,
  revokeOnboardingSessions
} from "../lib/onboardingSessions.js";
import { contactEmailSchema, normalizeEmailForAbuse } from "../lib/contactEmail.js";
import { PHONE_INPUT_MAX_LENGTH, maskPhone, normalizePhoneToE164, phoneLast4 } from "../lib/phone.js";
import { consentDigestMatches } from "../lib/consentContent.js";
import { missingDocumentKinds, requiredDocumentKinds } from "../lib/applicationReview.js";
import { prisma } from "../lib/prisma.js";
import {
  requireOnboardingToken,
  type OnboardingAuthenticatedRequest
} from "../middleware/onboardingAuth.js";
import { HttpError } from "../middleware/error.js";

const REQUIRED_CONSENTS = ["terms", "privacy", "adult_self_attestation"] as const;
const SUPPORTED_ROLES = ["passenger", "driver", "merchant"] as const;
const SUPPORTED_LOCALES = ["ar", "en"] as const;
const OPEN_ROLES = ["driver", "merchant"] as const;
const PASSWORD_MIN_CHARACTERS = 15;
const PASSWORD_MAX_CHARACTERS = 64;
const PASSWORD_MAX_BYTES = 72;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1_000;
const DUMMY_PASSWORD = "masari-pending-recovery-dummy-value";
const dummyHash = bcrypt.hash(DUMMY_PASSWORD, 10);

const roleSchema = z.enum(SUPPORTED_ROLES);
const localeSchema = z.enum(SUPPORTED_LOCALES);
const startSchema = z.strictObject({
  // Absent for open driver / shop-owner signup (OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED).
  invitation_code: z.string().trim().min(20).max(32).optional(),
  role: roleSchema,
  phone: z.string().trim().min(7).max(PHONE_INPUT_MAX_LENGTH),
  // Open sign-up only: Masari sends no SMS, so the one-time code goes to this address.
  // Invited applicants never supply one; their code goes to the address the Admin recorded.
  email: contactEmailSchema.optional(),
  region: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
  locale: localeSchema
}).refine((value) => (value.invitation_code === undefined) === (value.email !== undefined));
const verifySchema = z.strictObject({ otp: z.string().regex(/^\d{6}$/) });
const consentInputSchema = z.strictObject({
  id: z.string().min(1).max(191),
  type: z.enum(REQUIRED_CONSENTS),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/)
});
const completionSchema = z.strictObject({
  registration_grant: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  display_name: z.string().min(1).max(160),
  password: z.string().min(1).max(128),
  locale: localeSchema,
  consents: z.array(consentInputSchema).length(3),
  adult_self_attestation: z.literal(true)
});
const recoverySchema = z.strictObject({
  phone: z.string().trim().min(7).max(PHONE_INPUT_MAX_LENGTH),
  region: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
  password: z.string().min(1).max(128)
});

type Db = PrismaClient | Prisma.TransactionClient;
type PublicRegistration = NonNullable<AppConfig["publicRegistration"]>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestIp(req: Request) {
  return req.ip || "unknown";
}

function invitationAbuseSubject(value: string) {
  try {
    return normalizeInvitationCode(value);
  } catch {
    return `malformed:${value.trim().toUpperCase()}`;
  }
}

function idempotencyKey(req: Request) {
  const value = req.header("idempotency-key");
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new HttpError(400, "validation_error");
  return value;
}

function safeDisplayName(value: string) {
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (
    normalized.length < 2 ||
    normalized.length > 80 ||
    /[\u0000-\u001f\u007f<>]/u.test(normalized) ||
    !/^[\p{L}\p{M}\p{N} '\-’]+$/u.test(normalized)
  ) throw new HttpError(400, "validation_error");
  return normalized;
}

function validatePassword(value: string) {
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    value.length < PASSWORD_MIN_CHARACTERS ||
    value.length > PASSWORD_MAX_CHARACTERS ||
    bytes > PASSWORD_MAX_BYTES ||
    value.trim().length === 0
  ) throw new HttpError(400, "validation_error");
}

async function currentConsentDocuments(db: Db, locale: ConsentLocale, now = new Date()) {
  const documents = await db.consentDocument.findMany({
    where: {
      locale,
      document_type: { in: [...REQUIRED_CONSENTS] },
      release: {
        status: "effective",
        activated_at: { lte: now },
        retired_at: null
      },
      legal_approved_at: { not: null },
      effective_at: { lte: now },
      OR: [{ retired_at: null }, { retired_at: { gt: now } }]
    },
    orderBy: [{ document_type: "asc" }, { effective_at: "desc" }, { created_at: "desc" }]
  });
  const byType = new Map<ConsentDocumentType, Array<(typeof documents)[number]>>();
  for (const document of documents) {
    byType.set(document.document_type, [...(byType.get(document.document_type) ?? []), document]);
  }
  const selected = REQUIRED_CONSENTS.map((type) => {
    const matches = byType.get(type) ?? [];
    return matches.length === 1 ? matches[0] : null;
  });
  if (selected.some((document) =>
    document === null ||
    !document.content_body ||
    !consentDigestMatches(document.content_body, document.content_digest)
  )) return [];
  return selected as Array<(typeof documents)[number]>;
}

async function legalSetReady(db: Db, appConfig: AppConfig) {
  if (!appConfig.publicOnboardingEnabled) return false;
  for (const locale of SUPPORTED_LOCALES) {
    if ((await currentConsentDocuments(db, locale)).length !== REQUIRED_CONSENTS.length) return false;
  }
  return true;
}

async function consumeBuckets(
  req: Request,
  appConfig: AppConfig,
  buckets: Array<{ type: string; subject: string; seconds: number; limit: number }>
) {
  const onboarding = appConfig.onboarding!;
  for (const bucket of buckets) {
    const result = await consumeAbuseCounter(prisma, {
      bucketType: bucket.type,
      subjectDigest: abuseSubjectDigest(bucket.type, bucket.subject, onboarding.keys.abuse),
      digestVersion: onboarding.keys.abuse.version,
      windowSeconds: bucket.seconds,
      limit: bucket.limit
    });
    if (!result.allowed) {
      await auditEvent(prisma, {
        action: AuditAction.onboarding_rate_limited,
        entityType: "PublicOnboarding",
        metadata: { bucket_type: bucket.type, request_id: req.requestId }
      });
      throw new HttpError(429, "rate_limited");
    }
  }
}

async function claimPublicOperation(
  req: Request,
  appConfig: AppConfig,
  input: { operation: string; scope: string; payload: unknown }
) {
  const onboarding = appConfig.onboarding!;
  const registration = appConfig.publicRegistration!;
  const key = idempotencyKey(req);
  const scopeDigest = idempotencyKeyDigest(`${input.operation}:scope`, input.scope, onboarding.keys.idempotency);
  const keyDigest = idempotencyKeyDigest(input.operation, key, onboarding.keys.idempotency);
  const requestDigest = idempotencyPayloadDigest(
    input.operation,
    canonical(input.payload),
    registration.idempotencyPayloadKey
  );
  const claim = await claimIdempotency(prisma, {
    operation: input.operation,
    scopeDigest,
    keyDigest,
    keyVersion: onboarding.keys.idempotency.version,
    requestDigest,
    expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS)
  });
  if (claim.kind === "conflict") {
    await auditEvent(prisma, {
      action: AuditAction.onboarding_idempotency_conflict,
      entityType: "IdempotencyRecord",
      entityId: claim.record.id,
      metadata: { operation: input.operation, request_id: req.requestId }
    });
    throw new HttpError(409, "registration_conflict");
  }
  if (claim.kind === "failed") throw new HttpError(409, "registration_conflict");
  if (claim.kind === "in_progress") throw new HttpError(409, "verification_temporarily_unavailable");
  return claim;
}

async function rotateContinuation(appConfig: AppConfig, attemptId: string) {
  const onboarding = appConfig.onboarding!;
  const registration = appConfig.publicRegistration!;
  const token = generateOnboardingToken();
  const session = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM onboarding_attempts WHERE id = ${attemptId} FOR UPDATE`;
    const attempt = await tx.onboardingAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const now = new Date();
    if (
      attempt.completed_user_id ||
      attempt.expires_at <= now ||
      !["created", "otp_dispatching", "otp_sent", "phone_verified"].includes(attempt.status)
    ) throw new Error("continuation_attempt_unavailable");
    await tx.onboardingSession.updateMany({
      where: { onboarding_attempt_id: attemptId, purpose: "continuation", revoked_at: null },
      data: { revoked_at: now, revoke_reason: "continuation_rotated" }
    });
    const expiresAt = new Date(Math.min(
      attempt.expires_at.getTime(),
      now.getTime() + registration.continuationTtlSeconds * 1_000
    ));
    return tx.onboardingSession.create({
      data: onboardingSessionTokenData({
        token,
        key: onboarding.keys.onboardingSession,
        attemptId,
        purpose: "continuation",
        expiresAt
      })
    });
  });
  return { token, session };
}

async function rotatePendingStatusSession(appConfig: AppConfig, attemptId: string, userId: string) {
  const onboarding = appConfig.onboarding!;
  const registration = appConfig.publicRegistration!;
  const token = generateOnboardingToken();
  const session = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM onboarding_attempts WHERE id = ${attemptId} FOR UPDATE`;
    const attempt = await tx.onboardingAttempt.findUnique({
      where: { id: attemptId },
      include: { completed_user: true }
    });
    if (
      !attempt ||
      attempt.status !== "completed" ||
      attempt.completed_user_id !== userId ||
      attempt.completed_user?.account_status !== "pending" ||
      !["driver", "merchant"].includes(attempt.completed_user.role)
    ) throw new Error("pending_status_unavailable");
    const now = new Date();
    await tx.onboardingSession.updateMany({
      where: { user_id: userId, purpose: "pending_status", revoked_at: null },
      data: { revoked_at: now, revoke_reason: "pending_status_rotated" }
    });
    const created = await tx.onboardingSession.create({
      data: onboardingSessionTokenData({
        token,
        key: onboarding.keys.onboardingSession,
        attemptId,
        userId,
        purpose: "pending_status",
        expiresAt: new Date(now.getTime() + registration.pendingStatusTtlDays * 86_400_000)
      })
    });
    await auditEvent(tx, {
      userId,
      action: AuditAction.pending_status_session_created,
      entityType: "OnboardingSession",
      entityId: created.id,
      metadata: { role: attempt.completed_user.role }
    });
    return created;
  });
  return { token, session };
}

async function issueRegistrationGrant(appConfig: AppConfig, attemptId: string) {
  const onboarding = appConfig.onboarding!;
  const registration = appConfig.publicRegistration!;
  const grant = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + registration.registrationGrantTtlSeconds * 1_000);
  const updated = await prisma.onboardingAttempt.updateMany({
    where: { id: attemptId, status: "phone_verified", completed_user_id: null, expires_at: { gt: now } },
    data: {
      registration_grant_digest: registrationGrantDigest(grant, onboarding.keys.onboardingSession),
      registration_grant_key_version: onboarding.keys.onboardingSession.version,
      registration_grant_expires_at: expiresAt
    }
  });
  if (updated.count !== 1) throw new HttpError(409, "registration_grant_invalid");
  return { token: grant, expiresAt };
}

/** Daily send caps for one attempt: keyed on the phone and, when a mailbox receives the code, on that mailbox too. */
function otpDayBuckets(appConfig: AppConfig, phone: string, email: string | null | undefined, ip: string) {
  const limit = appConfig.onboarding!.otpMaxSendsPerPhoneDay;
  return [
    { type: "otp_phone_day", subject: phone, seconds: 86_400, limit },
    ...(email ? [{ type: "otp_email_day", subject: normalizeEmailForAbuse(email), seconds: 86_400, limit }] : []),
    { type: "otp_ip_hour", subject: ip, seconds: 3_600, limit: 20 }
  ];
}

function startResponse(
  attempt: { id: string; status: string; phone_e164: string; expires_at: Date },
  token: string,
  tokenExpiresAt: Date,
  appConfig: AppConfig,
  requestId: string,
  retryable = false
) {
  return {
    attempt: {
      id: attempt.id,
      status: retryable ? "verification_temporarily_unavailable" : attempt.status,
      phone: maskPhone(attempt.phone_e164),
      expires_at: attempt.expires_at,
      resend_available_at: new Date(Date.now() + appConfig.onboarding!.otpResendCooldownSeconds * 1_000)
    },
    onboarding_token: token,
    onboarding_token_expires_at: tokenExpiresAt,
    next_action: retryable ? "resend_otp" : "verify_otp",
    request_id: requestId
  };
}

/** Conflict answers per source IP per hour; beyond this the endpoint answers 429 instead of confirming a conflict. */
const REGISTRATION_CONFLICT_IP_HOURLY_LIMIT = 5;
const PHONE_HOLDER_SELECT = { id: true, phone_verified_at: true, email_verified_at: true } as const;

/**
 * Only an account whose phone was never verified AND that can still sign in by its verified email may lose
 * the number. An account holding a verified phone is never touched.
 */
function isReleasableHolder(holder: { phone_verified_at: Date | null; email_verified_at: Date | null }) {
  return holder.phone_verified_at === null && holder.email_verified_at !== null;
}

/**
 * Admin-vouched claims win over self-typed (unverified) ones: free the number from an unverified holder inside
 * the caller's transaction. Returns false when a verified (or non-releasable) account holds it.
 * The audit record carries no phone, email or code.
 */
async function releaseUnverifiedPhone(tx: Prisma.TransactionClient, phone: string, requestId: string, invitationId: string) {
  const holder = await tx.user.findUnique({ where: { phone }, select: PHONE_HOLDER_SELECT });
  if (!holder) return true;
  if (!isReleasableHolder(holder)) return false;
  const released = await tx.user.updateMany({
    where: { id: holder.id, phone, phone_verified_at: null },
    data: { phone: null, profile_state: "phone_required" }
  });
  if (released.count !== 1) return false;
  await auditEvent(tx, {
    userId: holder.id,
    action: AuditAction.admin_action,
    entityType: "User",
    entityId: holder.id,
    metadata: { event: "unverified_phone_released", reason: "invitation_claim", invitation_id: invitationId, request_id: requestId }
  });
  return true;
}

async function findBoundInvitation(appConfig: AppConfig, input: z.infer<typeof startSchema>, invitationCode: string) {
  const onboarding = appConfig.onboarding!;
  const normalizedCode = normalizeInvitationCode(invitationCode);
  const phone = normalizePhoneToE164(input.phone, { region: input.region });
  const now = new Date();
  const invitation = await prisma.invitation.findUnique({
    where: { code_digest: invitationCodeDigest(normalizedCode, onboarding.keys.invitationCode) },
    include: { attempt: true }
  });
  if (
    !invitation ||
    invitation.code_key_version !== onboarding.keys.invitationCode.version ||
    invitation.intended_role !== input.role ||
    invitation.phone_digest_version !== onboarding.keys.phoneDigest.version ||
    !hexDigestMatches(invitation.intended_phone_digest, phoneDigest(phone, onboarding.keys.phoneDigest))
  ) throw new HttpError(404, "onboarding_unavailable");
  const recoverableAttempt = Boolean(
    invitation.attempt &&
      invitation.attempt.phone_digest === phoneDigest(phone, onboarding.keys.phoneDigest) &&
      invitation.attempt.intended_role === input.role &&
      invitation.attempt.expires_at > now &&
      ["created", "otp_dispatching", "otp_sent", "phone_verified"].includes(invitation.attempt.status)
  );
  const unusedInvitation =
    !invitation.revoked_at &&
    invitation.expires_at > now &&
    invitation.used_count < invitation.max_uses &&
    invitation.max_uses === 1;
  if (!recoverableAttempt && !unusedInvitation) throw new HttpError(404, "onboarding_unavailable");
  if (!recoverableAttempt) {
    // A phone typed in (never verified) by a self-registered account does not block an Admin-vouched claim.
    const holder = await prisma.user.findUnique({ where: { phone }, select: PHONE_HOLDER_SELECT });
    if (holder && !isReleasableHolder(holder)) throw new HttpError(404, "onboarding_unavailable");
  }
  return { invitation, phone, normalizedCode };
}

function safeOutcome(
  user: { role: string; account_status: string; review_submitted_at?: Date | null },
  requestId: string,
  pendingSession?: { token: string; expiresAt: Date }
) {
  const pending = user.role === "driver" || user.role === "merchant";
  return {
    result: "account_created",
    role: user.role,
    account_status: user.account_status,
    next_action: pending ? (user.review_submitted_at === null ? "upload_documents" : "await_approval") : "login",
    ...(pendingSession
      ? {
          onboarding_status_token: pendingSession.token,
          onboarding_status_expires_at: pendingSession.expiresAt
        }
      : {}),
    request_id: requestId
  };
}

export function createPublicOnboardingRouter(
  appConfig: AppConfig,
  provider: OtpProvider = new FakeOtpProvider()
) {
  const router = Router();

  router.get("/onboarding/config", async (req, res, next) => {
    try {
      const enabled = appConfig.publicOnboardingEnabled && (await legalSetReady(prisma, appConfig));
      res.json({
        enabled,
        registration_roles: enabled ? [...SUPPORTED_ROLES] : [],
        open_registration_roles: enabled && appConfig.openSignupEnabled ? [...OPEN_ROLES] : [],
        ...(enabled
          ? {
              phone_policy: {
                canonical_format: "E.164",
                international_prefix_required_without_region: true,
                local_numbers_require_region: true
              },
              supported_locales: [...SUPPORTED_LOCALES],
              password_policy: {
                minimum_characters: PASSWORD_MIN_CHARACTERS,
                maximum_characters: PASSWORD_MAX_CHARACTERS,
                maximum_utf8_bytes: PASSWORD_MAX_BYTES
              },
              otp_digits: 6,
              resend_cooldown_seconds: appConfig.onboarding!.otpResendCooldownSeconds
            }
          : {}),
        request_id: req.requestId
      });
    } catch (error) {
      next(error);
    }
  });

  if (!appConfig.publicOnboardingEnabled || !appConfig.onboarding || !appConfig.publicRegistration) return router;
  const onboarding = appConfig.onboarding;
  if (provider.name !== "fake" && provider.name !== "email") throw new Error("public_onboarding_provider_required");
  // Never fall back to the fake provider when email delivery was configured.
  if (appConfig.otpProvider === "email" && provider.name !== "email") throw new Error("public_onboarding_email_provider_required");
  const continuation = requireOnboardingToken(appConfig, ["continuation"]);
  const completionContinuation = requireOnboardingToken(appConfig, ["continuation"], {
    allowCompletedContinuationReplay: true
  });
  const statusToken = requireOnboardingToken(appConfig, ["continuation", "pending_status"]);

  router.get("/onboarding/consents", async (req, res, next) => {
    try {
      const locale = localeSchema.parse(req.query.locale);
      const documents = await currentConsentDocuments(prisma, locale);
      if (documents.length !== REQUIRED_CONSENTS.length) throw new HttpError(503, "onboarding_unavailable");
      res.json({
        documents: documents.map((document) => ({
          id: document.id,
          type: document.document_type,
          version: document.version,
          locale: document.locale,
          content: document.content_body,
          content_hash: document.content_digest,
          effective_at: document.effective_at
        })),
        request_id: req.requestId
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Open driver / shop-owner signup: an attempt with no invitation. The one-time code is
   * emailed, so it proves the mailbox and NOT the phone number; the phone stays unverified
   * and an Admin invitation for it always outranks it. The start response never says whether
   * the number already has an account (an existing number just fails at completion with
   * registration_conflict, which is capped per IP so it cannot be used to enumerate numbers).
   * One live open attempt per phone: starting again supersedes the older one.
   */
  async function startOpenAttempt(
    req: Request,
    res: Response,
    input: z.infer<typeof startSchema>,
    phone: string,
    claim: Awaited<ReturnType<typeof claimPublicOperation>>
  ) {
    const digest = phoneDigest(phone, onboarding.keys.phoneDigest);
    const live = ["created", "otp_dispatching", "otp_sent", "phone_verified"] as const;
    const now = new Date();
    if (claim.kind === "replay") {
      const existing = await prisma.onboardingAttempt.findFirst({
        where: {
          invitation_id: null,
          phone_digest: digest,
          intended_role: input.role as OnboardingRole,
          completed_user_id: null,
          expires_at: { gt: now },
          status: { in: [...live] }
        },
        orderBy: { created_at: "desc" }
      });
      if (existing) {
        const rotated = await rotateContinuation(appConfig, existing.id);
        res.json(startResponse(existing, rotated.token, rotated.session.expires_at, appConfig, req.requestId, existing.status === "created"));
        return;
      }
    }
    const attempt = await prisma.$transaction(async (tx) => {
      const older = await tx.onboardingAttempt.findMany({
        where: { invitation_id: null, phone_digest: digest, completed_user_id: null, status: { in: [...live] } },
        select: { id: true }
      });
      if (older.length > 0) {
        const ids = older.map((entry) => entry.id);
        await tx.onboardingAttempt.updateMany({ where: { id: { in: ids } }, data: { status: "cancelled", expires_at: now } });
        await tx.onboardingSession.updateMany({
          where: { onboarding_attempt_id: { in: ids }, revoked_at: null },
          data: { revoked_at: now, revoke_reason: "open_attempt_superseded" }
        });
      }
      const created = await tx.onboardingAttempt.create({
        data: {
          intended_role: input.role as OnboardingRole,
          phone_e164: phone,
          phone_digest: digest,
          phone_digest_version: onboarding.keys.phoneDigest.version,
          phone_last4: phoneLast4(phone),
          delivery_email: input.email ?? null,
          request_ip_digest: abuseSubjectDigest("onboarding_ip", requestIp(req), onboarding.keys.abuse),
          request_ip_digest_version: onboarding.keys.abuse.version,
          created_request_id: req.requestId,
          expires_at: new Date(now.getTime() + appConfig.publicRegistration!.attemptTtlSeconds * 1_000)
        }
      });
      await auditEvent(tx, {
        action: AuditAction.onboarding_started,
        entityType: "OnboardingAttempt",
        entityId: created.id,
        metadata: { role: created.intended_role, open_signup: true, request_id: req.requestId }
      });
      return created;
    });
    const rotated = await rotateContinuation(appConfig, attempt.id);
    await consumeBuckets(req, appConfig, [
      ...otpDayBuckets(appConfig, phone, input.email, requestIp(req))
    ]);
    const delivery = await dispatchOtpChallenge(prisma, provider, {
      attemptId: attempt.id,
      key: onboarding.keys.otpCode,
      ttlSeconds: onboarding.otpTtlSeconds,
      maxAttempts: onboarding.otpMaxAttempts,
      maxResends: onboarding.otpMaxResends,
      resendCooldownSeconds: onboarding.otpResendCooldownSeconds,
      locale: input.locale,
      requestId: req.requestId
    });
    if (claim.kind === "claimed") {
      await completeIdempotency(prisma, {
        recordId: claim.record.id,
        claimVersion: claim.record.claim_version,
        resourceType: "OnboardingAttempt",
        resourceId: attempt.id,
        responseStatus: 201
      });
    }
    const current = await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    res.status(201).json(startResponse(current, rotated.token, rotated.session.expires_at, appConfig, req.requestId, !delivery.accepted));
  }

  router.post("/onboarding/attempts", async (req, res, next) => {
    let claim: Awaited<ReturnType<typeof claimPublicOperation>> | undefined;
    let recovery: { invitationId: string; phone: string; role: OnboardingRole } | undefined;
    try {
      const input = startSchema.parse(req.body);
      if (!(await legalSetReady(prisma, appConfig))) throw new HttpError(503, "onboarding_unavailable");
      const phone = normalizePhoneToE164(input.phone, { region: input.region });
      if (input.invitation_code === undefined) {
        if (!appConfig.openSignupEnabled || !(OPEN_ROLES as readonly string[]).includes(input.role)) {
          throw new HttpError(404, "onboarding_unavailable");
        }
        // Tight per-IP and per-phone caps first, so one source cannot spend the shared hourly budget.
        await consumeBuckets(req, appConfig, [
          { type: "open_start_ip", subject: requestIp(req), seconds: 3_600, limit: 10 },
          { type: "open_start_phone", subject: phone, seconds: 86_400, limit: 5 },
          { type: "open_start_email", subject: normalizeEmailForAbuse(input.email!), seconds: 86_400, limit: 5 },
          { type: "open_start_global", subject: "all", seconds: 3_600, limit: appConfig.openSignupMaxStartsPerHour }
        ]);
        claim = await claimPublicOperation(req, appConfig, {
          operation: "onboarding_open_start",
          scope: phone,
          payload: { role: input.role, phone, email: input.email, region: input.region, locale: input.locale }
        });
        await startOpenAttempt(req, res, input, phone, claim);
        return;
      }
      const normalizedCode = invitationAbuseSubject(input.invitation_code);
      await consumeBuckets(req, appConfig, [
        { type: "onboarding_start_ip", subject: requestIp(req), seconds: 3_600, limit: 30 },
        { type: "onboarding_start_phone", subject: phone, seconds: 86_400, limit: 10 },
        { type: "onboarding_start_invitation", subject: normalizedCode, seconds: 86_400, limit: 10 }
      ]);
      let bound;
      try {
        bound = await findBoundInvitation(appConfig, input, input.invitation_code);
      } catch {
        throw new HttpError(404, "onboarding_unavailable");
      }
      const { invitation } = bound;
      recovery = { invitationId: invitation.id, phone, role: input.role };
      claim = await claimPublicOperation(req, appConfig, {
        operation: "onboarding_start",
        scope: invitation.id,
        payload: { invitation_code: bound.normalizedCode, role: input.role, phone, region: input.region, locale: input.locale }
      });

      const existing = invitation.attempt;
      if (existing) {
        if (
          existing.phone_digest !== phoneDigest(phone, onboarding.keys.phoneDigest) ||
          existing.intended_role !== input.role ||
          existing.expires_at <= new Date() ||
          !["created", "otp_dispatching", "otp_sent", "phone_verified"].includes(existing.status)
        ) throw new HttpError(404, "onboarding_unavailable");
        const rotated = await rotateContinuation(appConfig, existing.id);
        if (claim.kind === "claimed") {
          await completeIdempotency(prisma, {
            recordId: claim.record.id,
            claimVersion: claim.record.claim_version,
            resourceType: "OnboardingAttempt",
            resourceId: existing.id,
            responseStatus: 200
          });
        }
        await auditEvent(prisma, {
          action: AuditAction.onboarding_resumed,
          entityType: "OnboardingAttempt",
          entityId: existing.id,
          metadata: { role: existing.intended_role, request_id: req.requestId }
        });
        res.json(startResponse(existing, rotated.token, rotated.session.expires_at, appConfig, req.requestId, existing.status === "created"));
        return;
      }

      const now = new Date();
      const attempt = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM invitations WHERE id = ${invitation.id} FOR UPDATE`;
        const locked = await tx.invitation.findUnique({ where: { id: invitation.id }, include: { attempt: true } });
        if (
          !locked ||
          locked.attempt ||
          locked.revoked_at ||
          locked.expires_at <= now ||
          locked.used_count !== 0 ||
          locked.max_uses !== 1 ||
          locked.intended_role !== input.role ||
          locked.intended_phone_digest !== phoneDigest(phone, appConfig.onboarding!.keys.phoneDigest)
        ) throw new Error("start_unavailable");
        if (!(await releaseUnverifiedPhone(tx, phone, req.requestId, locked.id))) throw new Error("start_unavailable");
        // Never burn the invitation on a contact email that already has an account: completion would 409 forever.
        if (provider.provesPhone === false && locked.contact_email &&
          (await tx.user.findUnique({ where: { email: locked.contact_email }, select: { id: true } }))) throw new Error("start_unavailable");
        const created = await tx.onboardingAttempt.create({
          data: {
            invitation_id: locked.id,
            intended_role: locked.intended_role,
            phone_e164: phone,
            phone_digest: locked.intended_phone_digest,
            phone_digest_version: locked.phone_digest_version,
            phone_last4: phoneLast4(phone),
            delivery_email: locked.contact_email,
            request_ip_digest: abuseSubjectDigest("onboarding_ip", requestIp(req), appConfig.onboarding!.keys.abuse),
            request_ip_digest_version: appConfig.onboarding!.keys.abuse.version,
            created_request_id: req.requestId,
            expires_at: new Date(now.getTime() + appConfig.publicRegistration!.attemptTtlSeconds * 1_000)
          }
        });
        await tx.invitation.update({
          where: { id: locked.id },
          data: { used_count: 1, last_used_at: now }
        });
        await tx.invitationRedemption.create({
          data: { invitation_id: locked.id, onboarding_attempt_id: created.id, redeemed_at: now }
        });
        await auditEvent(tx, {
          action: AuditAction.onboarding_started,
          entityType: "OnboardingAttempt",
          entityId: created.id,
          metadata: { role: created.intended_role, request_id: req.requestId }
        });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      const rotated = await rotateContinuation(appConfig, attempt.id);
      await consumeBuckets(req, appConfig, otpDayBuckets(appConfig, phone, attempt.delivery_email, requestIp(req)));
      const delivery = await dispatchOtpChallenge(prisma, provider, {
        attemptId: attempt.id,
        key: onboarding.keys.otpCode,
        ttlSeconds: onboarding.otpTtlSeconds,
        maxAttempts: onboarding.otpMaxAttempts,
        maxResends: onboarding.otpMaxResends,
        resendCooldownSeconds: onboarding.otpResendCooldownSeconds,
        locale: input.locale,
        requestId: req.requestId
      });
      await completeIdempotency(prisma, {
        recordId: claim.record.id,
        claimVersion: claim.record.claim_version,
        resourceType: "OnboardingAttempt",
        resourceId: attempt.id,
        responseStatus: 201
      });
      const current = await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      res.status(201).json(startResponse(current, rotated.token, rotated.session.expires_at, appConfig, req.requestId, !delivery.accepted));
    } catch (error) {
      if (recovery && !(error instanceof HttpError) && !(error instanceof z.ZodError)) {
        const resumed = await prisma.onboardingAttempt.findUnique({ where: { invitation_id: recovery.invitationId } });
        if (
          resumed &&
          resumed.phone_e164 === recovery.phone &&
          resumed.intended_role === recovery.role &&
          resumed.expires_at > new Date() &&
          ["created", "otp_dispatching", "otp_sent", "phone_verified"].includes(resumed.status)
        ) {
          const rotated = await rotateContinuation(appConfig, resumed.id);
          if (claim?.kind === "claimed") {
            await completeIdempotency(prisma, {
              recordId: claim.record.id,
              claimVersion: claim.record.claim_version,
              resourceType: "OnboardingAttempt",
              resourceId: resumed.id,
              responseStatus: 200
            });
          }
          await auditEvent(prisma, {
            action: AuditAction.onboarding_resumed,
            entityType: "OnboardingAttempt",
            entityId: resumed.id,
            metadata: { role: resumed.intended_role, request_id: req.requestId }
          });
          res.json(startResponse(resumed, rotated.token, rotated.session.expires_at, appConfig, req.requestId, resumed.status !== "otp_sent"));
          return;
        }
      }
      if (claim?.kind === "claimed") {
        await failIdempotency(prisma, {
          recordId: claim.record.id,
          claimVersion: claim.record.claim_version
        }).catch(() => undefined);
      }
      next(
        error instanceof HttpError || error instanceof z.ZodError
          ? error
          : new HttpError(404, "onboarding_unavailable")
      );
    }
  });

  router.post("/onboarding/attempts/:id/resend", continuation, async (req: OnboardingAuthenticatedRequest, res, next) => {
    let claim: Awaited<ReturnType<typeof claimPublicOperation>> | undefined;
    try {
      const attemptId = String(req.params.id);
      if (req.onboarding!.attemptId !== attemptId) throw new HttpError(401, "onboarding_unavailable");
      const attempt = await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      claim = await claimPublicOperation(req, appConfig, {
        operation: "onboarding_resend",
        scope: attempt.id,
        payload: { attempt_id: attempt.id }
      });
      if (claim.kind === "replay") {
        const challenge = claim.record.resource_id
          ? await prisma.otpChallenge.findUnique({ where: { id: claim.record.resource_id } })
          : null;
        if (!challenge || challenge.onboarding_attempt_id !== attempt.id) {
          throw new HttpError(409, "registration_conflict");
        }
        const accepted =
          challenge.delivery_status === "accepted" &&
          challenge.id === attempt.current_challenge_id &&
          !challenge.superseded_at;
        const deliveryAt = challenge.last_sent_at ?? challenge.delivery_updated_at;
        res.json({
          status: accepted ? "otp_sent" : "verification_temporarily_unavailable",
          resend_available_at: new Date(deliveryAt.getTime() + onboarding.otpResendCooldownSeconds * 1_000),
          request_id: req.requestId
        });
        return;
      }
      await consumeBuckets(req, appConfig, [
        ...otpDayBuckets(appConfig, attempt.phone_e164, attempt.delivery_email, requestIp(req)),
        { type: "otp_attempt", subject: attempt.id, seconds: 86_400, limit: onboarding.otpMaxResends + 1 },
        { type: "otp_invitation", subject: attempt.invitation_id ?? attempt.id, seconds: 86_400, limit: onboarding.otpMaxResends + 1 }
      ]);
      const delivery = await dispatchOtpChallenge(prisma, provider, {
        attemptId,
        key: onboarding.keys.otpCode,
        ttlSeconds: onboarding.otpTtlSeconds,
        maxAttempts: onboarding.otpMaxAttempts,
        maxResends: onboarding.otpMaxResends,
        resendCooldownSeconds: onboarding.otpResendCooldownSeconds,
        requestId: req.requestId
      });
      await completeIdempotency(prisma, {
        recordId: claim.record.id,
        claimVersion: claim.record.claim_version,
        resourceType: "OtpChallenge",
        resourceId: delivery.challengeId,
        responseStatus: 200
      });
      const persistedChallenge = await prisma.otpChallenge.findUniqueOrThrow({
        where: { id: delivery.challengeId },
        select: { last_sent_at: true, delivery_updated_at: true }
      });
      const persistedDeliveryAt = persistedChallenge.last_sent_at ?? persistedChallenge.delivery_updated_at;
      await auditEvent(prisma, {
        action: AuditAction.otp_resent,
        entityType: "OnboardingAttempt",
        entityId: attempt.id,
        metadata: { outcome: delivery.accepted ? "accepted" : "retryable", request_id: req.requestId }
      });
      res.json({
        status: delivery.accepted ? "otp_sent" : "verification_temporarily_unavailable",
        resend_available_at: new Date(persistedDeliveryAt.getTime() + onboarding.otpResendCooldownSeconds * 1_000),
        request_id: req.requestId
      });
    } catch (error) {
      if (claim?.kind === "claimed") {
        await failIdempotency(prisma, { recordId: claim.record.id, claimVersion: claim.record.claim_version }).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : "";
      next(
        message === "otp_resend_cooldown" || message === "otp_attempt_unavailable"
          ? new HttpError(429, "rate_limited")
          : message === "otp_resend_limit"
            ? new HttpError(429, "rate_limited")
            : error
      );
    }
  });

  router.post("/onboarding/attempts/:id/verify", continuation, async (req: OnboardingAuthenticatedRequest, res, next) => {
    let claim: Awaited<ReturnType<typeof claimPublicOperation>> | undefined;
    try {
      const attemptId = String(req.params.id);
      if (req.onboarding!.attemptId !== attemptId) throw new HttpError(401, "onboarding_unavailable");
      const input = verifySchema.parse(req.body);
      await consumeBuckets(req, appConfig, [
        { type: "otp_verify_attempt", subject: attemptId, seconds: 3_600, limit: onboarding.otpMaxAttempts + 2 },
        { type: "otp_verify_ip", subject: requestIp(req), seconds: 3_600, limit: 30 }
      ]);
      claim = await claimPublicOperation(req, appConfig, {
        operation: "onboarding_verify",
        scope: attemptId,
        payload: { attempt_id: attemptId, otp: input.otp }
      });
      if (claim.kind === "replay") {
        const attempt = await prisma.onboardingAttempt.findUnique({ where: { id: attemptId } });
        if (attempt?.status !== "phone_verified") throw new HttpError(409, "verification_expired");
        const grant = await issueRegistrationGrant(appConfig, attemptId);
        res.json({ status: "phone_verified", registration_grant: grant.token, registration_grant_expires_at: grant.expiresAt, next_action: "complete_registration", request_id: req.requestId });
        return;
      }
      const result = await verifyOtpChallenge(prisma, {
        attemptId,
        code: input.otp,
        key: onboarding.keys.otpCode
      });
      if (!result.verified) {
        const attempt = await prisma.onboardingAttempt.findUnique({
          where: { id: attemptId },
          include: { current_challenge: true }
        });
        await failIdempotency(prisma, { recordId: claim.record.id, claimVersion: claim.record.claim_version });
        claim = undefined;
        if (attempt?.status === "locked") throw new HttpError(423, "verification_locked");
        if (!attempt || attempt.expires_at <= new Date() || attempt.current_challenge?.expires_at && attempt.current_challenge.expires_at <= new Date()) {
          throw new HttpError(410, "verification_expired");
        }
        throw new HttpError(400, "verification_failed");
      }
      const grant = await issueRegistrationGrant(appConfig, attemptId);
      await completeIdempotency(prisma, {
        recordId: claim.record.id,
        claimVersion: claim.record.claim_version,
        resourceType: "OnboardingAttempt",
        resourceId: attemptId,
        responseStatus: 200
      });
      res.json({ status: "phone_verified", registration_grant: grant.token, registration_grant_expires_at: grant.expiresAt, next_action: "complete_registration", request_id: req.requestId });
    } catch (error) {
      if (claim?.kind === "claimed") {
        await failIdempotency(prisma, { recordId: claim.record.id, claimVersion: claim.record.claim_version }).catch(() => undefined);
      }
      next(error);
    }
  });

  router.post("/onboarding/attempts/:id/complete", completionContinuation, async (req: OnboardingAuthenticatedRequest, res, next) => {
    let claim: Awaited<ReturnType<typeof claimPublicOperation>> | undefined;
    try {
      const attemptId = String(req.params.id);
      if (req.onboarding!.attemptId !== attemptId) throw new HttpError(401, "onboarding_unavailable");
      const input = completionSchema.parse(req.body);
      const displayName = safeDisplayName(input.display_name);
      validatePassword(input.password);
      const distinctTypes = new Set(input.consents.map((consent) => consent.type));
      if (distinctTypes.size !== REQUIRED_CONSENTS.length || REQUIRED_CONSENTS.some((type) => !distinctTypes.has(type))) {
        throw new HttpError(400, "validation_error");
      }
      await consumeBuckets(req, appConfig, [
        { type: "registration_attempt", subject: attemptId, seconds: 3_600, limit: 10 },
        { type: "registration_ip", subject: requestIp(req), seconds: 3_600, limit: 20 },
        { type: "registration_grant", subject: input.registration_grant, seconds: 3_600, limit: 10 }
      ]);
      claim = await claimPublicOperation(req, appConfig, {
        operation: "onboarding_complete",
        scope: attemptId,
        payload: { ...input, display_name: displayName }
      });
      if (req.onboarding!.completedReplayOnly && claim.kind !== "replay") {
        if (claim.kind === "claimed") {
          await failIdempotency(prisma, {
            recordId: claim.record.id,
            claimVersion: claim.record.claim_version
          }).catch(() => undefined);
          claim = undefined;
        }
        throw new HttpError(401, "onboarding_unavailable");
      }
      if (claim.kind === "replay") {
        const attempt = await prisma.onboardingAttempt.findUnique({ where: { id: attemptId }, include: { completed_user: true } });
        if (!attempt?.completed_user) throw new HttpError(409, "registration_conflict");
        const pending = ["driver", "merchant"].includes(attempt.completed_user.role)
          ? await rotatePendingStatusSession(appConfig, attemptId, attempt.completed_user.id)
          : undefined;
        res.json(
          safeOutcome(
            attempt.completed_user,
            req.requestId,
            pending
              ? { token: pending.token, expiresAt: pending.session.expires_at }
              : undefined
          )
        );
        return;
      }
      const passwordHash = await bcrypt.hash(input.password, 10);
      const pendingToken = randomBytes(32).toString("base64url");
      const outcome = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM onboarding_attempts WHERE id = ${attemptId} FOR UPDATE`;
        const now = new Date();
        const attempt = await tx.onboardingAttempt.findUnique({
          where: { id: attemptId },
          include: { invitation: true, redemption: true }
        });
        if (
          !attempt ||
          attempt.status !== "phone_verified" ||
          attempt.expires_at <= now ||
          attempt.completed_user_id ||
          (attempt.invitation_id !== null
            ? !attempt.redemption ||
              attempt.redemption.invitation_id !== attempt.invitation_id ||
              !attempt.invitation ||
              attempt.invitation.revoked_at ||
              attempt.invitation.used_count !== 1 ||
              attempt.invitation.expires_at <= now
            : !appConfig.openSignupEnabled || attempt.intended_role === "passenger") ||
          !attempt.registration_grant_digest ||
          attempt.registration_grant_key_version !== appConfig.onboarding!.keys.onboardingSession.version ||
          !attempt.registration_grant_expires_at ||
          attempt.registration_grant_expires_at <= now ||
          !hexDigestMatches(
            attempt.registration_grant_digest,
            registrationGrantDigest(input.registration_grant, appConfig.onboarding!.keys.onboardingSession)
          )
        ) throw new HttpError(409, "registration_grant_invalid");
        // An Admin invitation outranks a self-typed, unverified phone; open sign-up never takes a held number.
        const phoneFree = attempt.invitation_id !== null
          ? await releaseUnverifiedPhone(tx, attempt.phone_e164, req.requestId, attempt.invitation_id)
          : !(await tx.user.findUnique({ where: { phone: attempt.phone_e164 }, select: { id: true } }));
        if (!phoneFree) throw new HttpError(409, "registration_conflict");
        const documents = await currentConsentDocuments(tx, input.locale, now);
        if (documents.length !== REQUIRED_CONSENTS.length) throw new HttpError(409, "consent_version_changed");
        for (const document of documents) {
          const accepted = input.consents.find((consent) => consent.type === document.document_type);
          if (!accepted || accepted.id !== document.id || !hexDigestMatches(accepted.content_hash, document.content_digest)) {
            throw new HttpError(409, "consent_version_changed");
          }
        }
        const pending = attempt.intended_role === "driver" || attempt.intended_role === "merchant";
        // Email-delivered code: it proves the mailbox, not the phone. The mailbox becomes the verified sign-in
        // identity; the phone counts as verified only when an Admin vouched for it through an invitation.
        const emailProven = provider.provesPhone === false && attempt.delivery_email !== null;
        const phoneVouched = attempt.invitation_id !== null || provider.provesPhone !== false;
        if (emailProven && (await tx.user.findUnique({ where: { email: attempt.delivery_email! }, select: { id: true } }))) {
          throw new HttpError(409, "registration_conflict");
        }
        const user = await tx.user.create({
          data: {
            name: displayName,
            phone: attempt.phone_e164,
            ...(emailProven ? { email: attempt.delivery_email, email_verified_at: now } : {}),
            // Admin-issued invitation (or a provider that proves the phone): trusted. Open sign-up by email: unverified.
            phone_verified_at: phoneVouched ? now : null,
            profile_state: "complete",
            password_hash: passwordHash,
            role: attempt.intended_role,
            account_status: pending ? "pending" : "active",
            security_version: 1,
            status_updated_at: now,
            last_login_at: null,
            demo_account: false,
            // Invited applicants are in the review queue at once; open-signup applicants must
            // upload their documents and submit first (POST /onboarding/application/submit).
            review_submitted_at: pending && attempt.invitation_id === null ? null : now
          }
        });
        if (attempt.intended_role === "driver") {
          await tx.driverVerification.create({
            data: {
              user_id: user.id,
              status: "pending",
              submitted_at: now
            }
          });
        }
        await tx.userConsent.createMany({
          data: documents.map((document) => ({
            user_id: user.id,
            consent_document_id: document.id,
            accepted_at: now,
            request_id: req.requestId,
            ip_digest: abuseSubjectDigest("consent_ip", requestIp(req), appConfig.onboarding!.keys.abuse),
            ip_digest_version: appConfig.onboarding!.keys.abuse.version,
            source: "public_onboarding",
            app_release: appConfig.appRelease
          }))
        });
        if (attempt.redemption) {
          await tx.invitationRedemption.update({ where: { id: attempt.redemption.id }, data: { user_id: user.id } });
        }
        await tx.onboardingAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "completed",
            completed_user_id: user.id,
            completed_at: now,
            registration_grant_digest: null,
            registration_grant_key_version: null,
            registration_grant_expires_at: null
          }
        });
        await tx.onboardingSession.updateMany({
          where: { onboarding_attempt_id: attempt.id, purpose: { in: ["continuation", "onboarding_completion"] }, revoked_at: null },
          data: { revoked_at: now, revoke_reason: "registration_completed" }
        });
        let statusToken: { token: string; expiresAt: Date } | undefined;
        if (pending) {
          const statusSession = await tx.onboardingSession.create({
            data: onboardingSessionTokenData({
              token: pendingToken,
              key: appConfig.onboarding!.keys.onboardingSession,
              attemptId: attempt.id,
              userId: user.id,
              purpose: "pending_status",
              expiresAt: new Date(now.getTime() + appConfig.publicRegistration!.pendingStatusTtlDays * 86_400_000)
            })
          });
          statusToken = {
            token: pendingToken,
            expiresAt: statusSession.expires_at
          };
          await auditEvent(tx, {
            userId: user.id,
            action: AuditAction.pending_status_session_created,
            entityType: "OnboardingSession",
            entityId: statusSession.id,
            metadata: { role: user.role, request_id: req.requestId }
          });
        }
        await auditEvent(tx, {
          userId: user.id,
          action: AuditAction.registration_completed,
          entityType: "User",
          entityId: user.id,
          metadata: { role: user.role, account_status: user.account_status, request_id: req.requestId }
        });
        await completeIdempotency(tx, {
          recordId: claim!.record.id,
          claimVersion: claim!.record.claim_version,
          resourceType: "User",
          resourceId: user.id,
          responseStatus: 201
        });
        return { user, statusToken };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      claim = undefined;
      res.status(201).json(safeOutcome(outcome.user, req.requestId, outcome.statusToken));
    } catch (error) {
      if (claim?.kind === "claimed") {
        await failIdempotency(prisma, { recordId: claim.record.id, claimVersion: claim.record.claim_version }).catch(() => undefined);
      }
      const safeError = error instanceof HttpError ? error.message : error instanceof z.ZodError ? "validation_error" : "registration_conflict";
      const attemptId = String(req.params.id);
      await auditEvent(prisma, {
        action: AuditAction.registration_completion_failed,
        entityType: "OnboardingAttempt",
        entityId: attemptId,
        metadata: { outcome: safeError, request_id: req.requestId }
      }).catch(() => undefined);
      const finalError = error instanceof HttpError || error instanceof z.ZodError ? error : new HttpError(409, "registration_conflict");
      if (finalError instanceof HttpError && finalError.message === "registration_conflict") {
        // registration_conflict reveals that a number/mailbox is registered: cap how many one source can collect.
        try {
          await consumeBuckets(req, appConfig, [
            { type: "registration_conflict_ip", subject: requestIp(req), seconds: 3_600, limit: REGISTRATION_CONFLICT_IP_HOURLY_LIMIT }
          ]);
        } catch (limited) {
          if (limited instanceof HttpError) { next(limited); return; }
        }
      }
      next(finalError);
    }
  });

  router.get("/onboarding/status", statusToken, async (req: OnboardingAuthenticatedRequest, res, next) => {
    try {
      const context = req.onboarding!;
      if (context.purpose === "pending_status") {
        if (context.userStatus === "pending") {
          await auditEvent(prisma, {
            userId: context.userId,
            action: AuditAction.onboarding_status_accessed,
            entityType: "OnboardingAttempt",
            entityId: context.attemptId,
            metadata: { outcome: "pending_review", role: context.userRole, request_id: req.requestId }
          });
          const applicant = context.userId
            ? await prisma.user.findUnique({ where: { id: context.userId }, select: { review_submitted_at: true } })
            : null;
          if (applicant && applicant.review_submitted_at === null) {
            res.json({
              role: context.userRole,
              onboarding_status: "documents_required",
              next_action: "upload_documents",
              required_documents: [...requiredDocumentKinds(context.userRole ?? "")],
              missing_documents: await missingDocumentKinds(prisma, context.userId!, context.userRole ?? ""),
              request_id: req.requestId
            });
            return;
          }
          res.json({ role: context.userRole, onboarding_status: "pending_review", next_action: "await_approval", request_id: req.requestId });
          return;
        }
        if (context.userStatus === "active") {
          await prisma.onboardingSession.updateMany({
            where: { id: context.sessionId, revoked_at: null },
            data: { revoked_at: new Date(), revoke_reason: "account_activated" }
          });
          res.json({ role: context.userRole, onboarding_status: "approved_sign_in", next_action: "login", request_id: req.requestId });
          return;
        }
        throw new HttpError(403, "account_unavailable");
      }
      const status = context.attemptStatus === "phone_verified" ? "phone_verified" : "in_progress";
      res.json({
        role: (await prisma.onboardingAttempt.findUniqueOrThrow({ where: { id: context.attemptId }, select: { intended_role: true } })).intended_role,
        onboarding_status: status,
        next_action: status === "phone_verified" ? "complete_registration" : "verify_otp",
        request_id: req.requestId
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/onboarding/status-sessions", async (req, res, next) => {
    try {
      const input = recoverySchema.parse(req.body);
      let phone: string;
      try { phone = normalizePhoneToE164(input.phone, { region: input.region }); }
      catch { throw new HttpError(401, "invalid_credentials"); }
      await consumeBuckets(req, appConfig, [
        { type: "pending_recovery_phone", subject: phone, seconds: 3_600, limit: 10 },
        { type: "pending_recovery_ip", subject: requestIp(req), seconds: 3_600, limit: 20 }
      ]);
      const user = await prisma.user.findUnique({
        where: { phone },
        include: { onboarding_attempts: { where: { status: "completed" }, orderBy: { completed_at: "desc" }, take: 1 } }
      });
      const hash = user?.password_hash ?? await dummyHash;
      const validPassword = await bcrypt.compare(input.password, hash);
      const attempt = user?.onboarding_attempts[0];
      if (
        !validPassword ||
        !user ||
        !attempt ||
        user.account_status !== "pending" ||
        !["driver", "merchant"].includes(user.role)
      ) throw new HttpError(401, "invalid_credentials");
      const rotated = await rotatePendingStatusSession(appConfig, attempt.id, user.id);
      res.json({
        role: user.role,
        onboarding_status: user.review_submitted_at === null ? "documents_required" : "pending_review",
        next_action: user.review_submitted_at === null ? "upload_documents" : "await_approval",
        onboarding_status_token: rotated.token,
        onboarding_status_expires_at: rotated.session.expires_at,
        request_id: req.requestId
      });
    } catch (error) {
      next(error instanceof z.ZodError ? new HttpError(401, "invalid_credentials") : error);
    }
  });

  return router;
}
