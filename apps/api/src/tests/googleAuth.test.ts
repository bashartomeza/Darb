import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthService, googleCompleteSchema, googleAllowlistDigest } from "../services/googleAuth.js";
import { validatedGoogleClaims, verifyGoogleIdentity } from "../lib/googleIdentity.js";
import { OAuth2Client } from "google-auth-library";
import { config } from "../config.js";

const documents = ["terms", "privacy", "adult_self_attestation"].map((type, i) => ({ id: `doc_${i}`, document_type: type, locale: "en", content_digest: String(i + 1).repeat(64) }));
const identity = { sub: "google-sub", email: "owner@example.com", emailVerified: true };
const key = { secret: "test-google-action-key-at-least-32-characters", version: 1 };
let actions: any[]; let users: any[]; let identities: any[]; let consents: any[]; let rows: Record<string, any[]>;
let db: any; let releases: any; let verifier: any;
const onboardingKeys = { phoneDigest: { secret: "p".repeat(40), version: 1 }, onboardingSession: { secret: "s".repeat(40), version: 1 }, abuse: { secret: "a".repeat(40), version: 1 } };
function service(mode: "disabled" | "allowlist" | "open" = "open", allowlist: string[] = [], driverSignup = true) {
  return new GoogleAuthService(db, { ...config, authActions: { key }, googleAuth: { mobileClientIds: ["mobile-client"], adminClientIds: ["admin-client"], passengerSignupMode: mode, passengerAllowlist: allowlist },
    ...(driverSignup ? { publicOnboardingEnabled: true, onboarding: { keys: onboardingKeys }, publicRegistration: { pendingStatusTtlDays: 14 }, driverDocuments: { dir: "/tmp/docs" } } : { publicOnboardingEnabled: false }) } as any, verifier, releases);
}
function roleCompletion(grant: any, role: string, profile: Record<string, unknown>) { return googleCompleteSchema.parse({ ...completion(grant), name: "Rana Haddad", role, profile }); }
const futureDate = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
const driverProfile = { phone: "+970599123456", city: "Ramallah", national_id_number: "401234567", licence_number: "DL-12345", licence_expires_at: futureDate,
  vehicle_type: "Sedan", vehicle_make_model: "Kia Optima", vehicle_color: "White", plate_number: "ab-1234", seats_total: 4, parcel_capacity: 3 };
