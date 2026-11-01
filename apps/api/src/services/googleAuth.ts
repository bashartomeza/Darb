import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuthActionError, consumeAuthAction, issueAuthAction } from "../lib/authActionTokens.js";
import { verifyGoogleIdentity, type GoogleVerifier, type VerifiedGoogleIdentity } from "../lib/googleIdentity.js";
import { hexDigestMatches, keyedDigest, type VersionedKey } from "../lib/keyedDigest.js";
import { HttpError } from "../middleware/error.js";
import { phoneDigest } from "../lib/keyedDigest.js";
import { PHONE_INPUT_MAX_LENGTH, normalizePhoneToE164, phoneLast4 } from "../lib/phone.js";
import { generateOnboardingToken, onboardingSessionTokenData } from "../lib/onboardingSessions.js";
import { auditEvent } from "../lib/audit.js";
import { ConsentReleaseService } from "./consentReleases.js";
import { canonicalEmail, emailCompleteBase } from "./emailAuth.js";

const plainText = (min: number, max: number) => z.string().transform((v) => v.normalize("NFC").trim().replace(/\s+/g, " "))
  .pipe(z.string().min(min).max(max).refine((v) => !/[\u0000-\u001f\u007f<>]/u.test(v), "Invalid value"));
const phoneInput = z.string().trim().min(7).max(PHONE_INPUT_MAX_LENGTH);
export const MERCHANT_STORE_TYPES = ["grocery", "restaurant", "pharmacy", "clothing", "electronics", "bakery", "other"] as const;
export const GOOGLE_ONBOARDING_ROLES = ["passenger", "driver", "merchant"] as const;
// Each role collects only what its experience needs; the account name comes from `name`.
const passengerProfileSchema = z.strictObject({ phone: phoneInput, city: plainText(2, 100) });
const driverProfileSchema = z.strictObject({
  phone: phoneInput, city: plainText(2, 100),
  national_id_number: z.string().trim().regex(/^[A-Za-z0-9-]{5,40}$/),
  licence_number: z.string().trim().regex(/^[A-Za-z0-9-]{4,40}$/),
  licence_expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vehicle_type: plainText(2, 80), vehicle_make_model: plainText(2, 80), vehicle_color: plainText(2, 30),
  plate_number: z.string().trim().toUpperCase().regex(/^[A-Z0-9 -]{2,20}$/),
  seats_total: z.number().int().min(1).max(8), parcel_capacity: z.number().int().min(0).max(20)
});
const merchantProfileSchema = z.strictObject({
  phone: phoneInput, store_name: plainText(2, 120), store_type: z.enum(MERCHANT_STORE_TYPES),
  sales_channel: z.enum(["online", "physical", "both"]), city: plainText(2, 100), address: plainText(3, 200).optional()
}).refine((v) => v.sales_channel === "online" || v.address !== undefined, { path: ["address"], message: "address_required" });
type GoogleProfile =
  | { role: "passenger"; profile: z.infer<typeof passengerProfileSchema> }
  | { role: "driver"; profile: z.infer<typeof driverProfileSchema> }
  | { role: "merchant"; profile: z.infer<typeof merchantProfileSchema> };
const profileSchemas = { passenger: passengerProfileSchema, driver: driverProfileSchema, merchant: merchantProfileSchema } as const;

