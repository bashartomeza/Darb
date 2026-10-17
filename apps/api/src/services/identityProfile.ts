import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuthActionError, consumeAuthAction, issueAuthAction } from "../lib/authActionTokens.js";
import { verifyGoogleIdentity, type GoogleVerifier } from "../lib/googleIdentity.js";
import { keyedDigest, hexDigestMatches } from "../lib/keyedDigest.js";
import { HttpError } from "../middleware/error.js";
import type { EmailDelivery } from "./emailAuth.js";
import { auditEvent } from "../lib/audit.js";

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const googleLinkSchema = z.strictObject({ id_token: z.string().min(1).max(8192), current_password: z.string().min(1).max(200).optional(), reauthentication_token: token.optional() });

export class IdentityProfileService {
  constructor(private readonly db: PrismaClient, private readonly config: AppConfig, private readonly emailDelivery?: EmailDelivery,
    private readonly verifier: GoogleVerifier = verifyGoogleIdentity) {}
  private key() { if (!this.config.authActions) throw new HttpError(503, "auth_action_unavailable"); return this.config.authActions.key; }
  private sender<T extends { kind: "test" | "approved" }>(provider: T | undefined, error: string): T {
    if (!provider || ((this.config.isProduction || this.config.isStaging) && provider.kind !== "approved")) throw new HttpError(503, error);
    return provider;
  }
  private async user(tx: Prisma.TransactionClient, id: string, version: number) {
    // Lock and recheck eligibility in the same transaction as credential/profile writes.
    const locked = await tx.user.updateMany({ where: { id, account_status: "active", security_version: version }, data: { security_version: version } });
    if (locked.count !== 1) throw new HttpError(403, "account_unavailable");
    const user = await tx.user.findUnique({ where: { id } });
    if (!user || user.account_status !== "active" || user.security_version !== version) throw new HttpError(403, "account_unavailable");
    return user;
  }
  private subject(user: { id: string; security_version: number; email: string | null }) { return `google-link:${user.id}:${user.security_version}:${user.email}`; }
  private matches(digest: string | null, value: string) { return digest !== null && hexDigestMatches(digest, keyedDigest("masari:auth-action-subject", value, this.key())); }
  private async consume(tx: Prisma.TransactionClient, raw: string, purpose: "email_verification") {
    try { return await consumeAuthAction(tx, raw, purpose, { key: this.key() }); }
    catch (e) { if (e instanceof AuthActionError) throw new HttpError(400, "auth_action_invalid"); throw e; }
  }
  private async transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, conflict: string): Promise<T> {
    try { return await this.db.$transaction(callback, { isolationLevel: "Serializable" }); }
    catch (e) {
      if (e && typeof e === "object" && "code" in e) {
        if (e.code === "P2002") throw new HttpError(409, conflict);
        if (e.code === "P2034") throw new HttpError(409, "auth_retry_required");
      }
      throw e;
    }
  }
  async linkStart(id: string, version: number, locale: "ar" | "en") {
    const sender = this.sender(this.emailDelivery, "email_auth_unavailable");
    const result = await this.transaction(async (tx) => {
      const user = await this.user(tx, id, version);
      if (user.role === "admin" || !user.email || !user.email_verified_at) throw new HttpError(403, "reauthentication_required");
      const subject = this.subject(user);
      const count = await tx.authActionToken.count({ where: { user_id: id, purpose: "email_verification", created_at: { gte: new Date(Date.now() - 3600000) } } });
      if (count >= 5) throw new HttpError(429, "rate_limited");
      const proof = await issueAuthAction(tx, { purpose: "email_verification", userId: id, subject, key: this.key() });
      // Reauthentication is substantially shorter than ordinary email ownership proof.
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await tx.authActionToken.updateMany({ where: { id: proof.action.id }, data: { expires_at: expiresAt } });
      return { email: user.email, proof: { ...proof, expiresAt } };
    }, "google_identity_conflict");
    try { await sender.send({ to: result.email, locale, purpose: "email_verification", actionToken: result.proof.rawToken, expiresAt: result.proof.expiresAt }); }
    catch { await this.db.authActionToken.updateMany({ where: { id: result.proof.action.id, consumed_at: null }, data: { consumed_at: new Date() } }); throw new HttpError(503, "email_auth_unavailable"); }
    return { ok: true };
  }
  async link(id: string, version: number, input: z.infer<typeof googleLinkSchema>) {
    return this.transaction(async (tx) => {
      const user = await this.user(tx, id, version);
      if (user.role === "admin" || !user.email_verified_at || !user.email) throw new HttpError(403, "reauthentication_required");
      if (user.password_hash) {
        if (!input.current_password || !await bcrypt.compare(input.current_password, user.password_hash)) throw new HttpError(403, "reauthentication_required");
      } else {
        if (!input.reauthentication_token) throw new HttpError(403, "reauthentication_required");
        const proof = await this.consume(tx, input.reauthentication_token, "email_verification");
        if (proof.user_id !== id || !this.matches(proof.subject_digest, this.subject(user))) throw new HttpError(403, "reauthentication_required");
      }
      if (!this.config.googleAuth.mobileClientIds.length) throw new HttpError(503, "google_auth_unavailable");
      let identity;
      try { identity = await this.verifier(input.id_token, this.config.googleAuth.mobileClientIds); if (!identity.emailVerified) throw new Error(); }
      catch { throw new HttpError(401, "invalid_google_token"); }
      if (await tx.externalIdentity.findUnique({ where: { provider_provider_subject: { provider: "google", provider_subject: identity.sub } } }) ||
        await tx.externalIdentity.findUnique({ where: { user_id_provider: { user_id: id, provider: "google" } } })) throw new HttpError(409, "google_identity_conflict");
      await tx.externalIdentity.create({ data: { provider: "google", provider_subject: identity.sub, user_id: id, provider_email_snapshot: identity.email, last_authenticated_at: new Date() } });
      await auditEvent(tx, { userId: id, action: "auth_google_link", entityType: "User", entityId: id, metadata: { provider: "google", explicit: true } });
      return { ok: true, provider: "google" };
    }, "google_identity_conflict");
  }
}