const merchantProfile = { phone: "+970599654321", store_name: "Rana Market", store_type: "grocery", sales_channel: "both", city: "Nablus", address: "Main street 5" };
const ROW_MODELS = ["merchantProfile", "driverProfile", "driverVerification", "onboardingAttempt", "onboardingSession", "auditEvent"];
function completion(grant: any) { return googleCompleteSchema.parse({ registration_token: grant.registration_token, name: "Passenger", locale: "en", consents: documents.map((d) => ({ id: d.id, type: d.document_type, content_hash: d.content_digest })), adult_self_attestation: true }); }
describe("Google passenger authentication", () => {
  beforeEach(() => {
    actions = []; users = []; identities = []; consents = []; rows = Object.fromEntries(ROW_MODELS.map((model) => [model, []]));
    verifier = vi.fn().mockResolvedValue(identity);
    releases = { current: vi.fn().mockResolvedValue({ ready: true, release: { documents } }) };
    db = {
      user: { findUnique: vi.fn(async ({ where }: any) => users.find((u) => where.email ? u.email === where.email : where.phone ? u.phone === where.phone : u.id === where.id) ?? null), create: vi.fn(async ({ data }: any) => { const u = { id: "user_1", ...data }; users.push(u); return u; }) },
      externalIdentity: { findUnique: vi.fn(async ({ where }: any) => identities.find((i) => i.provider_subject === where.provider_provider_subject.provider_subject) ?? null), create: vi.fn(async ({ data }: any) => { identities.push(data); return data; }), update: vi.fn() },
      ...Object.fromEntries(ROW_MODELS.map((model) => [model, {
        create: vi.fn(async ({ data }: any) => { const row = { id: model + "_" + rows[model].length, ...data }; rows[model].push(row); return row; }),
        updateMany: vi.fn(async () => ({ count: 0 }))
      }])),
      userConsent: { createMany: vi.fn(async ({ data }: any) => { consents.push(...data); return { count: data.length }; }) },
      authActionToken: {
        create: vi.fn(async ({ data }: any) => { const a = { id: `a_${actions.length}`, consumed_at: null, ...data }; actions.push(a); return a; }),
        findUnique: vi.fn(async ({ where }: any) => actions.find((a) => a.token_digest === where.token_digest) ?? null),
        updateMany: vi.fn(async ({ where, data }: any) => { const matches = actions.filter((a) => Object.entries(where).every(([k, v]: any) => k === "expires_at" ? a[k] > v.gt : a[k] === v)); matches.forEach((a) => Object.assign(a, data)); return { count: matches.length }; })
      }
    };
    db.$transaction = vi.fn(async (callback: any) => { const snapshot = structuredClone({ actions, users, identities, consents, rows }); const { $transaction: _transaction, ...tx } = db; try { return await callback(tx); } catch (e) { ({ actions, users, identities, consents, rows } = snapshot); throw e; } });
  });
  it("never links an unknown subject by a matching email", async () => {
    users.push({ id: "existing", email: identity.email });
    await expect(service().start("raw-google-token")).rejects.toMatchObject({ statusCode: 409, message: "explicit_link_required" });
    expect(identities).toHaveLength(0); expect(actions).toHaveLength(0); expect(db.user.create).not.toHaveBeenCalled();
  });
  it("issues only a digest-backed grant before consent and creates passenger after current consent", async () => {
    const auth = service(); const grant = await auth.start("raw-google-token");
    expect(grant).toMatchObject({ kind: "registration", next_action: "consent_required" }); expect(users).toHaveLength(0);
    expect(JSON.stringify(actions)).not.toMatch(/owner@example|google-sub|raw-google-token/);
    const session = vi.fn().mockResolvedValue({ token: "darb-session" });
    const result = await auth.complete(completion(grant), session);
    expect(result.user).toMatchObject({ role: "passenger", phone: null, password_hash: null, profile_state: "phone_required", account_status: "active" });
    expect(identities[0]).toMatchObject({ provider: "google", provider_subject: identity.sub }); expect(consents).toHaveLength(3);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    await expect(auth.complete(completion(grant), session)).rejects.toMatchObject({ message: "auth_action_invalid" }); expect(users).toHaveLength(1);
  });
  it("creates an active passenger with phone and city who can use the app at once", async () => {
    const auth = service(); const grant = await auth.start("raw");
    const session = vi.fn().mockResolvedValue({ token: "session" });
    const result = await auth.complete(roleCompletion(grant, "passenger", { phone: "+970 599 111 222", city: " Ramallah " }), session);
    expect(result.user).toMatchObject({ role: "passenger", name: "Rana Haddad", phone: "+970599111222", phone_verified_at: null, city: "Ramallah", profile_state: "complete", account_status: "active" });
    expect(result.session).toEqual({ token: "session" }); expect(result.pending).toBeUndefined();
  });
  it("creates an active shop owner with a store profile", async () => {
    const auth = service(); const grant = await auth.start("raw");
    const result = await auth.complete(roleCompletion(grant, "merchant", merchantProfile), vi.fn().mockResolvedValue({ token: "session" }));
    expect(result.user).toMatchObject({ role: "merchant", account_status: "active", profile_state: "complete", phone: "+970599654321" });
    expect(result.user.review_submitted_at).toBeInstanceOf(Date);
    expect(rows.merchantProfile[0]).toMatchObject({ user_id: result.user.id, store_name: "Rana Market", store_type: "grocery", sales_channel: "both", city: "Nablus", address: "Main street 5" });
    expect(result.session).toBeDefined();
  });
  it("requires a store address unless the store is online only", () => {
    const grant = { registration_token: "x".repeat(60) };
    expect(() => roleCompletion(grant, "merchant", { ...merchantProfile, address: undefined })).toThrow();
    expect(() => roleCompletion(grant, "merchant", { ...merchantProfile, sales_channel: "online", address: undefined })).not.toThrow();
  });
  it("keeps a driver pending with no app session and an unverified profile for Admin review", async () => {
    const auth = service(); const grant = await auth.start("raw");
    const session = vi.fn();
    const result = await auth.complete(roleCompletion(grant, "driver", driverProfile), session);
    expect(session).not.toHaveBeenCalled(); expect(result.session).toBeUndefined();
    expect(result.user).toMatchObject({ role: "driver", account_status: "pending", review_submitted_at: null, profile_state: "complete" });
    expect(rows.driverProfile[0]).toMatchObject({ verified: false, plate_number: "AB-1234", national_id_number: "401234567", licence_number: "DL-12345", vehicle_make_model: "Kia Optima", seats_total: 4 });
    expect(rows.driverVerification[0]).toMatchObject({ status: "pending", licence_expires_at: new Date(futureDate + "T00:00:00.000Z") });
    expect(rows.onboardingAttempt[0]).toMatchObject({ intended_role: "driver", status: "completed", completed_user_id: result.user.id, phone_e164: "+970599123456" });
    expect(rows.onboardingSession[0]).toMatchObject({ purpose: "pending_status", user_id: result.user.id });
    expect(result.pending?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(rows.onboardingSession)).not.toContain(result.pending!.token);
  });
  it("rejects driver signup when document review is not configured, and expired licences", async () => {
    const grant = await service().start("raw");
    await expect(service("open", [], false).complete(roleCompletion(grant, "driver", driverProfile), vi.fn())).rejects.toMatchObject({ statusCode: 503, message: "google_driver_signup_unavailable" });
    await expect(service().complete(roleCompletion(grant, "driver", { ...driverProfile, licence_expires_at: "2020-01-01" }), vi.fn())).rejects.toMatchObject({ message: "licence_expired" });
    expect(users).toHaveLength(0); expect(actions[0].consumed_at).toBeNull();
  });
  it("refuses a phone that belongs to another account without creating anything", async () => {
    const auth = service(); const grant = await auth.start("raw"); users.push({ id: "other", phone: "+970599111222" });
    await expect(auth.complete(roleCompletion(grant, "passenger", { phone: "+970599111222", city: "Gaza" }), vi.fn())).rejects.toMatchObject({ statusCode: 409, message: "phone_already_in_use" });
    expect(users).toHaveLength(1); expect(identities).toHaveLength(0);
  });
  it("requires role and profile together and validates the role's profile", () => {
    const grant = { registration_token: "x".repeat(60) };
    expect(() => googleCompleteSchema.parse({ ...completion(grant), role: "passenger" })).toThrow();
    expect(() => googleCompleteSchema.parse({ ...completion(grant), profile: { phone: "+970599111222", city: "Gaza" } })).toThrow();
    expect(() => roleCompletion(grant, "driver", { ...driverProfile, seats_total: 40 })).toThrow();
    expect(() => roleCompletion(grant, "passenger", { phone: "+970599111222", city: "Gaza", is_admin: true })).toThrow();
  });
  it("signs a pending applicant back in to their application, not the app", async () => {
    const user = { id: "driver_1", role: "driver", account_status: "pending" }; identities.push({ id: "ext", provider_subject: identity.sub, user });
    expect(await service().start("raw")).toEqual({ kind: "pending", user });
  });
  it("rolls back consumption/account/identity/consent when session fails", async () => {
    const auth = service(); const grant = await auth.start("raw");
    await expect(auth.complete(completion(grant), async () => { throw new Error("session failure"); })).rejects.toThrow("session failure");
    expect(users).toHaveLength(0); expect(identities).toHaveLength(0); expect(consents).toHaveLength(0); expect(actions[0].consumed_at).toBeNull();
  });
  it("does not burn a grant on changed legal versions or missing consent", async () => {
    const auth = service(); const grant = await auth.start("raw");
    const input = completion(grant); input.consents[0].content_hash = "f".repeat(64);
    await expect(auth.complete(input, vi.fn())).rejects.toMatchObject({ message: "consent_version_changed" });
    expect(users).toHaveLength(0); expect(actions[0].consumed_at).toBeNull();
    expect(() => googleCompleteSchema.parse({ ...completion(grant), adult_self_attestation: false })).toThrow();
    expect(() => googleCompleteSchema.parse({ ...completion(grant), role: "admin" })).toThrow();
  });
  it("rechecks collisions and rollout at completion", async () => {
    const grant = await service().start("raw"); users.push({ id: "existing", email: identity.email });
    await expect(service().complete(completion(grant), vi.fn())).rejects.toMatchObject({ message: "explicit_link_required" });
    users = [];
    await expect(service("disabled").complete(completion(grant), vi.fn())).rejects.toMatchObject({ message: "google_signup_unavailable" });
    expect(identities).toHaveLength(0);
  });
  it("uses only the linked subject and does not promote or look up its current email", async () => {
    const user = { id: "existing", role: "driver", account_status: "active" }; identities.push({ id: "ext", provider_subject: identity.sub, user });
    expect(await service("disabled").start("raw")).toEqual({ kind: "login", user });
    expect(db.user.findUnique).not.toHaveBeenCalled(); expect(verifier).toHaveBeenCalledWith("raw", ["mobile-client"]);
    user.role = "admin"; await expect(service().start("raw")).rejects.toMatchObject({ message: "invalid_credentials" });
    user.role = "passenger"; user.account_status = "suspended"; await expect(service().start("raw")).rejects.toMatchObject({ message: "account_unavailable" });
  });
  it("fails closed for disabled signup, invalid provider proof and unverified email", async () => {
    await expect(service("disabled").start("raw")).rejects.toMatchObject({ message: "google_signup_unavailable" });
    await expect(service("allowlist").start("raw")).rejects.toMatchObject({ message: "google_signup_unavailable" });
    verifier.mockResolvedValue({ ...identity, emailVerified: false });
    await expect(service().start("raw")).rejects.toMatchObject({ message: "invalid_google_token" });
    verifier.mockRejectedValue(new Error("secret raw-google-token"));
    await expect(service().start("raw")).rejects.toMatchObject({ message: "invalid_google_token" });
  });
  it("allows only an exact HMAC allowlist entry", async () => {
    expect(await service("allowlist", [googleAllowlistDigest(identity.email, key)]).start("raw")).toMatchObject({ kind: "registration" });
    await expect(service("allowlist", [googleAllowlistDigest("other@example.com", key)]).start("raw")).rejects.toMatchObject({ message: "google_signup_unavailable" });
  });
  it("allows only one competing grant to create the identity under serializable execution", async () => {
    const auth = service(); const first = await auth.start("raw"); const second = await auth.start("raw");
    const transaction = db.$transaction.getMockImplementation(); let queue = Promise.resolve();
    db.$transaction.mockImplementation((...args: any[]) => { const current = queue.then(() => transaction(...args)); queue = current.catch(() => {}); return current; });
    const session = vi.fn().mockResolvedValue({ token: "session" });
    const results = await Promise.allSettled([auth.complete(completion(first), session), auth.complete(completion(second), session)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]); expect(users).toHaveLength(1); expect(identities).toHaveLength(1); expect(session).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed, tampered and expired grant envelopes", async () => {
    const auth = service(); const grant = await auth.start("raw");
    await expect(auth.complete({ ...completion(grant), registration_token: "tampered" }, vi.fn())).rejects.toMatchObject({ message: "auth_action_invalid" });
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    try { await expect(auth.complete(completion(grant), vi.fn())).rejects.toMatchObject({ message: "auth_action_invalid" }); } finally { vi.useRealTimers(); }
  });
});