// `role` and `profile` are optional together for clients that predate role onboarding: those still get a
// passenger account that must add its phone before using the app (profile_state phone_required).
export const googleCompleteSchema = emailCompleteBase.omit({ email_verification_token: true, email_verification_code: true }).extend({
  name: z.string().trim().min(1).max(120),
  role: z.enum(GOOGLE_ONBOARDING_ROLES).optional(),
  profile: z.record(z.string(), z.unknown()).optional()
}).superRefine((value, ctx) => {
  if ((value.role === undefined) !== (value.profile === undefined)) { ctx.addIssue({ code: "custom", path: ["profile"], message: "role_profile_mismatch" }); return; }
  if (!value.role) return;
  const parsed = profileSchemas[value.role].safeParse(value.profile);
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ["profile", ...issue.path] } as never);
});
export type GoogleCompleteInput = z.infer<typeof googleCompleteSchema>;
function roleProfile(input: GoogleCompleteInput): GoogleProfile | null {
  if (!input.role) return null;
  return { role: input.role, profile: profileSchemas[input.role].parse(input.profile) } as GoogleProfile;
}
function utcDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, "validation_error");
  return date;
}
export type GooglePendingStatus = { token: string; expiresAt: Date };
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
      // A driver awaiting review signs back in to see their application, never to the app itself.
      if (linked.user.account_status === "pending" && (linked.user.role === "driver" || linked.user.role === "merchant")) return { kind: "pending", user: linked.user } as const;
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
  /** Driver applications reuse the self-service document upload and Admin review, so they need public onboarding switched on. */
  private driverSignup() {
    const { onboarding, publicRegistration, driverDocuments, publicOnboardingEnabled } = this.config;
    if (!publicOnboardingEnabled || !onboarding || !publicRegistration || !driverDocuments) throw new HttpError(503, "google_driver_signup_unavailable");
    return { onboarding, publicRegistration };
  }
  async complete<T>(input: GoogleCompleteInput, createSession: (tx: Prisma.TransactionClient, user: Awaited<ReturnType<PrismaClient["user"]["create"]>>) => Promise<T>, requestId?: string): Promise<{ user: Awaited<ReturnType<PrismaClient["user"]["create"]>>; session?: T; pending?: GooglePendingStatus }> {
    const grant = open(input.registration_token, this.key()); this.eligible(grant.email);
    const chosen = roleProfile(input);
    const driverSignup = chosen?.role === "driver" ? this.driverSignup() : null;
    let phone: string | null = null;
    if (chosen) {
      try { phone = normalizePhoneToE164(chosen.profile.phone); } catch { throw new HttpError(400, "invalid_phone"); }
    }
    const licenceExpiresAt = chosen?.role === "driver" ? utcDate(chosen.profile.licence_expires_at) : null;
    if (licenceExpiresAt && licenceExpiresAt.getTime() < utcDate(new Date().toISOString().slice(0, 10)).getTime()) throw new HttpError(400, "licence_expired");
    try {
      return await this.db.$transaction(async (tx) => {
        let proof;
        try { proof = await consumeAuthAction(tx, grant.action, "google_registration", { key: this.key() }); }
        catch (e) { if (e instanceof AuthActionError) throw new HttpError(400, "auth_action_invalid"); throw e; }
        if (proof.user_id || !proof.subject_digest || !hexDigestMatches(proof.subject_digest, keyedDigest("masari:auth-action-subject", subject(grant), this.key()))) throw new HttpError(400, "auth_action_invalid");
        if (await tx.externalIdentity.findUnique({ where: { provider_provider_subject: { provider: "google", provider_subject: grant.sub } } })) throw new HttpError(409, "google_identity_already_registered");
        if (await tx.user.findUnique({ where: { email: grant.email } })) throw new HttpError(409, "explicit_link_required");
        if (phone && await tx.user.findUnique({ where: { phone } })) throw new HttpError(409, "phone_already_in_use");
        const effective = await this.releases.current(new Date(), tx);
        if (!effective.ready) throw new HttpError(409, "consent_version_changed");
        const documents = effective.release.documents.filter((d) => d.locale === input.locale);
        if (!input.adult_self_attestation || documents.length !== 3 || new Set(input.consents.map((c) => c.type)).size !== 3 || documents.some((d) => !input.consents.some((c) => c.id === d.id && c.type === d.document_type && hexDigestMatches(c.content_hash, d.content_digest)))) throw new HttpError(409, "consent_version_changed");
        const now = new Date();
        const role = chosen?.role ?? "passenger";
        const pending = role === "driver";
        // The phone is a contact number, not a sign-in identifier: it stays unverified (phone login needs a
        // verified phone). Drivers wait for Admin review; passengers and shop owners use the app at once.
        const user = await tx.user.create({ data: {
          name: input.name, email: grant.email, email_verified_at: now, phone, phone_verified_at: null, password_hash: null,
          profile_state: chosen ? "complete" : "phone_required", role, account_status: pending ? "pending" : "active",
          city: chosen && "city" in chosen.profile ? chosen.profile.city : null,
          // A driver enters the review queue only after uploading every required document and submitting.
          review_submitted_at: role === "merchant" ? now : null,
          security_version: 1, demo_account: false
        } });
        await tx.externalIdentity.create({ data: { user_id: user.id, provider: "google", provider_subject: grant.sub, provider_email_snapshot: grant.email, last_authenticated_at: now } });
        await tx.userConsent.createMany({ data: documents.map((d) => ({ user_id: user.id, consent_document_id: d.id, accepted_at: now, source: "google_registration", request_id: requestId, app_release: this.config.appRelease })) });
        if (chosen?.role === "merchant") {
          const { store_name, store_type, sales_channel, city, address } = chosen.profile;
          await tx.merchantProfile.create({ data: { user_id: user.id, store_name, store_type, sales_channel, city, address: address ?? null } });
        }
        let pendingStatus: GooglePendingStatus | undefined;
        if (chosen?.role === "driver") {
          const p = chosen.profile;
          // Unverified until an Admin approves: approval flips `verified` and activates the account.
          await tx.driverProfile.create({ data: {
            user_id: user.id, vehicle_type: p.vehicle_type, seats_total: p.seats_total, parcel_capacity: p.parcel_capacity, verified: false,
            vehicle_make_model: p.vehicle_make_model, vehicle_color: p.vehicle_color, plate_number: p.plate_number,
            national_id_number: p.national_id_number, licence_number: p.licence_number
          } });
          await tx.driverVerification.create({ data: { user_id: user.id, status: "pending", submitted_at: now, licence_expires_at: licenceExpiresAt } });
          // The pending-status session that drives document upload and review status hangs off a completed
          // onboarding attempt. Google proved the mailbox, so this attempt records the outcome, not an OTP.
          const keys = driverSignup!.onboarding.keys;
          const attempt = await tx.onboardingAttempt.create({ data: {
            intended_role: "driver", phone_e164: phone!, phone_digest: phoneDigest(phone!, keys.phoneDigest), phone_digest_version: keys.phoneDigest.version,
            phone_last4: phoneLast4(phone!), delivery_email: grant.email, status: "completed", completed_user_id: user.id, completed_at: now,
            verified_at: now, expires_at: now, created_request_id: requestId
          } });
          pendingStatus = await this.issuePendingStatus(tx, attempt.id, user, now);
        }
        await auditEvent(tx, { userId: user.id, action: "registration_completed", entityType: "User", entityId: user.id,
          metadata: { role: user.role, account_status: user.account_status, method: "google", request_id: requestId ?? null } });
        if (pendingStatus) return { user, pending: pendingStatus };
        return { user, session: await createSession(tx, user) };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      // Competing grants must never turn a uniqueness/deadlock loser into login.
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new HttpError(409, "explicit_link_required");
      throw error;
    }
  }
  private async issuePendingStatus(tx: Prisma.TransactionClient, attemptId: string, user: { id: string; role: string }, now: Date): Promise<GooglePendingStatus> {
    const { onboarding, publicRegistration } = this.driverSignup();
    await tx.onboardingSession.updateMany({ where: { user_id: user.id, purpose: "pending_status", revoked_at: null }, data: { revoked_at: now, revoke_reason: "pending_status_rotated" } });
    const token = generateOnboardingToken();
    const session = await tx.onboardingSession.create({ data: onboardingSessionTokenData({
      token, key: onboarding.keys.onboardingSession, attemptId, userId: user.id, purpose: "pending_status",
      expiresAt: new Date(now.getTime() + publicRegistration.pendingStatusTtlDays * 86_400_000)
    }) });
    await auditEvent(tx, { userId: user.id, action: "pending_status_session_created", entityType: "OnboardingSession", entityId: session.id, metadata: { role: user.role, method: "google" } });
    return { token, expiresAt: session.expires_at };
  }
  /** A fresh pending-status session for an applicant who signed back in with Google while awaiting review. */
  async pendingStatus(userId: string) {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, include: { onboarding_attempts: { where: { status: "completed" }, orderBy: { completed_at: "desc" }, take: 1 } } });
      const attempt = user?.onboarding_attempts[0];
      if (!user || !attempt || user.account_status !== "pending" || (user.role !== "driver" && user.role !== "merchant")) throw new HttpError(403, "account_unavailable");
      const status = await this.issuePendingStatus(tx, attempt.id, user, new Date());
      const submitted = user.review_submitted_at !== null;
      return {
        role: user.role,
        onboarding_status: submitted ? "pending_review" : "documents_required",
        next_action: submitted ? "await_approval" : "upload_documents",
        onboarding_status_token: status.token,
        onboarding_status_expires_at: status.expiresAt
      };
    });
  }
}
