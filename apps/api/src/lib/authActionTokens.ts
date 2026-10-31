import { randomBytes, randomInt } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { AuthActionPurpose } from "../generated/prisma/enums.js";
import { hexDigestMatches, keyedDigest, type VersionedKey } from "./keyedDigest.js";

type ActionTransaction = Pick<Prisma.TransactionClient, "authActionToken">;
type ActionDatabase = PrismaClient | Prisma.TransactionClient;

const AUTH_ACTION_TTL_SECONDS: Record<AuthActionPurpose, number> = {
  email_verification: 24 * 60 * 60,
  password_reset: 30 * 60,
  password_set: 15 * 60,
  email_change: 30 * 60,
  google_registration: 15 * 60,
  phone_verification: 10 * 60
};

const SECRET_FIELD_NAMES = new Set([
  "password",
  "password_hash",
  "credential",
  "credentials",
  "id_token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "token",
  "raw_token",
  "google_token",
  "identity_token"
].map(normalizedFieldName));

const PAYLOAD_FIELDS: Record<AuthActionPurpose, ReadonlySet<string>> = {
  email_verification: new Set(["email_digest"]),
  password_reset: new Set(["email_digest"]),
  password_set: new Set(),
  email_change: new Set(["email_digest", "new_email_digest"]),
  google_registration: new Set(["provider_subject_digest", "email_digest"]),
  phone_verification: new Set(["phone_digest", "challenge_id"])
};

export class AuthActionError extends Error {
  constructor(message = "auth_action_invalid") {
    super(message);
    this.name = "AuthActionError";
  }
}

function actionTokenDigest(rawToken: string, key: VersionedKey) {
  return keyedDigest("masari:auth-action-token", rawToken, key);
}

function actionSubjectDigest(subject: string, key: VersionedKey) {
  return keyedDigest("masari:auth-action-subject", subject, key);
}

function normalizedFieldName(name: string) {
  return name.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isDigest(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isChallengeId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
}

function isSafePayload(purpose: AuthActionPurpose, payload: unknown): payload is Prisma.InputJsonObject | undefined {
  if (payload === undefined) return true;
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return false;
  return Object.entries(payload as Record<string, unknown>).every(([name, value]) => {
    const normalized = normalizedFieldName(name);
    if (SECRET_FIELD_NAMES.has(normalized)) return false;
    if (!PAYLOAD_FIELDS[purpose].has(name)) return false;
    return name.endsWith("_digest") ? isDigest(value) : name === "challenge_id" ? isChallengeId(value) : false;
  });
}

function assertSafePayload(purpose: AuthActionPurpose, payload: unknown) {
  if (!isSafePayload(purpose, payload) || (payload !== undefined && JSON.stringify(payload).length > 4_096)) {
    throw new AuthActionError("auth_action_payload_invalid");
  }
}

function assertRawToken(rawToken: unknown): rawToken is string {
  return typeof rawToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(rawToken);
}

export function generateAuthActionToken() {
  return randomBytes(32).toString("base64url");
}

/** Wrong guesses allowed per emailed code before it is burned. */
export const AUTH_ACTION_CODE_MAX_ATTEMPTS = 5;

function actionCodeDigest(code: string, key: VersionedKey) {
  return keyedDigest("masari:auth-action-code", code, key);
}

export function generateAuthActionCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function issueAuthAction(
  db: ActionDatabase,
  input: {
    purpose: AuthActionPurpose;
    key: VersionedKey;
    userId?: string;
    subject?: string;
    payload?: Prisma.InputJsonValue;
    /** Also issue a short numeric code, only valid together with `subject`. */
    withCode?: boolean;
    now?: Date;
  }
) {
  assertSafePayload(input.purpose, input.payload);
  if (input.withCode && !input.subject) throw new AuthActionError("auth_action_subject_required");
  const rawToken = generateAuthActionToken();
  const code = input.withCode ? generateAuthActionCode() : undefined;
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + AUTH_ACTION_TTL_SECONDS[input.purpose] * 1_000);
  const action = await db.authActionToken.create({
    data: {
      purpose: input.purpose,
      user_id: input.userId,
      subject_digest: input.subject ? actionSubjectDigest(input.subject, input.key) : undefined,
      token_digest: actionTokenDigest(rawToken, input.key),
      token_key_version: input.key.version,
      payload: input.payload,
      code_digest: code ? actionCodeDigest(code, input.key) : undefined,
      expires_at: expiresAt
    }
  });
  return { action, rawToken, code, expiresAt };
}

