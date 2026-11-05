import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const PUSH_PLATFORMS = ["android", "ios", "web"] as const;
export type PushPlatformName = (typeof PUSH_PLATFORMS)[number];

/** FCM and APNs-via-FCM tokens: URL-safe base64 plus ':' separators. */
export const PUSH_TOKEN_PATTERN = /^[A-Za-z0-9_:.-]{20,512}$/;

export type RegisterPushDeviceInput = {
  userId: string;
  sessionId: string;
  token: string;
  platform: PushPlatformName;
  appVersion?: string | null;
  locale?: string | null;
  now?: Date;
};

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Registers or refreshes a token for the caller. Idempotent; a token belongs to
 * one account only, so registering a token another account held moves it (the
 * phone changed hands or a different account signed in on it).
 */
export async function registerPushDevice(db: Db, input: RegisterPushDeviceInput) {
  const now = input.now ?? new Date();
  const fields = {
    user_id: input.userId,
    session_id: input.sessionId,
    platform: input.platform,
    app_version: input.appVersion ?? null,
    locale: input.locale ?? null,
    last_seen_at: now,
    revoked_at: null,
    revoke_reason: null
  };
  const upsert = () =>
    db.pushDevice.upsert({
      where: { token: input.token },
      create: { token: input.token, created_at: now, ...fields },
      update: fields,
      select: { id: true, platform: true, locale: true, last_seen_at: true }
    });
  try {
    return await upsert();
  } catch (error) {
    // Two registrations of the same new token raced on the unique index: the row exists now.
    if (!isUniqueViolation(error)) throw error;
    return upsert();
  }
}

/** Revokes the caller's own token. Another account's token is left alone, with the same answer. */
export async function unregisterPushDevice(db: Db, input: { userId: string; token: string; now?: Date }) {
  const result = await db.pushDevice.updateMany({
    where: { token: input.token, user_id: input.userId, revoked_at: null },
    data: { revoked_at: input.now ?? new Date(), revoke_reason: "unregistered" }
  });
  return result.count;
}

/** Called wherever sign-in sessions end, so a signed-out phone stops receiving pushes. */
export async function revokePushDevicesForSessions(db: Db, sessionIds: string[], reason: string, now = new Date()) {
  if (sessionIds.length === 0) return;
  await db.pushDevice.updateMany({
    where: { session_id: { in: sessionIds }, revoked_at: null },
    data: { revoked_at: now, revoke_reason: reason.slice(0, 60) }
  });
}

export async function pushPreference(db: Db, userId: string) {
  const row = await db.notificationPreference.findUnique({ where: { user_id: userId }, select: { push_enabled: true } });
  return { pushEnabled: row?.push_enabled ?? true };
}

export async function setPushPreference(db: Db, userId: string, pushEnabled: boolean) {
  const row = await db.notificationPreference.upsert({
    where: { user_id: userId },
    create: { user_id: userId, push_enabled: pushEnabled },
    update: { push_enabled: pushEnabled },
    select: { push_enabled: true }
  });
  return { pushEnabled: row.push_enabled };
}

/** Every token of the account, e.g. on "sign out everywhere" or a password change. */
export async function revokePushDevicesForUser(db: Db, userId: string, reason: string, now = new Date()) {
  await db.pushDevice.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: now, revoke_reason: reason.slice(0, 60) }
  });
}
