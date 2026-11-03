import { hasVerifiedContact } from "../lib/contactVerification.js";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import {
  adminSessionAbsoluteEnd,
  adminSessionExpiresAt,
  assertAdminSessionRequest,
  clearAdminSessionCookie,
  readAdminSessionCookie
} from "./adminSession.js";
import { HttpError } from "./error.js";

/**
 * How a request proved its identity: a Bearer access token (mobile apps and
 * operator tooling) or the HttpOnly Admin console session cookie.
 */
export type AuthTransport = "bearer" | "admin_cookie";

export type AuthUser = {
  id: string;
  role: "passenger" | "driver" | "merchant" | "admin";
  sessionId: string;
  securityVersion: number;
  profileState?: "phone_required" | "complete";
  emailVerified?: boolean;
  transport?: "admin_cookie";
};

export type AuthenticatedRequest = Request & {
  user?: AuthUser;
};

// Marks a JWT minted for the Admin session cookie. Bearer authentication refuses
// it and cookie authentication accepts nothing else, so neither credential can
// stand in for the other.
const ADMIN_COOKIE_TOKEN_USE = "admin_cookie";

export function signAuthToken(user: AuthUser) {
  return jwt.sign(
    { role: user.role, sid: user.sessionId, ver: user.securityVersion },
    config.jwtSecret,
    { algorithm: "HS256", subject: user.id, expiresIn: config.accessTokenTtlSeconds }
  );
}

/**
 * The Admin cookie's signed value. Its signature lifetime is the absolute
 * session limit; the idle limit is enforced on the server-side AuthSession.
 */
export function signAdminCookieToken(user: AuthUser) {
  return jwt.sign(
    { role: user.role, sid: user.sessionId, ver: user.securityVersion, use: ADMIN_COOKIE_TOKEN_USE },
    config.jwtSecret,
    { algorithm: "HS256", subject: user.id, expiresIn: config.adminSession.absoluteTimeoutSeconds }
  );
}

export function verifyAuthToken(token: string, transport: AuthTransport = "bearer"): AuthUser {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, transport === "admin_cookie" ? "session_expired" : "access_token_expired");
    }
    throw new HttpError(401, "invalid_token");
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    typeof payload.ver !== "number" ||
    !Number.isSafeInteger(payload.ver)
  ) throw new HttpError(401, "invalid_token");

  const role = payload.role;
  if (role !== "passenger" && role !== "driver" && role !== "merchant" && role !== "admin") {
    throw new HttpError(401, "invalid_token");
  }
  if (transport === "admin_cookie" ? payload.use !== ADMIN_COOKIE_TOKEN_USE || role !== "admin" : payload.use !== undefined) {
    throw new HttpError(401, "invalid_token");
  }

  return { id: payload.sub, role, sessionId: payload.sid, securityVersion: payload.ver };
}

export async function authenticateAuthToken(
  token: string,
  options: { allowRevoked?: boolean; transport?: AuthTransport } = {}
) {
  const transport = options.transport ?? "bearer";
  const claims = verifyAuthToken(token, transport);
  const session = await prisma.authSession.findUnique({
    where: { id: claims.sessionId },
    include: { user: true }
  });
  if (!session || session.user_id !== claims.id || session.user.id !== claims.id || session.user.role !== claims.role) {
    throw new HttpError(401, "invalid_session");
  }
  if (session.user.account_status !== "active") throw new HttpError(403, "account_unavailable");
  if (
    claims.securityVersion !== session.user.security_version ||
    session.security_version_at_issue !== session.user.security_version
  ) throw new HttpError(401, "invalid_session");
  const now = new Date();
  if (session.expires_at.getTime() <= now.getTime()) throw new HttpError(401, "session_expired");
  if (transport === "admin_cookie" && adminSessionAbsoluteEnd(session.created_at).getTime() <= now.getTime()) {
    throw new HttpError(401, "session_expired");
  }
  if (session.revoked_at && !options.allowRevoked) throw new HttpError(401, "session_revoked");

  if (!session.revoked_at) {
    await prisma.authSession.update({
      where: { id: session.id },
      data: {
        last_used_at: now,
        // Admin cookie sessions slide: activity keeps them alive up to the absolute limit.
        ...(transport === "admin_cookie" ? { expires_at: adminSessionExpiresAt(session.created_at, now) } : {})
      }
    });
  }
  // EMAIL_VERIFICATION_DISABLED (local development only) lets unverified email accounts through.
  // profile_state is non-null in the database. The fallback only supports
  // narrow legacy test doubles that predate this schema field.
  return {
    ...claims,
    profileState: session.user.profile_state ?? "complete",
    emailVerified: config.emailVerificationDisabled || hasVerifiedContact(session.user),
    ...(transport === "admin_cookie" ? { transport } : {})
  };
}

/**
 * The request's credential. An explicit Bearer token always wins, so mobile and
 * tooling requests behave exactly as before; otherwise the Admin cookie is used.
 */
export function requestCredential(req: Request): { token: string; transport: AuthTransport } | null {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return { token: header.slice("Bearer ".length), transport: "bearer" };
  const cookie = readAdminSessionCookie(req);
  return cookie ? { token: cookie, transport: "admin_cookie" } : null;
}

/**
 * Authenticates a request from its credential. Cookie requests must first pass
 * the CSRF check; a cookie whose session has ended is cleared so the browser
 * stops sending it. Returns null when the request carries no credential.
 */
export async function authenticateRequest(
  req: Request,
  res: Response,
  options: { allowRevoked?: boolean } = {}
): Promise<AuthUser | null> {
  const credential = requestCredential(req);
  if (!credential) return null;
  if (credential.transport === "bearer") return authenticateAuthToken(credential.token, options);

  assertAdminSessionRequest(req);
  try {
    return await authenticateAuthToken(credential.token, { ...options, transport: "admin_cookie" });
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 401) clearAdminSessionCookie(res);
    throw error;
  }
}

function authMiddleware(options: { allowRevoked?: boolean } = {}) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = await authenticateRequest(req, res, options);
      if (!user) throw new HttpError(401, "missing_token");

      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth = authMiddleware();
export const requireLogoutAuth = authMiddleware({ allowRevoked: true });

export function requireRole(...roles: AuthUser["role"][]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new HttpError(401, "missing_auth_user");
      }

      if (!roles.includes(req.user.role)) {
        throw new HttpError(403, "forbidden");
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
