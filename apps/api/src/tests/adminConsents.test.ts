import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { HttpError } = await import("../middleware/error.js");
const { signAuthToken } = await import("../middleware/auth.js");

const now = new Date("2026-08-21T12:00:00.000Z");
const admin = { email_verified_at: new Date(), id: "admin_1", name: "Admin", phone: "+970590000005", role: "admin" as const, account_status: "active", security_version: 1, demo_account: false };
const passenger = { ...admin, id: "passenger_1", role: "passenger" as const };
const documents = (["terms", "privacy", "adult_self_attestation"] as const).flatMap((type) =>
  (["ar", "en"] as const).map((locale, index) => ({
    id: `${type}_${locale}`,
    release_id: "release_1",
    document_type: type,
    version: "release-1",
    locale,
    content_body: `TEST ONLY - NOT LEGAL CONTENT ${type}/${locale}`,
    content_digest: String(index).padStart(64, "a").slice(0, 64),
    content_reference: null,
    effective_at: now,
    retired_at: null,
    legal_approved_at: null,
    legal_approved_by: null,
    created_at: now
  }))
);
const release = {
  id: "release_1",
  version: "release-1",
  status: "draft" as const,
  revision: 1,
  intended_effective_at: now,
  legal_approved_at: null,
  legal_approved_by: null,
  activated_at: null,
  activated_by: null,
  retired_at: null,
  retired_by: null,
  retirement_reason: null,
  created_by: admin.id,
  created_at: now,
  updated_at: now,
  documents
};

const service = {
  list: vi.fn(), current: vi.fn(), findByVersion: vi.fn(), create: vi.fn(), updateDraft: vi.fn(), approve: vi.fn(), activate: vi.fn(), retire: vi.fn()
};

function sessionFor(user: typeof admin | typeof passenger) {
  return { id: `session_${user.id}`, user_id: user.id, user, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null };
}

function authorization(user: typeof admin | typeof passenger = admin) {
  return { Authorization: `Bearer ${signAuthToken({ id: user.id, role: user.role, sessionId: `session_${user.id}`, securityVersion: 1 })}` };
}

function draftBody() {
  return {
    version: release.version,
    intended_effective_at: now.toISOString(),
    documents: documents.map((document) => ({ type: document.document_type, locale: document.locale, content: document.content_body }))
  };
}

