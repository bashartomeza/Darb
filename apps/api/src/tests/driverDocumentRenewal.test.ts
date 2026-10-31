import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  notification: { create: vi.fn() },
  driverVerification: { findUnique: vi.fn(), updateMany: vi.fn() },
  driverVerificationDecision: { create: vi.fn() },
  driverVerificationDocument: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), delete: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake jpeg body")]);
const driver = {
  id: "drv_1",
  name: "Driver",
  phone: "+970590000099",
  role: "driver" as const,
  account_status: "active",
  security_version: 1,
  demo_account: false,
  email_verified_at: new Date()
};
const expired = { id: "ver_1", user_id: "drv_1", status: "documents_expired", revision: 4, documents_expired_at: new Date(), renewal_submitted_at: null };

function auth() {
  return { Authorization: `Bearer ${signAuthToken({ id: driver.id, role: driver.role, sessionId: "s_drv", securityVersion: 1 })}` };
}

describe("driver document renewal", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "masari-renew-"));
    app = createApp(
      createConfig({
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
        DEMO_ADMIN_PASSWORD: "test-admin-password",
        DRIVER_DOCUMENTS_ENABLED: "true",
        DRIVER_DOCUMENTS_DIR: dir
      })
    );
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.authSession.findUnique.mockResolvedValue({
      id: "s_drv",
      user_id: driver.id,
      user: driver,
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null
    });
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.driverVerification.findUnique.mockResolvedValue(expired);
    prismaMock.driverVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.driverVerificationDocument.count.mockResolvedValue(0);
    prismaMock.driverVerificationDocument.findMany.mockResolvedValue([]);
    prismaMock.driverVerificationDocument.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "doc_1", created_at: new Date(), ...data })
    );
    prismaMock.auditEvent.create.mockResolvedValue({});
    prismaMock.notification.create.mockResolvedValue({});
    prismaMock.driverVerificationDecision.create.mockResolvedValue({});
  });

  it("requires a driver session", async () => {
    await request(app).get("/api/v1/driver/document-renewal").expect(401);
  });

  it("uploads renewal documents for the expired revision and then submits them to the re-review queue", async () => {
    const upload = await request(app)
      .post("/api/v1/driver/document-renewal/documents?kind=driver_licence")
      .set(auth())
      .set("Content-Type", "application/octet-stream")
      .send(JPEG)
      .expect(201);
    expect(upload.body.document.kind).toBe("driver_licence");
    expect(prismaMock.driverVerificationDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ verification_id: "ver_1", revision: 4 })
    });
    expect(await readdir(dir)).toHaveLength(1);

    prismaMock.driverVerificationDocument.count.mockResolvedValue(1);
    await request(app).post("/api/v1/driver/document-renewal/submit").set(auth()).expect(200);
    expect(prismaMock.driverVerification.updateMany).toHaveBeenCalledWith({
      where: { id: "ver_1", status: "documents_expired", revision: 4 },
      data: expect.objectContaining({ status: "pending", renewal_submitted_at: expect.any(Date) })
    });
    expect(prismaMock.driverVerificationDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ decision: "renewal_submitted" })
    });
  });

  it("will not submit without documents and will not accept uploads once submitted or approved", async () => {
    await request(app).post("/api/v1/driver/document-renewal/submit").set(auth()).expect(409);
    expect(prismaMock.driverVerification.updateMany).not.toHaveBeenCalled();

    for (const status of ["pending", "approved"]) {
      prismaMock.driverVerification.findUnique.mockResolvedValue({ ...expired, status });
      await request(app)
        .post("/api/v1/driver/document-renewal/documents?kind=driver_licence")
        .set(auth())
        .set("Content-Type", "application/octet-stream")
        .send(JPEG)
        .expect(409);
    }
    expect(prismaMock.driverVerificationDocument.create).not.toHaveBeenCalled();
  });

  it("reports the renewal state to the driver", async () => {
    const response = await request(app).get("/api/v1/driver/document-renewal").set(auth()).expect(200);
    expect(response.body).toEqual(expect.objectContaining({ status: "documents_expired", can_upload: true, submitted: false }));
  });
});
