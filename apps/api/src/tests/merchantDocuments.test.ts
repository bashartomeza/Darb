import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

const tx = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  merchantApplicationDocument: { count: vi.fn(), create: vi.fn(), delete: vi.fn() },
  auditEvent: { create: vi.fn() }
}));

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  merchantApplicationDocument: { findMany: vi.fn(), findFirst: vi.fn() },
  $transaction: vi.fn()
}));

const onboardingContext = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("../middleware/onboardingAuth.js", async () => {
  const { HttpError } = await import("../middleware/error.js");
  return {
    requireOnboardingToken: () => (req: { onboarding?: unknown }, _res: unknown, next: (error?: unknown) => void) => {
      if (!onboardingContext.current) return next(new HttpError(401, "onboarding_unavailable"));
      req.onboarding = onboardingContext.current;
      next();
    }
  };
});
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake jpeg body")]);

const admin = { id: "admin_1", role: "admin", name: "A", phone: "+7", demo_account: true };
function adminAuth() {
  const token = jwt.sign({ role: "admin", sid: "session_admin_1", ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: "admin_1",
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const merchantContext = { sessionId: "s1", attemptId: "a1", userId: "shop_user", purpose: "pending_status", attemptStatus: "completed", userRole: "merchant", userStatus: "pending" };

describe("shop owner documents", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;
  let disabledApp: ReturnType<typeof createApp>;
  let merchantStatus = "pending";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "masari-merchant-docs-"));
    const env = {
      APP_ENV: "test",
      DATABASE_URL: "mysql://test:test@localhost:3306/masari_test",
      JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
      CORS_ORIGINS: "http://localhost:5173",
      LOG_LEVEL: "silent",
      DEMO_RESET_KEY: "test-reset-key",
      DEMO_RESET_ALLOWED_DATABASES: "masari_test",
      DEMO_PASSENGER_PASSWORD: "test-passenger-password",
      DEMO_DRIVER_PASSWORD: "test-driver-password",
      DEMO_MERCHANT_PASSWORD: "test-merchant-password",
      DEMO_ADMIN_PASSWORD: "test-admin-password"
    };
    app = createApp(createConfig({ ...env, DRIVER_DOCUMENTS_ENABLED: "true", DRIVER_DOCUMENTS_DIR: dir }));
    disabledApp = createApp(createConfig(env));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    merchantStatus = "pending";
    for (const name of await readdir(dir)) await rm(join(dir, name), { force: true });
    onboardingContext.current = { ...merchantContext };
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.user.findUnique.mockImplementation(async () => ({ account_status: merchantStatus }));
    tx.merchantApplicationDocument.count.mockResolvedValue(0);
    tx.merchantApplicationDocument.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "mdoc_1",
      created_at: new Date(),
      ...data
    }));
    prismaMock.user.findUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === "admin_1"
        ? { ...admin, account_status: "active", security_version: 1 }
        : { role: "merchant", account_status: merchantStatus }
    );
    prismaMock.authSession.findUnique.mockResolvedValue({
      id: "session_admin_1",
      user_id: "admin_1",
      user: { email_verified_at: new Date(), ...admin, account_status: "active", security_version: 1 },
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null
    });
  });

  const upload = (body: Buffer | string, kind = "commercial_register") =>
    request(app).post(`/api/v1/onboarding/merchant-documents?kind=${kind}`).set("Content-Type", "application/octet-stream").send(body);

  it("is unavailable until storage is configured", async () => {
    await request(disabledApp).get("/api/v1/onboarding/merchant-documents").expect(404);
  });

  it("stores a document on disk and records it against the shop owner", async () => {
    const response = await upload(JPEG).expect(201);

    expect(response.body.document).toMatchObject({ id: "mdoc_1", kind: "commercial_register", mime_type: "image/jpeg" });
    const data = tx.merchantApplicationDocument.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ user_id: "shop_user", mime_type: "image/jpeg" });
    expect(await readFile(join(dir, data.storage_key))).toEqual(JPEG);
  });

  it("rejects unknown content, empty bodies and driver-only kinds without writing anything", async () => {
    await upload("<html><script>alert(1)</script></html>").expect(415);
    await upload(Buffer.alloc(0)).expect(400);
    await upload(JPEG, "driver_licence").expect(400);
    expect(await readdir(dir)).toEqual([]);
    expect(tx.merchantApplicationDocument.create).not.toHaveBeenCalled();
  });

  it("only serves a pending shop owner", async () => {
    onboardingContext.current = { ...merchantContext, userRole: "driver" };
    await upload(JPEG).expect(403);
    onboardingContext.current = { ...merchantContext, userStatus: "active" };
    await upload(JPEG).expect(403);
    merchantStatus = "active";
    onboardingContext.current = { ...merchantContext };
    await upload(JPEG).expect(409);
    expect(await readdir(dir)).toEqual([]);
  });

  it("caps the number of documents and removes the file it just wrote", async () => {
    tx.merchantApplicationDocument.count.mockResolvedValue(6);
    await upload(JPEG).expect(409);
    expect(await readdir(dir)).toEqual([]);
  });

  it("lists and deletes only the shop owner's own documents", async () => {
    prismaMock.merchantApplicationDocument.findMany.mockResolvedValue([
      { id: "mdoc_1", kind: "shop_photo", mime_type: "image/jpeg", size_bytes: 10, created_at: new Date() }
    ]);
    const list = await request(app).get("/api/v1/onboarding/merchant-documents").expect(200);
    expect(list.body.limits.kinds).toEqual(["commercial_register", "national_id", "shop_photo", "other"]);
    expect(prismaMock.merchantApplicationDocument.findMany.mock.calls[0][0].where).toEqual({ user_id: "shop_user" });

    prismaMock.merchantApplicationDocument.findFirst.mockResolvedValue(null);
    await request(app).delete("/api/v1/onboarding/merchant-documents/other_user_doc").expect(404);
    expect(prismaMock.merchantApplicationDocument.findFirst.mock.calls[0][0].where).toEqual({ id: "other_user_doc", user_id: "shop_user" });
  });

  it("lets an Admin list and download, as an attachment, with an audit record", async () => {
    const stored = await upload(JPEG).expect(201);
    const key = tx.merchantApplicationDocument.create.mock.calls[0][0].data.storage_key;
    prismaMock.merchantApplicationDocument.findMany.mockResolvedValue([stored.body.document]);
    prismaMock.merchantApplicationDocument.findFirst.mockResolvedValue({
      id: "mdoc_1",
      user_id: "shop_user",
      kind: "commercial_register",
      mime_type: "image/jpeg",
      storage_key: key
    });

    const list = await request(app).get("/api/v1/admin/merchant-approvals/shop_user/documents").set(adminAuth()).expect(200);
    expect(list.body.documents).toHaveLength(1);

    const download = await request(app).get("/api/v1/admin/merchant-approvals/shop_user/documents/mdoc_1").set(adminAuth()).expect(200);
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(download.body)).toEqual(JPEG);
    expect(prismaMock.auditEvent.create).toHaveBeenCalled();
  });

  it("keeps documents away from anyone who is not an Admin", async () => {
    await request(app).get("/api/v1/admin/merchant-approvals/shop_user/documents").expect(401);
  });
});