describe("Admin consent release API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => sessionFor(where.id.includes("passenger") ? passenger : admin));
    prismaMock.authSession.update.mockResolvedValue({});
    service.list.mockResolvedValue([release]);
    service.current.mockResolvedValue({ ready: false, ambiguous: false, release: null });
    service.findByVersion.mockResolvedValue(release);
    service.create.mockResolvedValue(release);
    service.updateDraft.mockResolvedValue({ ...release, revision: 2 });
    service.approve.mockResolvedValue({ ...release, status: "approved", revision: 2 });
    service.activate.mockResolvedValue({ ...release, status: "effective", revision: 2 });
    service.retire.mockResolvedValue({ ...release, status: "retired", revision: 2 });
  });

  const app = () => createApp(undefined, { consentReleaseService: service as never });

  it("protects every read and mutation with 401/403/Admin authorization", async () => {
    const endpoints = [
      { method: "get", path: "/api/v1/admin/consent-releases" },
      { method: "get", path: "/api/v1/admin/consent-releases/current" },
      { method: "get", path: `/api/v1/admin/consent-releases/${release.version}` },
      { method: "post", path: "/api/v1/admin/consent-releases", body: draftBody() },
      { method: "put", path: `/api/v1/admin/consent-releases/${release.version}`, body: { expected_revision: 1, ...draftBody(), version: undefined } },
      { method: "post", path: `/api/v1/admin/consent-releases/${release.version}/approve`, body: { expected_revision: 1, legal_approval_confirmed: true } },
      { method: "post", path: `/api/v1/admin/consent-releases/${release.version}/activate`, body: { expected_revision: 1, expected_current_release_id: null, activation_confirmed: true } },
      { method: "post", path: `/api/v1/admin/consent-releases/${release.version}/retire`, body: { expected_revision: 1, reason: "superseded", confirm_disable_onboarding: true } }
    ] as const;
    for (const endpoint of endpoints) {
      const body = "body" in endpoint ? endpoint.body : undefined;
      await request(app())[endpoint.method](endpoint.path).send(body).expect(401);
      await request(app())[endpoint.method](endpoint.path).set(authorization(passenger)).send(body).expect(403);
    }
    expect(service.list).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });

  it("creates a complete draft and never accepts a browser digest", async () => {
    const body = draftBody();
    const response = await request(app()).post("/api/v1/admin/consent-releases").set(authorization()).send(body).expect(201);
    expect(response.body.release).toEqual(expect.objectContaining({ version: release.version, status: "draft", revision: 1 }));
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ documents: body.documents }), admin.id);
    expect(JSON.stringify(service.create.mock.calls[0])).not.toContain("content_digest");
  });

  it("rejects missing, invalid, and duplicate-shaped identities before persistence", async () => {
    const missing = draftBody();
    missing.documents.pop();
    await request(app()).post("/api/v1/admin/consent-releases").set(authorization()).send(missing).expect(400);
    const invalidType = draftBody();
    invalidType.documents[0].type = "unknown" as never;
    await request(app()).post("/api/v1/admin/consent-releases").set(authorization()).send(invalidType).expect(400);
    const invalidLocale = draftBody();
    invalidLocale.documents[0].locale = "fr" as never;
    await request(app()).post("/api/v1/admin/consent-releases").set(authorization()).send(invalidLocale).expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("passes explicit stale revisions and confirmations to each lifecycle action", async () => {
    await request(app()).put(`/api/v1/admin/consent-releases/${release.version}`).set(authorization()).send({ expected_revision: 1, intended_effective_at: now.toISOString(), documents: draftBody().documents }).expect(200);
    await request(app()).post(`/api/v1/admin/consent-releases/${release.version}/approve`).set(authorization()).send({ expected_revision: 2, legal_approval_confirmed: true }).expect(200);
    await request(app()).post(`/api/v1/admin/consent-releases/${release.version}/activate`).set(authorization()).send({ expected_revision: 3, expected_current_release_id: "old_release", activation_confirmed: true }).expect(200);
    await request(app()).post(`/api/v1/admin/consent-releases/${release.version}/retire`).set(authorization()).send({ expected_revision: 4, reason: "Legal replacement required", confirm_disable_onboarding: true }).expect(200);
    expect(service.updateDraft).toHaveBeenCalledWith(release.version, 1, expect.any(Object), admin.id);
    expect(service.approve).toHaveBeenCalledWith(release.version, 2, admin.id);
    expect(service.activate).toHaveBeenCalledWith(release.version, 3, "old_release", admin.id);
    expect(service.retire).toHaveBeenCalledWith(release.version, 4, "Legal replacement required", true, admin.id);
  });

  it("returns a safe 409 for stale or concurrent state", async () => {
    service.updateDraft.mockRejectedValueOnce(new HttpError(409, "consent_release_state_conflict"));
    const response = await request(app()).put(`/api/v1/admin/consent-releases/${release.version}`).set(authorization()).send({ expected_revision: 1, intended_effective_at: now.toISOString(), documents: draftBody().documents }).expect(409);
    expect(response.body.error).toBe("consent_release_state_conflict");
  });

  it("requires explicit approval, activation and disable-onboarding confirmation", async () => {
    await request(app()).post(`/api/v1/admin/consent-releases/${release.version}/approve`).set(authorization()).send({ expected_revision: 1 }).expect(400);
    await request(app()).post(`/api/v1/admin/consent-releases/${release.version}/activate`).set(authorization()).send({ expected_revision: 1, expected_current_release_id: null }).expect(400);
    await request(app()).post(`/api/v1/admin/consent-releases/${release.version}/retire`).set(authorization()).send({ expected_revision: 1, reason: "retire", confirm_disable_onboarding: false }).expect(400);
  });
});