/**
 * Checks an emailed short code against the newest open action for this subject and returns that
 * action. Every check spends one of AUTH_ACTION_CODE_MAX_ATTEMPTS atomically, so a 6-digit code
 * cannot be brute-forced; the counter is saved even when the caller's transaction later rolls back,
 * which is why this runs on its own, before the caller's transaction.
 */
export async function checkAuthActionCode(
  db: ActionDatabase,
  input: { code: unknown; subject: string; purpose: AuthActionPurpose; key: VersionedKey; now?: Date }
) {
  if (typeof input.code !== "string" || !/^\d{6}$/.test(input.code)) throw new AuthActionError();
  const now = input.now ?? new Date();
  const action = await db.authActionToken.findFirst({
    where: {
      subject_digest: actionSubjectDigest(input.subject, input.key),
      purpose: input.purpose,
      token_key_version: input.key.version,
      code_digest: { not: null },
      consumed_at: null,
      expires_at: { gt: now }
    },
    orderBy: { created_at: "desc" }
  });
  if (!action) throw new AuthActionError();
  const spent = await db.authActionToken.updateMany({
    where: { id: action.id, consumed_at: null, failed_attempts: { lt: AUTH_ACTION_CODE_MAX_ATTEMPTS } },
    data: { failed_attempts: { increment: 1 } }
  });
  if (spent.count !== 1) throw new AuthActionError();
  if (!action.code_digest || !hexDigestMatches(action.code_digest, actionCodeDigest(input.code, input.key))) throw new AuthActionError();
  return action;
}

/** Consumes an action found by checkAuthActionCode (used inside the caller's transaction). */
export async function consumeCheckedAuthAction(db: ActionDatabase, actionId: string, now = new Date()) {
  const consumed = await db.authActionToken.updateMany({
    where: { id: actionId, consumed_at: null, expires_at: { gt: now } },
    data: { consumed_at: now }
  });
  if (consumed.count !== 1) throw new AuthActionError();
}

export async function consumeAuthAction(
  db: ActionDatabase,
  rawToken: unknown,
  purpose: AuthActionPurpose,
  input: { key: VersionedKey; now?: Date }
) {
  if (!assertRawToken(rawToken)) throw new AuthActionError();
  const now = input.now ?? new Date();
  const tokenDigest = actionTokenDigest(rawToken, input.key);
  const consume = async (tx: ActionTransaction) => {
    const action = await tx.authActionToken.findUnique({ where: { token_digest: tokenDigest } });
    if (
      !action ||
      action.purpose !== purpose ||
      action.token_key_version !== input.key.version ||
      action.consumed_at ||
      action.expires_at <= now
    ) throw new AuthActionError();
    const consumed = await tx.authActionToken.updateMany({
      where: {
        id: action.id,
        token_digest: tokenDigest,
        token_key_version: input.key.version,
        purpose,
        consumed_at: null,
        expires_at: { gt: now }
      },
      data: { consumed_at: now }
    });
    if (consumed.count !== 1) throw new AuthActionError();
    return action;
  };
  if ("$transaction" in db && typeof db.$transaction === "function") return db.$transaction(consume);
  return consume(db);
}

export async function revokeAuthActions(
  db: ActionDatabase,
  input: { userId?: string; subject?: string; purpose?: AuthActionPurpose; key?: VersionedKey; reason: string; now?: Date }
) {
  if (!input.userId && !input.subject) throw new AuthActionError("auth_action_subject_required");
  if (input.subject && !input.key) throw new AuthActionError("auth_action_key_required");
  const now = input.now ?? new Date();
  const revoked = await db.authActionToken.updateMany({
    where: {
      ...(input.userId ? { user_id: input.userId } : {}),
      ...(input.subject ? { subject_digest: actionSubjectDigest(input.subject, input.key!) } : {}),
      ...(input.purpose ? { purpose: input.purpose } : {}),
      consumed_at: null
    },
    // AuthActionToken deliberately has no revocation metadata: consumption makes a
    // stale proof unusable without recording operationally sensitive reason text.
    data: { consumed_at: now }
  });
  return revoked.count;
}
