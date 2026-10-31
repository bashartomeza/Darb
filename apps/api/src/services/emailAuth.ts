import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Logger } from "pino";
import type { AppConfig } from "../config.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuthActionError, checkAuthActionCode, consumeAuthAction, consumeCheckedAuthAction, issueAuthAction, revokeAuthActions } from "../lib/authActionTokens.js";
import { normalizeEmailForAbuse } from "../lib/contactEmail.js";
import { abuseSubjectDigest, hexDigestMatches, keyedDigest, type VersionedKey } from "../lib/keyedDigest.js";
import { revokeAllUserSessions } from "../lib/refreshTokens.js";
import { HttpError } from "../middleware/error.js";
import { ConsentReleaseService } from "./consentReleases.js";

export type EmailDelivery = {
  kind: "test" | "approved";
  send(message: { to: string; locale: "ar" | "en"; purpose: "email_verification" | "password_reset" | "password_set" | "phone_code"; actionToken: string; expiresAt: Date }): Promise<void>;
};
export const canonicalEmail = z.string().trim().toLowerCase().email().max(191);
export const newPassword = z.string().min(12).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72);
const locale = z.enum(["ar", "en"]);
const actionToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const registrationToken = z.string().min(1).max(2048);
const consentInput = z.strictObject({ id: z.string().min(1).max(191), type: z.enum(["terms", "privacy", "adult_self_attestation"]), content_hash: z.string().regex(/^[a-f0-9]{64}$/) });
export const emailStartSchema = z.strictObject({ name: z.string().trim().min(1).max(120), email: canonicalEmail, password: newPassword, locale });
const emailCode = z.string().regex(/^\d{6}$/);
// A registration is proven either by the 6-digit code from the email or by the longer token that
// verify/confirm hands back; exactly one of the two.
export const emailCompleteBase = z.strictObject({ registration_token: registrationToken, email_verification_token: actionToken.optional(), email_verification_code: emailCode.optional(), locale,
  consents: z.array(consentInput).length(3), adult_self_attestation: z.literal(true), device_name: z.string().trim().min(1).max(120).optional() });
export const emailCompleteSchema = emailCompleteBase.refine((v) => (v.email_verification_token === undefined) !== (v.email_verification_code === undefined));
export const emailProofStartSchema = z.strictObject({ email: canonicalEmail, locale });
// The emailed proof is always the 6-digit code. It belongs either to a pending registration (identified by its
// sealed registration_token) or to an existing account (identified by its email), never both.
export const emailProofConfirmSchema = z.strictObject({ code: emailCode, registration_token: registrationToken.optional(), email: canonicalEmail.optional() })
  .refine((v) => (v.registration_token === undefined) !== (v.email === undefined));
export const passwordResetSchema = z.strictObject({ email: canonicalEmail, code: emailCode, password: newPassword });
export const passwordSetSchema = z.strictObject({ password: newPassword, current_password: z.string().min(1).max(200).optional(), reauthentication_code: emailCode.optional() });
const envelopeSchema = z.strictObject({ name: z.string(), email: canonicalEmail, passwordHash: z.string().regex(/^\$2[aby]\$\d\d\$.{53}$/), expires: z.number(), nonce: z.string() });

// The pre-consent identity remains only in a short-lived authenticated-encrypted
// client envelope. Database actions hold only keyed digests, never this payload.
function envelopeKey(key: VersionedKey) {
  return createHmac("sha256", key.secret).update(`masari:email-registration-envelope:v${key.version}`).digest();
}
function seal(payload: z.infer<typeof envelopeSchema>, key: VersionedKey) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", envelopeKey(key), iv);
  cipher.setAAD(Buffer.from("masari:email-registration:v1"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
function open(raw: string, key: VersionedKey) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw || bytes.length < 29) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", envelopeKey(key), bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from("masari:email-registration:v1")); cipher.setAuthTag(bytes.subarray(12, 28));
    const payload = envelopeSchema.parse(JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8")));
    if (payload.expires <= Date.now()) throw new Error();
    return payload;
  } catch { throw new HttpError(400, "auth_action_invalid"); }
}
function subjectMatches(digest: string | null, subject: string, key: VersionedKey) {
  return digest !== null && hexDigestMatches(digest, keyedDigest("masari:auth-action-subject", subject, key));
}
function userSubject(user: { id: string; email: string | null; security_version: number }) {
  return `${user.id}:${user.security_version}:${user.email}`;
}

