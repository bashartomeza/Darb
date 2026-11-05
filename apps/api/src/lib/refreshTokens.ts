import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { config } from "../config.js";
import { revokePushDevicesForSessions, revokePushDevicesForUser } from "../services/pushDevices.js";

const REFRESH_SECRET_BYTES = 32;
const TOKEN_ID_PATTERN = /^rt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REFRESH_ROLES = ["passenger", "driver", "merchant"] as const;

export type RefreshTokenRole = (typeof REFRESH_ROLES)[number];

type SessionDatabase = PrismaClient | Prisma.TransactionClient;

export type RefreshTokenMaterial = {
  id: string;
  roleAtIssue: RefreshTokenRole;
  rawToken: string;
  tokenHash: string;
};

export function isRefreshTokenRole(role: string): role is RefreshTokenRole {
  return REFRESH_ROLES.some((candidate) => candidate === role);
}

export function createRefreshToken(roleAtIssue: RefreshTokenRole): RefreshTokenMaterial {
  const id = `rt_${randomUUID()}`;
  const secret = randomBytes(REFRESH_SECRET_BYTES).toString("base64url");
  const rawToken = `${id}.${roleAtIssue}.${secret}`;
  return { id, roleAtIssue, rawToken, tokenHash: hashRefreshToken(rawToken) };
}

export function parseRefreshToken(rawToken: unknown) {
  if (typeof rawToken !== "string" || rawToken.length > 160) return null;
  const parts = rawToken.split(".");
  if (
    parts.length !== 3 ||
    !TOKEN_ID_PATTERN.test(parts[0]) ||
    !isRefreshTokenRole(parts[1]) ||
    !TOKEN_SECRET_PATTERN.test(parts[2])
  ) return null;
  return { id: parts[0], roleAtIssue: parts[1], rawToken };
}

export function hashRefreshToken(rawToken: string) {
  return createHmac("sha256", config.refreshTokenPepper).update(rawToken, "utf8").digest("hex");
}

export function refreshTokenHashMatches(rawToken: string, storedHash: string) {
  const expected = Buffer.from(hashRefreshToken(rawToken), "hex");
  const actual = /^[a-f0-9]{64}$/i.test(storedHash) ? Buffer.from(storedHash, "hex") : Buffer.alloc(expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function refreshTokenExpiresAt(now = new Date()) {
  return new Date(now.getTime() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1_000);
}

export async function revokeSessionRecords(
  db: SessionDatabase,
  input: { sessionId: string; reason: string; now?: Date }
) {
  const now = input.now ?? new Date();
  await db.authSession.updateMany({
    where: { id: input.sessionId, revoked_at: null },
    data: { revoked_at: now, revoke_reason: input.reason }
  });
  await db.refreshToken.updateMany({
    where: { session_id: input.sessionId, revoked_at: null },
    data: { revoked_at: now }
  });
  // A signed-out phone must stop receiving pushes for this account.
  await revokePushDevicesForSessions(db, [input.sessionId], input.reason, now);
}

export async function revokeAllUserSessions(
  db: SessionDatabase,
  input: { userId: string; reason: string; now?: Date }
) {
  const now = input.now ?? new Date();
  await revokePushDevicesForUser(db, input.userId, input.reason, now);
  const sessions = await db.authSession.findMany({
    where: { user_id: input.userId },
    select: { id: true }
  });
  if (sessions.length === 0) return;
  const sessionIds = sessions.map((session) => session.id);
  await db.authSession.updateMany({
    where: { id: { in: sessionIds }, revoked_at: null },
    data: { revoked_at: now, revoke_reason: input.reason }
  });
  await db.refreshToken.updateMany({
    where: { session_id: { in: sessionIds }, revoked_at: null },
    data: { revoked_at: now }
  });
}
