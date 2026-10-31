import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  driverVerification: { findUnique: vi.fn(), update: vi.fn() },
  driverVerificationDocument: { findMany: vi.fn(), count: vi.fn(), delete: vi.fn() },
  merchantApplicationDocument: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
  auditEvent: { create: vi.fn() },
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
vi.mock("../lib/prisma.js", () => ({ prisma: db }));

const { createApp } = await import("../app.js");

const context = (role: string, status = "pending") => ({
  sessionId: "s1",
  attemptId: "a1",
  userId: "applicant_1",
  purpose: "pending_status",
  attemptStatus: "completed",
  userRole: role,
  userStatus: status
});

describe("submitting an application for review", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;
  let userRow: Record<string, unknown>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "masari-submit-"));
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

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    userRow = { role: "merchant", account_status: "pending", review_submitted_at: null };
    onboardingContext.current = context("merchant");
    db.$transaction.mockImplementation(async (callback: (client: typeof db) => unknown) => callback(db));
    db.user.findUnique.mockImplementation(async () => userRow);
    db.driverVerification.findUnique.mockResolvedValue({ id: "v1", status: "pending", revision: 1 });
    db.driverVerificationDocument.findMany.mockResolvedValue([]);
    db.merchantApplicationDocument.findMany.mockResolvedValue([]);
  });

  const submit = () => request(app).post("/api/v1/onboarding/application/submit");

  it("refuses a shop owner with missing documents and names what is missing", async () => {
    db.merchantApplicationDocument.findMany.mockResolvedValue([{ kind: "national_id" }, { kind: "other" }]);
    const response = await submit().expect(409);
    expect(response.body).toMatchObject({
      error: "documents_required",
      missing_documents: ["commercial_register", "shop_photo"]
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("submits a shop owner once commercial register, national ID and shop photo are on file", async () => {
    db.merchantApplicationDocument.findMany.mockResolvedValue([
      { kind: "commercial_register" },
      { kind: "national_id" },
      { kind: "shop_photo" }
    ]);
    const response = await submit().expect(200);
    expect(response.body).toMatchObject({ onboarding_status: "pending_review", next_action: "await_approval" });
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "applicant_1" }, data: { review_submitted_at: expect.any(Date) } })
    );
  });

  it("refuses a driver without licence, vehicle registration and national ID", async () => {
    userRow = { role: "driver", account_status: "pending", review_submitted_at: null };
    onboardingContext.current = context("driver");
    db.driverVerificationDocument.findMany.mockResolvedValue([{ kind: "driver_licence" }, { kind: "insurance" }]);
    const response = await submit().expect(409);
    expect(response.body.missing_documents).toEqual(["vehicle_registration", "national_id"]);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("submits a driver with all three required documents and stamps the verification", async () => {
    userRow = { role: "driver", account_status: "pending", review_submitted_at: null };
    onboardingContext.current = context("driver");
    db.driverVerificationDocument.findMany.mockResolvedValue([
      { kind: "driver_licence" },
      { kind: "vehicle_registration" },
      { kind: "national_id" }
    ]);
    await submit().expect(200);
    expect(db.driverVerification.update).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: "applicant_1" } }));
  });

  it("is idempotent once the application is already submitted", async () => {
    const at = new Date("2026-10-28T10:00:00Z");
    userRow = { role: "merchant", account_status: "pending", review_submitted_at: at };
    const response = await submit().expect(200);
    expect(response.body.submitted_at).toBe(at.toISOString());
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects an account that is not a pending driver or shop owner", async () => {
    onboardingContext.current = context("merchant", "active");
    await submit().expect(403);
    onboardingContext.current = context("passenger");
    await submit().expect(403);
  });

  it("will not let a submitted shop owner delete the last file of a required kind", async () => {
    userRow = { role: "merchant", account_status: "pending", review_submitted_at: new Date() };
    db.merchantApplicationDocument.findFirst.mockResolvedValue({ id: "doc_1", kind: "shop_photo", storage_key: "a".repeat(48) });
    db.merchantApplicationDocument.count.mockResolvedValue(0);
    const response = await request(app).delete("/api/v1/onboarding/merchant-documents/doc_1").expect(409);
    expect(response.body.error).toBe("documents_required");
    expect(db.merchantApplicationDocument.delete).not.toHaveBeenCalled();
  });

  it("still lets a submitted shop owner replace a document that has a twin", async () => {
    userRow = { role: "merchant", account_status: "pending", review_submitted_at: new Date() };
    db.merchantApplicationDocument.findFirst.mockResolvedValue({ id: "doc_1", kind: "shop_photo", storage_key: "a".repeat(48) });
    db.merchantApplicationDocument.count.mockResolvedValue(1);
    await request(app).delete("/api/v1/onboarding/merchant-documents/doc_1").expect(200);
    expect(db.merchantApplicationDocument.delete).toHaveBeenCalled();
  });
});
