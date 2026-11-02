import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  uncertainAiRequest: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn()
  }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { redactAssistantText, UNCERTAIN_AI_RETENTION_DAYS } = await import("../services/uncertainAiRequests.js");

const users: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  admin_1: { id: "admin_1", role: "admin", name: "A", phone: "+7", demo_account: true },
  passenger_1: { id: "passenger_1", role: "passenger", name: "P", phone: "+1", demo_account: true }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "unc_1",
  locale: "ar",
  text: "شو في بكرا",
  intent_type: "unknown",
  confidence: "0.20",
  source: "rules",
  reason: "not_understood",
  pickup_key: null,
  dropoff_key: null,
  status: "open",
  resolution_note: null,
  resolved_by_id: null,
  resolved_at: null,
  revision: 1,
  created_at: new Date("2026-10-28T10:00:00Z"),
  expires_at: new Date("2026-11-27T10:00:00Z"),
  ...overrides
});

describe("admin uncertain AI requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      const user = where.id ? users[where.id] : undefined;
      return user ? { ...user, account_status: "active", security_version: 1 } : null;
    });
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = users[where.id.replace(/^session_/, "")];
      return user
        ? {
            id: where.id,
            user_id: user.id,
            user: { email_verified_at: new Date(), ...user, account_status: "active", security_version: 1 },
            security_version_at_issue: 1,
            expires_at: new Date(Date.now() + 60_000),
            revoked_at: null
          }
        : null;
    });
    prismaMock.uncertainAiRequest.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("is admin-only", async () => {
    await request(createApp()).get("/api/v1/admin/ai-uncertain-requests").expect(401);
    await request(createApp()).get("/api/v1/admin/ai-uncertain-requests").set(auth("passenger_1")).expect(403);
    await request(createApp()).patch("/api/v1/admin/ai-uncertain-requests/unc_1").set(auth("passenger_1")).send({}).expect(403);
  });

  it("lists the queue with counts, purging expired rows first, and exposes no user reference", async () => {
    prismaMock.uncertainAiRequest.findMany.mockResolvedValue([row()]);
    prismaMock.uncertainAiRequest.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const response = await request(createApp())
      .get("/api/v1/admin/ai-uncertain-requests?status=open")
      .set(auth("admin_1"))
      .expect(200);

    expect(prismaMock.uncertainAiRequest.deleteMany).toHaveBeenCalledWith({ where: { expires_at: { lte: expect.any(Date) } } });
    expect(prismaMock.uncertainAiRequest.findMany.mock.calls[0][0].where).toEqual({ status: "open" });
    expect(response.body).toMatchObject({ total: 1, open_total: 1, page: 1 });
    expect(response.body.requests[0]).toMatchObject({ id: "unc_1", confidence: 0.2, reason: "not_understood" });
    expect(response.body.requests[0]).not.toHaveProperty("resolved_by_id");
    expect(response.body.requests[0]).not.toHaveProperty("passenger_id");
  });

  it("rejects an unknown status filter", async () => {
    await request(createApp()).get("/api/v1/admin/ai-uncertain-requests?status=maybe").set(auth("admin_1")).expect(400);
  });

  it("marks a request resolved once, with optimistic concurrency and an audit event", async () => {
    prismaMock.uncertainAiRequest.findUnique.mockResolvedValue(row());
    prismaMock.uncertainAiRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.uncertainAiRequest.findUniqueOrThrow.mockResolvedValue(row({ status: "resolved", revision: 2, resolution_note: "added alias" }));

    const response = await request(createApp())
      .patch("/api/v1/admin/ai-uncertain-requests/unc_1")
      .set(auth("admin_1"))
      .send({ expected_revision: 1, note: "added alias" })
      .expect(200);

    expect(prismaMock.uncertainAiRequest.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "unc_1", revision: 1, status: "open" },
      data: { status: "resolved", resolved_by_id: "admin_1", resolution_note: "added alias" }
    });
    expect(response.body.request.status).toBe("resolved");
    expect(prismaMock.auditEvent.create.mock.calls[0][0].data).toMatchObject({
      entity_type: "UncertainAiRequest",
      entity_id: "unc_1"
    });
  });

  it("answers 404, and 409 for a stale revision or an already resolved request", async () => {
    prismaMock.uncertainAiRequest.findUnique.mockResolvedValue(null);
    await request(createApp()).patch("/api/v1/admin/ai-uncertain-requests/nope").set(auth("admin_1")).send({ expected_revision: 1 }).expect(404);

    prismaMock.uncertainAiRequest.findUnique.mockResolvedValue(row({ revision: 3 }));
    await request(createApp()).patch("/api/v1/admin/ai-uncertain-requests/unc_1").set(auth("admin_1")).send({ expected_revision: 1 }).expect(409);

    prismaMock.uncertainAiRequest.findUnique.mockResolvedValue(row({ status: "resolved" }));
    await request(createApp()).patch("/api/v1/admin/ai-uncertain-requests/unc_1").set(auth("admin_1")).send({ expected_revision: 1 }).expect(409);

    prismaMock.uncertainAiRequest.findUnique.mockResolvedValue(row());
    prismaMock.uncertainAiRequest.updateMany.mockResolvedValue({ count: 0 });
    await request(createApp()).patch("/api/v1/admin/ai-uncertain-requests/unc_1").set(auth("admin_1")).send({ expected_revision: 1 }).expect(409);
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("uncertain request privacy", () => {
  it("strips contact details, links and long numbers, and truncates", () => {
    expect(redactAssistantText("call +970 59 912 3456 or mail a.b@example.com see https://x.example/y?token=1")).toBe(
      "call [number] or mail [email] see [link]"
    );
    expect(redactAssistantText("a".repeat(1000))).toHaveLength(300);
    expect(redactAssistantText("من الخليل\n\tلبيت لحم")).toBe("من الخليل لبيت لحم");
  });

  it("keeps rows for a bounded number of days", () => {
    expect(UNCERTAIN_AI_RETENTION_DAYS).toBeGreaterThan(0);
    expect(UNCERTAIN_AI_RETENTION_DAYS).toBeLessThanOrEqual(90);
  });
});
