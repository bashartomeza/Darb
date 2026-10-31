import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config, type AppConfig } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { hasVerifiedContact } from "../lib/contactVerification.js";
import { normalizePhoneToE164, PHONE_INPUT_MAX_LENGTH } from "../lib/phone.js";
import {
  createRefreshToken,
  isRefreshTokenRole,
  parseRefreshToken,
  refreshTokenExpiresAt,
  refreshTokenHashMatches,
  revokeAllUserSessions,
  revokeSessionRecords
} from "../lib/refreshTokens.js";
import {
  requireAuth,
  requireLogoutAuth,
  signAuthToken,
  type AuthUser,
  type AuthenticatedRequest
} from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction, Prisma } from "../generated/prisma/client.js";
import type { GoogleVerifier } from "../lib/googleIdentity.js";
import { GoogleAuthService, googleCompleteSchema } from "../services/googleAuth.js";
import { EmailAuthService, canonicalEmail, emailStartSchema, emailCompleteSchema, emailProofStartSchema, emailProofConfirmSchema, passwordResetSchema, passwordSetSchema, type EmailDelivery } from "../services/emailAuth.js";
import type { ConsentReleaseService } from "../services/consentReleases.js";
import { createAuthenticatedAuthRateLimiter } from "../middleware/rateLimit.js";
import { IdentityProfileService, googleLinkSchema, phoneStartSchema, phoneConfirmSchema, type PhoneVerificationProvider } from "../services/identityProfile.js";

const emailField = canonicalEmail;
const deviceNameField = z.string().trim().min(1).max(120).optional();

// Exactly one identifier: an email, or an international phone number for accounts
// whose phone was verified at an invited sign-up.
const loginSchema = z
  .object({
    email: emailField.optional(),
    phone: z.string().trim().min(7).max(PHONE_INPUT_MAX_LENGTH).optional(),
    password: z.string().min(1).max(200),
    device_name: deviceNameField
  })
  .refine((value) => Boolean(value.email) !== Boolean(value.phone), { message: "one_identifier_required" });
const googleSchema = z.strictObject({
  id_token: z.string().min(1).max(8192),
  device_name: deviceNameField
});
const refreshSchema = z.object({ refresh_token: z.string().min(1).max(160) });

function publicUser(user: {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  account_status: string;
  demo_account: boolean;
  profile_state?: string;
  email_verified_at?: Date | null;
  phone_verified_at?: Date | null;
}) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    account_status: user.account_status,
    demo_account: user.demo_account,
    profile_state: user.profile_state,
    email_verified: hasVerifiedContact(user)
  };
}

type SessionUser = {
  id: string;
  role: AuthUser["role"];
  security_version: number;
  demo_account: boolean;
};

/**
 * Creates a mobile/admin session for an already-authenticated user: rotates in
 * a fresh refresh token, writes the login + session-created audit trail, and
 * signs an access token. Shared by password login, email registration, and
 * Google sign-in so the session invariants live in exactly one place.
 */
export async function establishMobileSession(
  user: SessionUser,
  options: {
    deviceName?: string;
    loginAction: AuditAction;
    loginMetadata?: Prisma.InputJsonValue;
  },
  transaction?: Prisma.TransactionClient
) {
  const now = new Date();
  const refreshMaterial = isRefreshTokenRole(user.role) ? createRefreshToken(user.role) : null;
  const clientType = refreshMaterial ? "mobile" : "admin";
  const refreshExpiresAt = refreshMaterial ? refreshTokenExpiresAt(now) : null;
  const sessionExpiresAt =
    refreshExpiresAt ?? new Date(now.getTime() + config.accessTokenTtlSeconds * 1_000);

  const create = async (tx: Prisma.TransactionClient) => {
    const eligible = await tx.user.updateMany({
      where: {
        id: user.id,
        role: user.role,
        account_status: "active",
        security_version: user.security_version
      },
      data: { last_login_at: now }
    });
    if (eligible.count !== 1) return { kind: "account_unavailable" } as const;

    const created = await tx.authSession.create({
      data: {
        user_id: user.id,
        client_type: clientType,
        device_name: options.deviceName?.replace(/\s+/g, " "),
        created_at: now,
        last_used_at: now,
        expires_at: sessionExpiresAt,
        security_version_at_issue: user.security_version
      }
    });
    if (refreshMaterial && refreshExpiresAt) {
      await tx.refreshToken.create({
        data: {
          id: refreshMaterial.id,
          session_id: created.id,
          token_hash: refreshMaterial.tokenHash,
          created_at: now,
          expires_at: refreshExpiresAt
        }
      });
    }
    await auditEvent(tx, {
      userId: user.id,
      action: options.loginAction,
      entityType: "User",
      entityId: user.id,
      metadata: options.loginMetadata ?? { role: user.role, demo_account: user.demo_account }
    });
    await auditEvent(tx, {
      userId: user.id,
      action: AuditAction.session_created,
      entityType: "AuthSession",
      entityId: created.id,
      metadata: { client_type: clientType }
    });
    const token = accessToken(user, created.id);
    return { kind: "success", session: created, token } as const;
  };
  const result = transaction ? await create(transaction) : await prisma.$transaction(create);

  if (result.kind === "account_unavailable") {
    await auditEvent(transaction ?? prisma, {
      userId: user.id,
      action: AuditAction.login_blocked_by_status,
      entityType: "User",
      entityId: user.id,
      metadata: { account_status: "changed_during_login" }
    });
    throw new HttpError(403, "account_unavailable");
  }

  return { token: result.token, session: result.session, refreshMaterial };
}

