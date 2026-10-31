import { hasVerifiedContact } from "../lib/contactVerification.js";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "./error.js";

export type AuthUser = {
  id: string;
  role: "passenger" | "driver" | "merchant" | "admin";
  sessionId: string;
  securityVersion: number;
  profileState?: "phone_required" | "complete";
  emailVerified?: boolean;
};

export type AuthenticatedRequest = Request & {
  user?: AuthUser;
};

export function signAuthToken(user: AuthUser) {
  return jwt.sign(
    { role: user.role, sid: user.sessionId, ver: user.securityVersion },
    config.jwtSecret,
    { algorithm: "HS256", subject: user.id, expiresIn: config.accessTokenTtlSeconds }
  );
}

export function verifyAuthToken(token: string): AuthUser {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, "access_token_expired");
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

  return { id: payload.sub, role, sessionId: payload.sid, securityVersion: payload.ver };
}

export async function authenticateAuthToken(token: string, options: { allowRevoked?: boolean } = {}) {
  const claims = verifyAuthToken(token);
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
  if (session.expires_at.getTime() <= Date.now()) throw new HttpError(401, "session_expired");
  if (session.revoked_at && !options.allowRevoked) throw new HttpError(401, "session_revoked");

  if (!session.revoked_at) {
    await prisma.authSession.update({ where: { id: session.id }, data: { last_used_at: new Date() } });
  }
  // profile_state is non-null in the database. The fallback only supports
  // narrow legacy test doubles that predate this schema field.
  return { ...claims, profileState: session.user.profile_state ?? "complete", emailVerified: hasVerifiedContact(session.user) };
}

function authMiddleware(options: { allowRevoked?: boolean } = {}) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    try {
      const header = req.header("authorization");
      const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
      if (!token) throw new HttpError(401, "missing_token");

      req.user = await authenticateAuthToken(token, options);
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
