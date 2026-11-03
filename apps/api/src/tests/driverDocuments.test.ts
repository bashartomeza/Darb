import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

const tx = vi.hoisted(() => ({
  driverVerification: { findUnique: vi.fn() },
  driverVerificationDocument: { count: vi.fn(), create: vi.fn(), delete: vi.fn() },
  documentFile: { create: vi.fn() },
  auditEvent: { create: vi.fn() }
}));

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  driverVerification: { findUnique: vi.fn() },
  driverVerificationDocument: { findMany: vi.fn(), findFirst: vi.fn() },
  documentFile: { findUnique: vi.fn() },
  $transaction: vi.fn()
}));

/** Stand-in for the `document_files` table, keyed by the owning document row. */
const storedFiles = vi.hoisted(() => new Map<string, Record<string, unknown>>());

// The applicant session itself is covered by the onboarding tests; here we only
// need to decide who the caller is.
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
const { storageUnderTest } = await import("../services/driverDocumentStorage.js").then((module) => ({ storageUnderTest: module }));

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake jpeg body")]);
const PDF = Buffer.from("%PDF-1.7 fake");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const admin = { id: "admin_1", role: "admin", name: "A", phone: "+7", demo_account: true };
function adminAuth() {
  const token = jwt.sign({ role: "admin", sid: "session_admin_1", ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: "admin_1",
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const pendingVerification = { id: "ver_1", user_id: "drv_user", status: "pending", revision: 2 };
const driverContext = { sessionId: "s1", attemptId: "a1", userId: "drv_user", purpose: "pending_status", attemptStatus: "completed", userRole: "driver", userStatus: "pending" };

describe("driver documents", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;
  let disabledApp: ReturnType<typeof createApp>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "darb-docs-"));
    const env = {
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
    for (const name of await readdir(dir)) await rm(join(dir, name), { force: true });
    onboardingContext.current = { ...driverContext };
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    prismaMock.driverVerification.findUnique.mockResolvedValue(pendingVerification);
    tx.driverVerification.findUnique.mockResolvedValue(pendingVerification);
    tx.driverVerificationDocument.count.mockResolvedValue(0);
    tx.driverVerificationDocument.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "doc_1",
      created_at: new Date(),
      ...data
    }));
    storedFiles.clear();
    tx.documentFile.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      storedFiles.set(String(data.driver_document_id), data);
      return data;
    });
    prismaMock.documentFile.findUnique.mockImplementation(
      async ({ where }: { where: { driver_document_id: string } }) => storedFiles.get(where.driver_document_id) ?? null
    );
    prismaMock.user.findUnique.mockResolvedValue({ ...admin, account_status: "active", security_version: 1 });
    prismaMock.authSession.findUnique.mockResolvedValue({
      id: "session_admin_1",
      user_id: "admin_1",
      user: { email_verified_at: new Date(), ...admin, account_status: "active", security_version: 1 },
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null
    });
  });

  const upload = (body: Buffer | string, kind = "driver_licence", type = "application/octet-stream") =>
    request(app).post(`/api/v1/onboarding/driver-documents?kind=${kind}`).set("Content-Type", type).send(body);

  it("is unavailable until storage is configured", async () => {
    await request(disabledApp).get("/api/v1/onboarding/driver-documents").expect(404);
  });

  it("stores a document in the database by its real type, not the declared one", async () => {
    const response = await upload(JPEG, "driver_licence", "application/pdf").expect(201);

    expect(response.body.document).toMatchObject({ id: "doc_1", kind: "driver_licence", mime_type: "image/jpeg", size_bytes: JPEG.length });
    const data = tx.driverVerificationDocument.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ verification_id: "ver_1", revision: 2, mime_type: "image/jpeg", sha256: sha256(JPEG) });
    expect(data.storage_key).toMatch(/^[a-f0-9]{48}$/);
    // The bytes go into document_files inside the same transaction as the row, never to disk.
    const file = storedFiles.get("doc_1")!;
    expect(file).toMatchObject({ driver_document_id: "doc_1", content_type: "image/jpeg", size_bytes: JPEG.length, sha256: sha256(JPEG) });
    expect(Buffer.from(file.bytes as Uint8Array)).toEqual(JPEG);
    expect(file).not.toHaveProperty("merchant_document_id");
    expect(await readdir(dir)).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(data.storage_key);
  });

  it("rejects unknown content, empty bodies and unknown kinds without writing anything", async () => {
    await upload("<html><script>alert(1)</script></html>").expect(415);
    await upload(Buffer.alloc(0)).expect(400);
    await upload(JPEG, "passport_number").expect(400);
    expect(await readdir(dir)).toEqual([]);
    expect(tx.driverVerificationDocument.create).not.toHaveBeenCalled();
  });

  it("only serves a pending driver's own application", async () => {
    onboardingContext.current = { ...driverContext, userStatus: "active" };
    await upload(JPEG).expect(403);
    onboardingContext.current = { ...driverContext, userRole: "merchant" };
    await upload(JPEG).expect(403);
    onboardingContext.current = null;
    await upload(JPEG).expect(401);

    onboardingContext.current = { ...driverContext };
    prismaMock.driverVerification.findUnique.mockResolvedValue({ ...pendingVerification, status: "rejected" });
    await upload(JPEG).expect(409);
    expect(await readdir(dir)).toEqual([]);
  });

  it("stores no bytes when the revision changed or the cap was reached", async () => {
    tx.driverVerification.findUnique.mockResolvedValue({ ...pendingVerification, revision: 3 });
    await upload(PDF).expect(409);
    expect(await readdir(dir)).toEqual([]);

    tx.driverVerification.findUnique.mockResolvedValue(pendingVerification);
    tx.driverVerificationDocument.count.mockResolvedValue(storageUnderTest.MAX_DOCUMENTS_PER_REVISION);
    await upload(PDF).expect(409);
    expect(await readdir(dir)).toEqual([]);
    expect(tx.documentFile.create).not.toHaveBeenCalled();
  });

  it("refuses bodies over the size limit", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(storageUnderTest.MAX_DOCUMENT_BYTES)]);
    await upload(big).expect(413);
    expect(await readdir(dir)).toEqual([]);
    expect(tx.documentFile.create).not.toHaveBeenCalled();
  });

  it("lets the applicant delete their own document, its bytes and any older disk copy", async () => {
    await upload(JPEG).expect(201);
    const key = tx.driverVerificationDocument.create.mock.calls[0][0].data.storage_key;
    prismaMock.driverVerificationDocument.findFirst.mockResolvedValue({ id: "doc_1", kind: "driver_licence", storage_key: key });
    // A copy left on disk from before the bytes moved into the database.
    await writeFile(join(dir, key), JPEG);

    await request(app).delete("/api/v1/onboarding/driver-documents/doc_1").expect(200);

    expect(prismaMock.driverVerificationDocument.findFirst.mock.calls[0][0].where).toEqual({ id: "doc_1", verification_id: "ver_1", revision: 2 });
    // Deleting the row removes its document_files row by ON DELETE CASCADE.
    expect(tx.driverVerificationDocument.delete).toHaveBeenCalledWith({ where: { id: "doc_1" } });
    expect(await readdir(dir)).toEqual([]);

    prismaMock.driverVerificationDocument.findFirst.mockResolvedValue(null);
    await request(app).delete("/api/v1/onboarding/driver-documents/other").expect(404);
  });

  it("lets only an Admin download, as a non-renderable attachment, and audits the view", async () => {
    await upload(PDF).expect(201);
    const key = tx.driverVerificationDocument.create.mock.calls[0][0].data.storage_key;
    prismaMock.driverVerificationDocument.findFirst.mockResolvedValue({
      id: "doc_1", verification_id: "ver_1", kind: "driver_licence", mime_type: "application/pdf", storage_key: key, sha256: sha256(PDF)
    });

    await request(app).get("/api/v1/admin/driver-verifications/drv_user/documents/doc_1").expect(401);

    const response = await request(app).get("/api/v1/admin/driver-verifications/drv_user/documents/doc_1").set(adminAuth()).expect(200);
    expect(response.headers["content-disposition"]).toBe('attachment; filename="doc_1.pdf"');
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-length"]).toBe(String(PDF.length));
    expect(Buffer.from(response.body)).toEqual(PDF);
    expect(prismaMock.documentFile.findUnique.mock.calls[0][0].where).toEqual({ driver_document_id: "doc_1" });
    expect(prismaMock.driverVerificationDocument.findFirst.mock.calls[0][0].where).toEqual({ id: "doc_1", verification: { user_id: "drv_user" } });
    expect(prismaMock.auditEvent.create.mock.calls.at(-1)?.[0].data.metadata).toMatchObject({ action: "driver_document_viewed", document_id: "doc_1" });
  });

  it("still serves a document uploaded before the move from the old directory", async () => {
    const key = "c".repeat(48);
    await writeFile(join(dir, key), PDF);
    prismaMock.driverVerificationDocument.findFirst.mockResolvedValue({
      id: "doc_old", verification_id: "ver_1", kind: "driver_licence", mime_type: "application/pdf", storage_key: key, sha256: sha256(PDF)
    });

    const response = await request(app).get("/api/v1/admin/driver-verifications/drv_user/documents/doc_old").set(adminAuth()).expect(200);
    expect(Buffer.from(response.body)).toEqual(PDF);
    expect(response.headers["content-disposition"]).toBe('attachment; filename="doc_old.pdf"');
  });

  it("refuses bytes that no longer match their digest and answers 404 when there are none", async () => {
    storedFiles.set("doc_1", { bytes: new Uint8Array(PDF) });
    prismaMock.driverVerificationDocument.findFirst.mockResolvedValue({
      id: "doc_1", verification_id: "ver_1", kind: "driver_licence", mime_type: "application/pdf", storage_key: "d".repeat(48), sha256: sha256(JPEG)
    });
    await request(app).get("/api/v1/admin/driver-verifications/drv_user/documents/doc_1").set(adminAuth()).expect(500);

    storedFiles.clear();
    await request(app).get("/api/v1/admin/driver-verifications/drv_user/documents/doc_1").set(adminAuth()).expect(404);
    expect(prismaMock.auditEvent.create.mock.calls.map(([call]) => call.data.metadata?.action)).not.toContain("driver_document_viewed");
  });
});