describe("Google provider claim validation", () => {
  const payload = () => ({ iss: "https://accounts.google.com", aud: "mobile-client", sub: "subject", email: " Owner@Example.com ", email_verified: true, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) });
  it("returns only normalized verified identity claims", () => {
    expect(validatedGoogleClaims({ ...payload(), name: "Private Name", picture: "private-url" }, ["mobile-client"])).toEqual({ sub: "subject", email: "owner@example.com", emailVerified: true });
  });
  it("uses the maintained verifier with only the route audience and sanitizes failures", async () => {
    const verification = vi.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({ getPayload: payload } as any);
    try {
      await expect(verifyGoogleIdentity("raw-provider-credential", ["mobile-client"])).resolves.toMatchObject({ sub: "subject" });
      expect(verification).toHaveBeenCalledWith({ idToken: "raw-provider-credential", audience: ["mobile-client"] });
      verification.mockRejectedValue(new Error("raw-provider-credential"));
      await expect(verifyGoogleIdentity("raw-provider-credential", ["mobile-client"])).rejects.toThrow("invalid_google_token");
      await expect(verifyGoogleIdentity("raw-provider-credential", [])).rejects.toThrow("google_auth_unavailable");
    } finally { verification.mockRestore(); }
  });
  it("accepts a native authorized party only when the exact mobile server audience is verified", () => {
    expect(validatedGoogleClaims({ ...payload(), azp: "android-client" }, ["mobile-client"])).toMatchObject({ sub: "subject" });
  });
  it.each([{ aud: "admin-client" }, { iss: "https://attacker.example" }, { sub: "" }, { email: "invalid" }, { email_verified: false }, { exp: 1 }, { iat: Number.MAX_SAFE_INTEGER }])("rejects invalid claims %j", (override) => {
    expect(() => validatedGoogleClaims({ ...payload(), ...override }, ["mobile-client"])).toThrow("invalid_google_token");
  });
});
