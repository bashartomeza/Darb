import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuthActionError, consumeAuthAction, issueAuthAction } from "../lib/authActionTokens.js";
import { verifyGoogleIdentity, type GoogleVerifier, type VerifiedGoogleIdentity } from "../lib/googleIdentity.js";
import { hexDigestMatches, keyedDigest, type VersionedKey } from "../lib/keyedDigest.js";
import { HttpError } from "../middleware/error.js";
import { ConsentReleaseService } from "./consentReleases.js";
import { canonicalEmail, emailCompleteBase } from "./emailAuth.js";

export const googleCompleteSchema = emailCompleteBase.omit({ email_verification_token: true, email_verification_code: true }).extend({ name: z.string().trim().min(1).max(120) });
const grantSchema = z.strictObject({ action: z.string().regex(/^[A-Za-z0-9_-]{43}$/), sub: z.string().min(1).max(191), email: canonicalEmail, expires: z.number() });
const AAD = Buffer.from("masari:google-registration:v1");
function envelopeKey(key: VersionedKey) { return createHmac("sha256", key.secret).update(`masari:google-registration-envelope:v${key.version}`).digest(); }
function seal(payload: z.infer<typeof grantSchema>, key: VersionedKey) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", envelopeKey(key), iv); cipher.setAAD(AAD);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}
function open(raw: string, key: VersionedKey) {
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw || bytes.length < 29) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", envelopeKey(key), bytes.subarray(0, 12)); cipher.setAAD(AAD); cipher.setAuthTag(bytes.subarray(12, 28));
    const grant = grantSchema.parse(JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8")));
    if (grant.expires <= Date.now()) throw new Error(); return grant;
  } catch { throw new HttpError(400, "auth_action_invalid"); }
}
export function googleAllowlistDigest(email: string, key: VersionedKey) { return keyedDigest("masari:google-passenger-allowlist", email.trim().toLowerCase(), key); }
function subject(identity: { sub: string; email: string }) { return JSON.stringify(["google", identity.sub, identity.email]); }

export class GoogleAuthService {
  constructor(private readonly db: PrismaClient, private readonly config: AppConfig, private readonly verifier: GoogleVerifier = verifyGoogleIdentity,
    private readonly releases = new ConsentReleaseService(db)) {}
  private key() { if (!this.config.authActions) throw new HttpError(503, "google_auth_unavailable"); return this.config.authActions.key; }
  private eligible(email: string) {
    const policy = this.config.googleAuth;
    if (policy.passengerSignupMode === "open") return;
    if (policy.passengerSignupMode === "allowlist" && policy.passengerAllowlist.some((digest) => hexDigestMatches(digest, googleAllowlistDigest(email, this.key())))) return;
    throw new HttpError(403, "google_signup_unavailable");
  }
  async start(credential: string) {
    if (!this.config.googleAuth.mobileClientIds.length) throw new HttpError(503, "google_auth_unavailable");
    let identity: VerifiedGoogleIdentity;
    try { identity = await this.verifier(credential, this.config.googleAuth.mobileClientIds); if (!identity.emailVerified) throw new Error(); }
    catch { throw new HttpError(401, "invalid_google_token"); }
    const linked = await this.db.externalIdentity.findUnique({ where: { provider_provider_subject: { provider: "google", provider_subject: identity.sub } }, include: { user: true } });
    if (linked) {
      if (linked.user.role === "admin") throw new HttpError(401, "invalid_credentials");
      if (linked.user.account_status !== "active") throw new HttpError(403, "account_unavailable");
      return { kind: "login", user: linked.user } as const;
    }
    if (await this.db.user.findUnique({ where: { email: identity.email } })) throw new HttpError(409, "explicit_link_required");
    this.eligible(identity.email);
    const action = await issueAuthAction(this.db, { purpose: "google_registration", key: this.key(), subject: subject(identity) });
    // No pre-consent User or raw Google profile is stored. Minimal verified claims
    // live in an authenticated encrypted client envelope bound to a one-time action.
    return { kind: "registration", registration_token: seal({ action: action.rawToken, sub: identity.sub, email: identity.email, expires: action.expiresAt.getTime() }, this.key()), expires_at: action.expiresAt.toISOString(), next_action: "consent_required" } as const;
  }
  async adminLogin(credential: string) {
    const audiences = this.config.googleAuth.adminClientIds;
    if (audiences.length !== 1) throw new HttpError(503, "google_auth_unavailable");
    let identity: VerifiedGoogleIdentity;
    try { identity = await this.verifier(credential, audiences); if (!identity.emailVerified) throw new Error(); }
    catch { throw new HttpError(401, "invalid_google_token"); }
    const linked = await this.db.externalIdentity.findUnique({ where: { provider_provider_subject: { provider: "google", provider_subject: identity.sub } }, include: { user: true } });
    if (!linked || linked.user.role !== "admin" || linked.user.account_status !== "active") throw new HttpError(401, "invalid_credentials");
    return linked.user;
  }
  async complete<T>(input: z.infer<typeof googleCompleteSchema>, createSession: (tx: Prisma.TransactionClient, user: Awaited<ReturnType<PrismaClient["user"]["create"]>>) => Promise<T>, requestId?: string) {
    const grant = open(input.registration_token, this.key()); this.eligible(grant.email);
    try {
      return await this.db.$transaction(async (tx) => {
        let proof;
        try { proof = await consumeAuthAction(tx, grant.action, "google_registration", { key: this.key() }); }
        catch (e) { if (e instanceof AuthActionError) throw new HttpError(400, "auth_action_invalid"); throw e; }
        if (proof.user_id || !proof.subject_digest || !hexDigestMatches(proof.subject_digest, keyedDigest("masari:auth-action-subject", subject(grant), this.key()))) throw new HttpError(400, "auth_action_invalid");
        if (await tx.externalIdentity.findUnique({ where: { provider_provider_subject: { provider: "google", provider_subject: grant.sub } } })) throw new HttpError(409, "google_identity_already_registered");
        if (await tx.user.findUnique({ where: { email: grant.email } })) throw new HttpError(409, "explicit_link_required");
        const effective = await this.releases.current(new Date(), tx);
        if (!effective.ready) throw new HttpError(409, "consent_version_changed");
        const documents = effective.release.documents.filter((d) => d.locale === input.locale);
        if (!input.adult_self_attestation || documents.length !== 3 || new Set(input.consents.map((c) => c.type)).size !== 3 || documents.some((d) => !input.consents.some((c) => c.id === d.id && c.type === d.document_type && hexDigestMatches(c.content_hash, d.content_digest)))) throw new HttpError(409, "consent_version_changed");
        const now = new Date();
        const user = await tx.user.create({ data: { name: input.name, email: grant.email, email_verified_at: now, phone: null, phone_verified_at: null, password_hash: null, profile_state: "phone_required", role: "passenger", account_status: "active", security_version: 1, demo_account: false } });
        await tx.externalIdentity.create({ data: { user_id: user.id, provider: "google", provider_subject: grant.sub, provider_email_snapshot: grant.email, last_authenticated_at: now } });
        await tx.userConsent.createMany({ data: documents.map((d) => ({ user_id: user.id, consent_document_id: d.id, accepted_at: now, source: "google_registration", request_id: requestId, app_release: this.config.appRelease })) });
        return { user, session: await createSession(tx, user) };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      // Competing grants must never turn a uniqueness/deadlock loser into login.
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new HttpError(409, "explicit_link_required");
      throw error;
    }
  }
}