describe("driver document storage", () => {
  it("recognises only JPEG, PNG and PDF by their leading bytes", async () => {
    const { sniffDocumentMime } = await import("../services/driverDocumentStorage.js");
    expect(sniffDocumentMime(JPEG)).toBe("image/jpeg");
    expect(sniffDocumentMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffDocumentMime(PDF)).toBe("application/pdf");
    expect(sniffDocumentMime(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffDocumentMime(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });

  it("refuses keys that could escape the old storage directory", async () => {
    const { createDocumentStorage, legacyDocumentPath } = await import("../services/driverDocumentStorage.js");
    const db = { documentFile: { findUnique: vi.fn().mockResolvedValue(null) } };
    const storage = createDocumentStorage(db as never, { legacyDir: tmpdir() });
    expect(() => legacyDocumentPath(tmpdir(), "../secret")).toThrow("invalid_storage_key");
    await expect(storage.read({ driverDocumentId: "d1" }, { storage_key: "../secret", sha256: "0".repeat(64) })).rejects.toThrow("invalid_storage_key");
    await expect(storage.removeLegacyCopy("../secret")).rejects.toThrow("invalid_storage_key");
  });

  it("keeps everything in the database when no old directory is configured", async () => {
    const { createDocumentStorage } = await import("../services/driverDocumentStorage.js");
    const rows: Record<string, unknown>[] = [];
    const db = {
      documentFile: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => void rows.push(data)),
        findUnique: vi.fn(async ({ where }: { where: { merchant_document_id?: string } }) =>
          rows.find((row) => row.merchant_document_id === where.merchant_document_id) ?? null
        )
      }
    };
    const storage = createDocumentStorage(db as never);
    const saved = storage.prepare(JPEG);
    expect(saved.sha256).toBe(sha256(JPEG));
    await storage.save(db as never, { merchantDocumentId: "m1" }, { bytes: JPEG, contentType: "image/jpeg", sha256: saved.sha256 });
    expect(rows[0]).toMatchObject({ merchant_document_id: "m1", content_type: "image/jpeg", size_bytes: JPEG.length, sha256: saved.sha256 });
    expect(rows[0]).not.toHaveProperty("driver_document_id");

    expect(await storage.read({ merchantDocumentId: "m1" }, { storage_key: saved.key, sha256: saved.sha256 })).toEqual(JPEG);
    await expect(storage.read({ merchantDocumentId: "m2" }, { storage_key: saved.key, sha256: saved.sha256 })).rejects.toThrow("document_file_missing");
    await expect(storage.removeLegacyCopy(saved.key)).resolves.toBeUndefined();
  });
});

describe("driver document retention", () => {
  it("purges only documents of decided applications past the window, row and bytes in one transaction", async () => {
    const { purgeDecidedDriverDocuments } = await import("../services/driverDocumentRetention.js");
    const removed: string[] = [];
    const steps: string[] = [];
    const db = {
      driverVerificationDocument: {
        findMany: vi.fn().mockResolvedValue([{ id: "d1", verification_id: "v1", kind: "national_id", storage_key: "a".repeat(48) }]),
        delete: vi.fn(async () => void steps.push("delete d1"))
      },
      merchantApplicationDocument: {
        findMany: vi.fn().mockResolvedValue([{ id: "m1", user_id: "u1", kind: "shop_photo", storage_key: "b".repeat(48) }]),
        delete: vi.fn(async () => void steps.push("delete m1"))
      },
      auditEvent: { create: vi.fn() },
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(db))
    };
    const now = new Date("2026-12-01T00:00:00Z");

    const storage = {
      removeLegacyCopy: async (key: string) => {
        removed.push(key);
        steps.push(`legacy ${key[0]}`);
      }
    };
    const result = await purgeDecidedDriverDocuments(db as never, storage, { retentionDays: 90, now });

    expect(result).toEqual({ purged: 2 });
    expect(removed).toEqual(["a".repeat(48), "b".repeat(48)]);
    // The row (and with it the document_files bytes) goes first, in a transaction with its audit event.
    expect(steps).toEqual(["delete d1", "legacy a", "delete m1", "legacy b"]);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.auditEvent.create).toHaveBeenCalledTimes(2);
    expect(db.merchantApplicationDocument.findMany.mock.calls[0][0].where).toEqual({
      user: { account_status: { not: "pending" }, status_updated_at: { lt: new Date("2026-09-02T00:00:00Z") } }
    });
    expect(db.merchantApplicationDocument.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(db.driverVerificationDocument.findMany.mock.calls[0][0].where).toEqual({
      verification: { status: { in: ["approved", "rejected"] }, reviewed_at: { lt: new Date("2026-09-02T00:00:00Z") } }
    });
    expect(db.driverVerificationDocument.delete).toHaveBeenCalledWith({ where: { id: "d1" } });
  });
});