export class EmailAuthService {
  constructor(private readonly db: PrismaClient, private readonly config: AppConfig, private readonly delivery?: EmailDelivery,
    private readonly releases = new ConsentReleaseService(db)) {}

  private key() {
    if (!this.config.authActions) throw new HttpError(503, "email_auth_unavailable");
    return this.config.authActions.key;
  }
  private sender() {
    if (!this.delivery || ((this.config.isProduction || this.config.isStaging) && this.delivery.kind !== "approved")) {
      throw new HttpError(503, "email_auth_unavailable");
    }
    return this.delivery;
  }
  private async consume(tx: Prisma.TransactionClient, raw: string, purpose: "email_verification" | "password_reset" | "password_set") {
    try { return await consumeAuthAction(tx, raw, purpose, { key: this.key() }); }
    catch (error) { if (error instanceof AuthActionError) throw new HttpError(400, "auth_action_invalid"); throw error; }
  }

  private async checkCode(subject: string, code: string, purpose: "email_verification" | "password_reset" | "password_set" = "email_verification") {
    try { return await checkAuthActionCode(this.db, { code, subject, purpose, key: this.key() }); }
    catch (error) { if (error instanceof AuthActionError) throw new HttpError(400, "auth_action_invalid"); throw error; }
  }
  private async consumeChecked(tx: Prisma.TransactionClient, action: Awaited<ReturnType<typeof checkAuthActionCode>>) {
    try { await consumeCheckedAuthAction(tx, action.id); return action; }
    catch (error) { if (error instanceof AuthActionError) throw new HttpError(400, "auth_action_invalid"); throw error; }
  }

  async currentConsents(inputLocale: "ar" | "en") {
    const effective = await this.releases.current();
    if (!effective.ready) throw new HttpError(503, "consent_unavailable");
    return { documents: effective.release.documents.filter((d) => d.locale === inputLocale).map((d) => ({
      id: d.id, type: d.document_type, locale: d.locale, version: d.version, content: d.content_body, content_hash: d.content_digest
    })) };
  }

  /**
   * Per-inbox send guard shared by the three public "email me a code" starts. The inbox is keyed by its normalised
   * alias-free form (abuse key only; the address is stored as typed). A start inside the resend cooldown while an
   * earlier code is still open, or past the daily cap, must not send or issue anything: it would supersede the
   * in-flight code and let a third party burn it, or mail-bomb the inbox.
   */
  private emailDigest(email: string) {
    return abuseSubjectDigest("auth_email_code", normalizeEmailForAbuse(email), this.key());
  }
  private async mayIssueEmailCode(email: string, purpose: "email_verification" | "password_reset") {
    const limits = this.config.emailCodeLimits ?? { resendCooldownSeconds: 60, maxPerDay: 10 };
    const digest = this.emailDigest(email); const now = Date.now();
    const base = { payload: { path: "$.email_digest", equals: digest } };
    if (limits.resendCooldownSeconds > 0) {
      const inFlight = await this.db.authActionToken.count({ where: { ...base, purpose, consumed_at: null, created_at: { gte: new Date(now - limits.resendCooldownSeconds * 1000) } } });
      if (inFlight > 0) return false;
    }
    const today = await this.db.authActionToken.count({ where: { ...base, purpose: { in: ["email_verification", "password_reset"] }, created_at: { gte: new Date(now - 86_400_000) } } });
    return today < limits.maxPerDay;
  }