function sessionResponseBody(
  established: Awaited<ReturnType<typeof establishMobileSession>>,
  user: Parameters<typeof publicUser>[0]
) {
  return {
    token: established.token,
    access_token: established.token,
    access_token_expires_in: config.accessTokenTtlSeconds,
    ...(established.refreshMaterial
      ? {
          refresh_token: established.refreshMaterial.rawToken,
          refresh_token_expires_in: config.refreshTokenTtlDays * 24 * 60 * 60
        }
      : {}),
    session: safeSession(established.session, established.session.id),
    user: publicUser(user)
  };
}

function safeSession(
  session: {
    id: string;
    client_type: string;
    device_name: string | null;
    created_at: Date;
    last_used_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
  },
  currentSessionId?: string
) {
  return {
    id: session.id,
    client_type: session.client_type,
    device_name: session.device_name,
    created_at: session.created_at,
    last_used_at: session.last_used_at,
    expires_at: session.expires_at,
    is_current: session.id === currentSessionId,
    revoked: session.revoked_at !== null
  };
}

function accessToken(user: { id: string; role: AuthUser["role"]; security_version: number }, sessionId: string) {
  return signAuthToken({
    id: user.id,
    role: user.role,
    sessionId,
    securityVersion: user.security_version
  });
}

function refreshFailure(status: number, error: string): never {
  throw new HttpError(status, error);
}

async function markRefreshReuse(
  tx: Prisma.TransactionClient,
  input: { sessionId: string; userId: string }
) {
  await revokeSessionRecords(tx, { sessionId: input.sessionId, reason: "refresh_token_reuse" });
  await auditEvent(tx, {
    userId: input.userId,
    action: AuditAction.refresh_token_reuse_detected,
    entityType: "AuthSession",
    entityId: input.sessionId,
    metadata: { detection: "used_refresh_token" }
  });
}

export function createAuthRouter(appConfig: AppConfig = config, dependencies: { emailDelivery?: EmailDelivery; consentReleaseService?: ConsentReleaseService; googleVerifier?: GoogleVerifier; phoneVerificationProvider?: PhoneVerificationProvider } = {}) {
const authRouter = Router();
const emailAuth = new EmailAuthService(prisma, appConfig, dependencies.emailDelivery, dependencies.consentReleaseService);
const googleAuth = new GoogleAuthService(prisma, appConfig, dependencies.googleVerifier, dependencies.consentReleaseService);
const passwordSetRateLimiter = createAuthenticatedAuthRateLimiter(appConfig);
const identityProfile = new IdentityProfileService(prisma, appConfig, dependencies.emailDelivery, dependencies.phoneVerificationProvider, dependencies.googleVerifier);

authRouter.post("/auth/identities/google/link/start", requireAuth, passwordSetRateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try { const input = z.strictObject({ locale: z.enum(["ar", "en"]) }).parse(req.body); res.status(202).json(await identityProfile.linkStart(req.user!.id, req.user!.securityVersion, input.locale)); } catch (error) { next(error); }
});
authRouter.post("/auth/identities/google/link", requireAuth, passwordSetRateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try { res.json(await identityProfile.link(req.user!.id, req.user!.securityVersion, googleLinkSchema.parse(req.body))); } catch (error) { next(error); }
});
authRouter.post("/profile/phone/start-verification", requireAuth, passwordSetRateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try { res.status(202).json(await identityProfile.phoneStart(req.user!.id, req.user!.securityVersion, phoneStartSchema.parse(req.body))); } catch (error) { next(error); }
});
authRouter.post("/profile/phone/confirm-verification", requireAuth, passwordSetRateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try { res.json(await identityProfile.phoneConfirm(req.user!.id, req.user!.securityVersion, phoneConfirmSchema.parse(req.body))); } catch (error) { next(error); }
});

