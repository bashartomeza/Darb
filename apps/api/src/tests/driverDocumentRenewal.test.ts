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
  driverVerificationDecision: { create: vi.fn(), findFirst: vi.fn() },
  driverVerificationDocument: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), delete: vi.fn() },
  documentFile: { create: vi.fn(), findUnique: vi.fn() }
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
    dir = await mkdtemp(join(tmpdir(), "darb-renew-"));
    app = createApp(
      createConfig({
        APP_ENV: "test",
        DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
        JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
        CORS_ORIGINS: "http://localhost:5173",
        LOG_LEVEL: "silent",
        DEMO_RESET_KEY: "test-reset-key",
        DEMO_RESET_ALLOWED_DATABASES: "darb_test",
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
    prismaMock.driverVerificationDecision.findFirst.mockResolvedValue(null);
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
    // The bytes are stored in the database with the row; nothing lands on disk.
    expect(prismaMock.documentFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ driver_document_id: "doc_1", content_type: "image/jpeg", size_bytes: JPEG.length })
    });
    expect(await readdir(dir)).toHaveLength(0);

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

  describe("after the review team rejects a renewal", () => {
    // The rejection moved the verification to the next revision.
    const rejectedRenewal = { ...expired, status: "rejected", revision: 5, documents_expired_at: null, rejection_reason: "The insurance photo is blurry" };

    beforeEach(() => {
      prismaMock.driverVerification.findUnique.mockResolvedValue(rejectedRenewal);
      prismaMock.driverVerificationDecision.findFirst.mockImplementation(({ where }: { where: { revision: number; decision: string } }) =>
        Promise.resolve(where.revision === 4 && where.decision === "renewal_submitted" ? { id: "dec_1" } : null)
      );
    });

    it("tells the driver why and lets them renew again", async () => {
      const response = await request(app).get("/api/v1/driver/document-renewal").set(auth()).expect(200);
      expect(response.body).toEqual(expect.objectContaining({
        status: "rejected",
        can_upload: true,
        submitted: false,
        renewal_rejected: true,
        rejection_reason: "The insurance photo is blurry"
      }));
      expect(prismaMock.driverVerificationDecision.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { verification_id: "ver_1", revision: 4, decision: "renewal_submitted" }
      }));
    });

    it("accepts corrected documents for the new revision and sends them for review", async () => {
      await request(app)
        .post("/api/v1/driver/document-renewal/documents?kind=insurance")
        .set(auth())
        .set("Content-Type", "application/octet-stream")
        .send(JPEG)
        .expect(201);
      expect(prismaMock.driverVerificationDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ verification_id: "ver_1", revision: 5 })
      });

      prismaMock.driverVerificationDocument.count.mockResolvedValue(1);
      await request(app).post("/api/v1/driver/document-renewal/submit").set(auth()).expect(200);
      expect(prismaMock.driverVerification.updateMany).toHaveBeenCalledWith({
        where: { id: "ver_1", status: "rejected", revision: 5 },
        data: expect.objectContaining({ status: "pending", renewal_submitted_at: expect.any(Date), rejection_reason: null })
      });
    });

    it("a rejected first application is not a renewal: nothing to upload and no reason here", async () => {
      prismaMock.driverVerificationDecision.findFirst.mockResolvedValue(null);
      const response = await request(app).get("/api/v1/driver/document-renewal").set(auth()).expect(200);
      expect(response.body).toEqual(expect.objectContaining({ can_upload: false, renewal_rejected: false, rejection_reason: null }));
      await request(app)
        .post("/api/v1/driver/document-renewal/documents?kind=insurance")
        .set(auth())
        .set("Content-Type", "application/octet-stream")
        .send(JPEG)
        .expect(409);
      await request(app).post("/api/v1/driver/document-renewal/submit").set(auth()).expect(409);
      expect(prismaMock.driverVerification.updateMany).not.toHaveBeenCalled();
    });
  });
});