  async start(input: z.infer<typeof emailStartSchema>) {
    const key = this.key(); const sender = this.sender();
    // Starting a registration never reveals whether the address is taken, so a plain 429 leaks nothing.
    if (!(await this.mayIssueEmailCode(input.email, "email_verification"))) throw new HttpError(429, "rate_limited");
    const expires = Date.now() + 24 * 60 * 60 * 1000;
    const envelope = seal({ name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12), expires, nonce: randomBytes(16).toString("hex") }, key);
    // The email carries only the short code; the long token stays server-side.
    const proof = await issueAuthAction(this.db, { purpose: "email_verification", key, subject: envelope, withCode: true, payload: { email_digest: this.emailDigest(input.email) } });
    try { await sender.send({ to: input.email, locale: input.locale, purpose: "email_verification", actionToken: proof.code!, expiresAt: proof.expiresAt }); }
    catch { await revokeAuthActions(this.db, { subject: envelope, key, reason: "delivery_failed" }); throw new HttpError(503, "email_auth_unavailable"); }
    return { registration_token: envelope, expires_at: new Date(expires).toISOString(), next_action: "verify_email" };
  }

  async complete<T>(input: z.infer<typeof emailCompleteSchema>, createSession: (tx: Prisma.TransactionClient, user: Awaited<ReturnType<PrismaClient["user"]["create"]>>) => Promise<T>, requestId?: string) {
    const payload = open(input.registration_token, this.key());
    // A code attempt is counted before the transaction so a rollback cannot hand the guess back.
    const checked = input.email_verification_code === undefined ? undefined : await this.checkCode(input.registration_token, input.email_verification_code);
    return this.db.$transaction(async (tx) => {
      const proof = checked
        ? await this.consumeChecked(tx, checked)
        : await this.consume(tx, input.email_verification_token!, "email_verification");
      if (proof.user_id || !subjectMatches(proof.subject_digest, input.registration_token, this.key())) throw new HttpError(400, "auth_action_invalid");
      if (await tx.user.findUnique({ where: { email: payload.email } })) throw new HttpError(409, "explicit_link_required");
      const effective = await this.releases.current(new Date(), tx);
      if (!effective.ready) throw new HttpError(409, "consent_version_changed");
      const documents = effective.release.documents.filter((d) => d.locale === input.locale);
      if (documents.length !== 3 || new Set(input.consents.map((c) => c.type)).size !== 3 || documents.some((d) => !input.consents.some((c) => c.id === d.id && c.type === d.document_type && hexDigestMatches(c.content_hash, d.content_digest)))) {
        throw new HttpError(409, "consent_version_changed");
      }
      const now = new Date();
      const user = await tx.user.create({ data: { name: payload.name, email: payload.email, password_hash: payload.passwordHash, email_verified_at: now,
        phone: null, phone_verified_at: null, profile_state: "phone_required", role: "passenger", account_status: "active", security_version: 1, demo_account: false } });
      await tx.userConsent.createMany({ data: documents.map((d) => ({ user_id: user.id, consent_document_id: d.id, accepted_at: now,
        source: "email_registration", request_id: requestId, app_release: this.config.appRelease })) });
      const session = await createSession(tx, user);
      return { user, session };
    }, { isolationLevel: "Serializable" });
  }

  async proofStart(input: z.infer<typeof emailProofStartSchema>, purpose: "email_verification" | "password_reset", log?: Pick<Logger, "warn" | "error">) {
    const key = this.key(); const sender = this.sender();
    const user = await this.db.user.findUnique({ where: { email: input.email } });
    // Cooldown and daily cap answer with the same generic success, without sending or superseding the open code.
    if (user?.account_status === "active" && (purpose !== "password_reset" || (user.password_hash && user.email_verified_at)) &&
      await this.mayIssueEmailCode(input.email, purpose)) {
      const proof = await issueAuthAction(this.db, { purpose, key, userId: user.id, subject: userSubject(user), withCode: true, payload: { email_digest: this.emailDigest(input.email) } });
      // Provider latency is independent of the public response. Only an action
      // digest is persisted; the short-lived delivery closure holds the proof.
      // A failed attempt revokes only its own action, preserving concurrent retries.
      void Promise.resolve().then(() => sender.send({
        to: input.email, locale: input.locale, purpose, actionToken: proof.code!, expiresAt: proof.expiresAt
      })).catch(async () => {
        log?.warn({ event: "auth_email_delivery_failed", purpose }, "Authentication email delivery failed");
        try {
          await this.db.authActionToken.updateMany({ where: { id: proof.action.id, consumed_at: null }, data: { consumed_at: new Date() } });
        } catch {
          log?.error({ event: "auth_email_delivery_cleanup_failed", purpose }, "Authentication email cleanup failed");
        }
      });
    }
    return { ok: true };
  }

  async verify(input: z.infer<typeof emailProofConfirmSchema>) {
    if (input.registration_token) open(input.registration_token, this.key());
    let account: Awaited<ReturnType<PrismaClient["user"]["findUnique"]>> = null;
    if (input.email) {
      account = await this.db.user.findUnique({ where: { email: input.email } });
      if (!account) throw new HttpError(400, "auth_action_invalid");
    }
    // The wrong-guess counter is spent before the transaction so a rollback cannot hand it back.
    const checked = await this.checkCode(input.registration_token ?? userSubject(account!), input.code);
    return this.db.$transaction(async (tx) => {
      const proof = await this.consumeChecked(tx, checked);
      if (input.registration_token) {
        if (proof.user_id || !subjectMatches(proof.subject_digest, input.registration_token, this.key())) throw new HttpError(400, "auth_action_invalid");
        const next = await issueAuthAction(tx, { purpose: "email_verification", key: this.key(), subject: input.registration_token });
        return { ok: true, email_verification_token: next.rawToken, next_action: "consent_required" };
      }
      if (!proof.user_id) throw new HttpError(400, "auth_action_invalid");
      const user = await tx.user.findUnique({ where: { id: proof.user_id } });
      if (!user || user.account_status !== "active" || !user.email || !subjectMatches(proof.subject_digest, userSubject(user), this.key())) throw new HttpError(400, "auth_action_invalid");
      await tx.user.update({ where: { id: user.id }, data: { email_verified_at: new Date() } });
      return { ok: true };
    }, { isolationLevel: "Serializable" });
  }

  async reset(input: z.infer<typeof passwordResetSchema>) {
    const passwordHash = await bcrypt.hash(input.password, 12);
    // An unknown email fails exactly like a wrong code. The code is checked against the newest open reset
    // action for this user's subject, and that check spends a guess before the transaction starts.
    const account = await this.db.user.findUnique({ where: { email: input.email } });
    if (!account) throw new HttpError(400, "auth_action_invalid");
    const checked = await this.checkCode(userSubject(account), input.code, "password_reset");
    return this.db.$transaction(async (tx) => {
      const proof = await this.consumeChecked(tx, checked);
      if (!proof.user_id || proof.user_id !== account.id) throw new HttpError(400, "auth_action_invalid");
      const user = await tx.user.findUnique({ where: { id: proof.user_id } });
      if (!user || user.account_status !== "active" || !user.email_verified_at || !subjectMatches(proof.subject_digest, userSubject(user), this.key())) throw new HttpError(400, "auth_action_invalid");
      await this.changePassword(tx, user.id, passwordHash);
      return { ok: true, next_action: "login_required" };
    }, { isolationLevel: "Serializable" });
  }

  async passwordSetStart(userId: string, inputLocale: "ar" | "en") {
    const key = this.key(); const sender = this.sender();
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user?.email || !user.email_verified_at || user.account_status !== "active") throw new HttpError(403, "reauthentication_required");
    const proof = await issueAuthAction(this.db, { purpose: "password_set", key, userId, subject: userSubject(user), withCode: true });
    try { await sender.send({ to: user.email, locale: inputLocale, purpose: "password_set", actionToken: proof.code!, expiresAt: proof.expiresAt }); }
    catch { await revokeAuthActions(this.db, { userId, purpose: "password_set", reason: "delivery_failed" }); throw new HttpError(503, "email_auth_unavailable"); }
    return { ok: true };
  }

  async setPassword(userId: string, securityVersion: number, input: z.infer<typeof passwordSetSchema>) {
    const passwordHash = await bcrypt.hash(input.password, 12);
    // For a passwordless account the emailed code is checked (spending a guess) before the transaction.
    let checked: Awaited<ReturnType<typeof checkAuthActionCode>> | undefined;
    if (input.reauthentication_code !== undefined) {
      const current = await this.db.user.findUnique({ where: { id: userId } });
      if (current && !current.password_hash && current.account_status === "active" && current.email_verified_at && current.security_version === securityVersion) {
        checked = await this.checkCode(userSubject(current), input.reauthentication_code, "password_set");
      }
    }
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.account_status !== "active" || !user.email_verified_at || user.security_version !== securityVersion) throw new HttpError(403, "reauthentication_required");
      if (user.password_hash) {
        if (!input.current_password || !await bcrypt.compare(input.current_password, user.password_hash)) throw new HttpError(403, "reauthentication_required");
      } else {
        if (!checked) throw new HttpError(403, "reauthentication_required");
        const proof = await this.consumeChecked(tx, checked);
        if (proof.user_id !== user.id || !subjectMatches(proof.subject_digest, userSubject(user), this.key())) throw new HttpError(403, "reauthentication_required");
      }
      await this.changePassword(tx, user.id, passwordHash);
      return { ok: true, next_action: "login_required" };
    }, { isolationLevel: "Serializable" });
  }

  private async changePassword(tx: Prisma.TransactionClient, userId: string, passwordHash: string) {
    await tx.user.update({ where: { id: userId }, data: { password_hash: passwordHash, security_version: { increment: 1 } } });
    await revokeAllUserSessions(tx, { userId, reason: "password_changed" });
    await revokeAuthActions(tx, { userId, reason: "password_changed" });
  }
}