authRouter.get("/auth/capabilities", (_req, res) => {
  res.json({
    google_mobile_login_available: appConfig.googleAuth.mobileClientIds.length > 0,
    google_admin_login_available: appConfig.googleAuth.adminClientIds.length === 1,
    google_admin_client_id: appConfig.googleAuth.adminClientIds.length === 1 ? appConfig.googleAuth.adminClientIds[0] : null,
    google_passenger_signup_mode: appConfig.googleAuth.passengerSignupMode
  });
});

authRouter.get("/auth/consents", async (req, res, next) => {
  try { res.json(await emailAuth.currentConsents(z.enum(["ar", "en"]).parse(req.query.locale))); } catch (error) { next(error); }
});

authRouter.post(["/auth/login", "/auth/mobile/login", "/auth/admin/login"], async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    // The Admin console signs in with email only.
    if (input.phone && req.path.toLowerCase().replace(/\/+$/, "") === "/auth/admin/login") throw new HttpError(400, "validation_error");
    let user = null;
    if (input.phone) {
      let phone: string | null = null;
      try {
        phone = normalizePhoneToE164(input.phone);
      } catch {
        phone = null;
      }
      user = phone ? await prisma.user.findUnique({ where: { phone } }) : null;
      // Phone sign-in is only for non-admin accounts whose phone was verified by a one-time code.
      if (user && (user.role === "admin" || !user.phone_verified_at)) user = null;
    } else {
      user = await prisma.user.findUnique({ where: { email: input.email! } });
    }
    if (!user || !user.password_hash) throw new HttpError(401, "invalid_credentials");
    const loginPath = req.path.toLowerCase().replace(/\/+$/, "");
    if (loginPath === "/auth/admin/login" && user.role !== "admin") throw new HttpError(401, "invalid_credentials");

    const validPassword = await bcrypt.compare(input.password, user.password_hash);
    if (!validPassword) throw new HttpError(401, "invalid_credentials");
    if (!user.email_verified_at && !(input.phone && hasVerifiedContact(user))) throw new HttpError(403, "email_verification_required");
    if (loginPath === "/auth/mobile/login" && user.role === "admin") throw new HttpError(401, "invalid_credentials");
    if (user.account_status !== "active") {
      await auditEvent(prisma, {
        userId: user.id,
        action: AuditAction.login_blocked_by_status,
        entityType: "User",
        entityId: user.id,
        metadata: { account_status: user.account_status }
      });
      throw new HttpError(403, "account_unavailable");
    }

    const established = await establishMobileSession(user, {
      deviceName: input.device_name,
      loginAction: AuditAction.auth_login,
      loginMetadata: { role: user.role, demo_account: user.demo_account, method: "password" }
    });
    res.json(sessionResponseBody(established, user));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/auth/register", (_req, _res, next) => next(new HttpError(410, "registration_flow_required")));

authRouter.post("/auth/mobile/register/start", async (req, res, next) => {
  try { res.status(202).json(await emailAuth.start(emailStartSchema.parse(req.body))); } catch (error) { next(error); }
});
authRouter.post("/auth/mobile/register/complete", async (req, res, next) => {
  try {
    const input = emailCompleteSchema.parse(req.body);
    const result = await emailAuth.complete(input, (tx, user) => establishMobileSession(user, {
      deviceName: input.device_name, loginAction: AuditAction.auth_register, loginMetadata: { method: "email", role: "passenger" }
    }, tx), req.requestId);
    res.status(201).json(sessionResponseBody(result.session, result.user));
  } catch (error) { next(error); }
});
authRouter.post("/auth/email/verify/start", async (req, res, next) => {
  try { res.status(202).json(await emailAuth.proofStart(emailProofStartSchema.parse(req.body), "email_verification", req.operationalLog)); } catch (error) { next(error); }
});
authRouter.post("/auth/email/verify/confirm", async (req, res, next) => {
  try { res.json(await emailAuth.verify(emailProofConfirmSchema.parse(req.body))); } catch (error) { next(error); }
});
authRouter.post("/auth/password/reset/start", async (req, res, next) => {
  try { res.status(202).json(await emailAuth.proofStart(emailProofStartSchema.parse(req.body), "password_reset", req.operationalLog)); } catch (error) { next(error); }
});
authRouter.post("/auth/password/reset/confirm", async (req, res, next) => {
  try { res.json(await emailAuth.reset(passwordResetSchema.parse(req.body))); } catch (error) { next(error); }
});
authRouter.post("/auth/password/set/start", requireAuth, passwordSetRateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = z.strictObject({ locale: z.enum(["ar", "en"]) }).parse(req.body);
    res.status(202).json(await emailAuth.passwordSetStart(req.user!.id, input.locale));
  } catch (error) { next(error); }
});
authRouter.post("/auth/password/set", requireAuth, passwordSetRateLimiter, async (req: AuthenticatedRequest, res, next) => {
  try { res.json(await emailAuth.setPassword(req.user!.id, req.user!.securityVersion, passwordSetSchema.parse(req.body))); } catch (error) { next(error); }
});

authRouter.post(["/auth/google", "/auth/mobile/google"], async (req, res, next) => {
  try {
    const input = googleSchema.parse(req.body);
    const result = await googleAuth.start(input.id_token);
    if (result.kind === "registration") {
      const { kind: _kind, ...grant } = result;
      res.status(202).json(grant);
      return;
    }
    const established = await establishMobileSession(result.user, {
      deviceName: input.device_name, loginAction: AuditAction.auth_google_login,
      loginMetadata: { method: "google", role: result.user.role }
    });
    res.json(sessionResponseBody(established, result.user));
  } catch (error) { next(error); }
});

authRouter.post("/auth/admin/google", async (req, res, next) => {
  try {
    const input = googleSchema.parse(req.body);
    const user = await googleAuth.adminLogin(input.id_token);
    const established = await establishMobileSession(user, { deviceName: input.device_name, loginAction: AuditAction.auth_google_login, loginMetadata: { method: "google", role: "admin" } });
    res.json(sessionResponseBody(established, user));
  } catch (error) { next(error); }
});

authRouter.post("/auth/mobile/google/complete-registration", async (req, res, next) => {
  try {
    const input = googleCompleteSchema.parse(req.body);
    const result = await googleAuth.complete(input, (tx, user) => establishMobileSession(user, {
      deviceName: input.device_name, loginAction: AuditAction.auth_register,
      loginMetadata: { method: "google", role: "passenger" }
    }, tx), req.requestId);
    res.status(201).json(sessionResponseBody(result.session, result.user));
  } catch (error) { next(error); }
});

authRouter.post("/auth/refresh", async (req, res, next) => {
  try {
    const input = refreshSchema.parse(req.body);
    const parsed = parseRefreshToken(input.refresh_token);
    if (!parsed) refreshFailure(401, "invalid_refresh_token");

    const now = new Date();
    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.refreshToken.findUnique({
          where: { id: parsed.id },
          include: { session: { include: { user: true } } }
        });
        if (!current || !refreshTokenHashMatches(parsed.rawToken, current.token_hash)) {
          return { kind: "invalid" } as const;
        }
        if (
          current.session.client_type !== "mobile" ||
          current.session.user.role === "admin" ||
          current.session.user.role !== parsed.roleAtIssue
        ) {
          await revokeSessionRecords(tx, {
            sessionId: current.session_id,
            reason: "refresh_role_or_client_changed",
            now
          });
          await auditEvent(tx, {
            userId: current.session.user_id,
            action: AuditAction.session_revoked,
            entityType: "AuthSession",
            entityId: current.session_id,
            metadata: { reason: "refresh_role_or_client_changed" }
          });
          return { kind: "invalid_session" } as const;
        }
        if (current.used_at) {
          await markRefreshReuse(tx, {
            sessionId: current.session_id,
            userId: current.session.user_id
          });
          return { kind: "reused" } as const;
        }
        if (current.revoked_at || current.expires_at.getTime() <= now.getTime()) return { kind: "invalid" } as const;
        if (current.session.revoked_at) return { kind: "session_revoked" } as const;
        if (current.session.expires_at.getTime() <= now.getTime()) return { kind: "session_expired" } as const;
        if (current.session.user.account_status !== "active") return { kind: "account_unavailable" } as const;
        if (
          current.session.security_version_at_issue !== current.session.user.security_version
        ) return { kind: "invalid_session" } as const;

        const replacement = createRefreshToken(parsed.roleAtIssue);
        const configuredReplacementExpiry = refreshTokenExpiresAt(now);
        const replacementExpiresAt = new Date(
          Math.min(configuredReplacementExpiry.getTime(), current.session.expires_at.getTime())
        );

        const consumed = await tx.refreshToken.updateMany({
          where: { id: current.id, used_at: null, revoked_at: null, expires_at: { gt: now } },
          data: { used_at: now }
        });
        if (consumed.count !== 1) {
          const raced = await tx.refreshToken.findUnique({ where: { id: current.id } });
          if (raced?.used_at) {
            await markRefreshReuse(tx, {
              sessionId: current.session_id,
              userId: current.session.user_id
            });
            return { kind: "reused" } as const;
          }
          return { kind: "invalid" } as const;
        }

        await tx.refreshToken.create({
          data: {
            id: replacement.id,
            session_id: current.session_id,
            token_hash: replacement.tokenHash,
            created_at: now,
            expires_at: replacementExpiresAt
          }
        });
        await tx.refreshToken.update({
          where: { id: current.id },
          data: { replaced_by_id: replacement.id }
        });
        const session = await tx.authSession.update({
          where: { id: current.session_id },
          data: { last_used_at: now }
        });
        await auditEvent(tx, {
          userId: current.session.user_id,
          action: AuditAction.session_refreshed,
          entityType: "AuthSession",
          entityId: current.session_id,
          metadata: { rotation: "one_time" }
        });
        const token = accessToken(current.session.user, session.id);
        return {
          kind: "success",
          session,
          user: current.session.user,
          token,
          refreshToken: replacement.rawToken,
          refreshTokenExpiresIn: Math.max(0, Math.floor((replacementExpiresAt.getTime() - now.getTime()) / 1_000))
        } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    if (result.kind === "invalid") refreshFailure(401, "invalid_refresh_token");
    if (result.kind === "reused") refreshFailure(401, "refresh_token_reused");
    if (result.kind === "session_revoked") refreshFailure(401, "session_revoked");
    if (result.kind === "session_expired") refreshFailure(401, "session_expired");
    if (result.kind === "account_unavailable") refreshFailure(403, "account_unavailable");
    if (result.kind === "invalid_session") refreshFailure(401, "invalid_session");

    res.json({
      token: result.token,
      access_token: result.token,
      access_token_expires_in: config.accessTokenTtlSeconds,
      refresh_token: result.refreshToken,
      refresh_token_expires_in: result.refreshTokenExpiresIn,
      session: safeSession(result.session, result.session.id),
      user: publicUser(result.user)
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new HttpError(404, "user_not_found");
    // A driver's own trust score and vehicle capacity previously had no
    // endpoint at all, so the app filled those cards with invented numbers.
    // They are plain DriverProfile columns; the owner may read their own.
    const driverProfile =
      user.role === "driver"
        ? await prisma.driverProfile.findUnique({
            where: { user_id: user.id },
            select: { vehicle_type: true, seats_total: true, parcel_capacity: true, verified: true, trust_score: true }
          })
        : null;
    res.json({ user: publicUser(user), ...(driverProfile ? { driver_profile: driverProfile } : {}) });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/auth/sessions", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const sessions = await prisma.authSession.findMany({
      where: { user_id: req.user!.id },
      orderBy: { created_at: "desc" }
    });
    res.json({ sessions: sessions.map((session) => safeSession(session, req.user!.sessionId)) });
  } catch (error) {
    next(error);
  }
});

authRouter.delete("/auth/sessions/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const session = await prisma.authSession.findFirst({ where: { id, user_id: req.user!.id } });
    if (!session) throw new HttpError(404, "session_not_found");
    await prisma.$transaction(async (tx) => {
      await revokeSessionRecords(tx, { sessionId: session.id, reason: "user_revoked" });
      if (!session.revoked_at) {
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.session_revoked,
          entityType: "AuthSession",
          entityId: session.id,
          metadata: { current: session.id === req.user!.sessionId }
        });
      }
    });
    res.json({ ok: true, session: { id: session.id, revoked: true } });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/auth/logout", requireLogoutAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const session = await prisma.authSession.findUnique({ where: { id: req.user!.sessionId } });
    await prisma.$transaction(async (tx) => {
      await revokeSessionRecords(tx, { sessionId: req.user!.sessionId, reason: "logout" });
      if (session && !session.revoked_at) {
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.session_revoked,
          entityType: "AuthSession",
          entityId: req.user!.sessionId,
          metadata: { source: "logout" }
        });
      }
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/auth/logout-all", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      await revokeAllUserSessions(tx, { userId: req.user!.id, reason: "logout_all" });
      await tx.user.update({ where: { id: req.user!.id }, data: { security_version: { increment: 1 } } });
      await auditEvent(tx, {
        userId: req.user!.id,
        action: AuditAction.logout_all,
        entityType: "User",
        entityId: req.user!.id,
        metadata: { request_id: req.requestId }
      });
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
return authRouter;
}
