import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  notification: { create: vi.fn() },
  trip: { findUnique: vi.fn() },
  incident: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn()
  }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

const users: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  admin_1: { id: "admin_1", role: "admin", name: "A", phone: "+7", demo_account: true },
  passenger_1: { id: "passenger_1", role: "passenger", name: "P", phone: "+1", demo_account: true },
  driver_1: { id: "driver_1", role: "driver", name: "D", phone: "+3", demo_account: true }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "inc_1",
  reporter_id: "passenger_1",
  trip_id: null,
  category: "delay",
  description: "The driver was 30 minutes late",
  status: "open",
  admin_note: null,
  revision: 1,
  reviewed_by_id: null,
  reviewed_at: null,
  resolved_at: null,
  created_at: new Date("2026-10-25T10:00:00Z"),
  reporter: { id: "passenger_1", name: "P", role: "passenger" },
  ...overrides
});

describe("incidents API", () => {
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
    prismaMock.incident.count.mockResolvedValue(0);
  });

  const body = { category: "delay", description: "The driver was 30 minutes late" };

  it("keeps filing to rider roles and triage to admins", async () => {
    await request(createApp()).post("/api/v1/incidents").send(body).expect(401);
    await request(createApp()).post("/api/v1/incidents").set(auth("admin_1")).send(body).expect(403);
    await request(createApp()).get("/api/v1/admin/incidents").set(auth("passenger_1")).expect(403);
    await request(createApp()).patch("/api/v1/admin/incidents/inc_1").set(auth("driver_1")).send({}).expect(403);
  });

  it("files a report for the caller and hides admin-only fields", async () => {
    prismaMock.incident.create.mockResolvedValue(row({ admin_note: "internal" }));

    const response = await request(createApp()).post("/api/v1/incidents").set(auth("passenger_1")).send(body).expect(201);

    expect(prismaMock.incident.create.mock.calls[0][0].data).toMatchObject({ reporter_id: "passenger_1", category: "delay" });
    expect(response.body.incident.admin_note).toBeNull();
    expect(response.body.incident).not.toHaveProperty("reporter");
  });

  it("validates category and description", async () => {
    await request(createApp()).post("/api/v1/incidents").set(auth("passenger_1")).send({ ...body, category: "fire" }).expect(400);
    await request(createApp()).post("/api/v1/incidents").set(auth("passenger_1")).send({ ...body, description: "hi" }).expect(400);
    await request(createApp())
      .post("/api/v1/incidents")
      .set(auth("passenger_1"))
      .send({ ...body, description: "x".repeat(1001) })
      .expect(400);
    expect(prismaMock.incident.create).not.toHaveBeenCalled();
  });

  it("caps unresolved reports per user", async () => {
    prismaMock.incident.count.mockResolvedValue(10);
    await request(createApp()).post("/api/v1/incidents").set(auth("passenger_1")).send(body).expect(429);
    expect(prismaMock.incident.create).not.toHaveBeenCalled();
  });

  it("only lets a participant attach a trip, answering the same as for a missing trip", async () => {
    prismaMock.trip.findUnique.mockResolvedValue({
      driver_route: { driver: { user_id: "someone_else" } },
      passenger_request: { passenger_id: "someone_else" },
      merchant_order: null
    });
    await request(createApp())
      .post("/api/v1/incidents")
      .set(auth("passenger_1"))
      .send({ ...body, trip_id: "trip_9" })
      .expect(404);

    prismaMock.trip.findUnique.mockResolvedValue({
      driver_route: { driver: { user_id: "someone_else" } },
      passenger_request: { passenger_id: "passenger_1" },
      merchant_order: null
    });
    prismaMock.incident.create.mockResolvedValue(row({ trip_id: "trip_9" }));
    await request(createApp())
      .post("/api/v1/incidents")
      .set(auth("passenger_1"))
      .send({ ...body, trip_id: "trip_9" })
      .expect(201);
  });

  it("lists only the caller's own reports", async () => {
    prismaMock.incident.findMany.mockResolvedValue([row()]);
    await request(createApp()).get("/api/v1/incidents").set(auth("passenger_1")).expect(200);
    expect(prismaMock.incident.findMany.mock.calls[0][0].where).toEqual({ reporter_id: "passenger_1" });
  });

  it("gives admins the queue with reporter and open total", async () => {
    prismaMock.incident.findMany.mockResolvedValue([row({ admin_note: "seen" })]);
    prismaMock.incident.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const response = await request(createApp()).get("/api/v1/admin/incidents?status=open").set(auth("admin_1")).expect(200);

    expect(response.body.incidents[0]).toMatchObject({ admin_note: "seen", reporter: { id: "passenger_1", role: "passenger" } });
    expect(response.body.open_total).toBe(1);
    expect(prismaMock.incident.findMany.mock.calls[0][0].where).toEqual({ status: "open" });
  });

  describe("triage", () => {

    function triage(payload: Record<string, unknown>) {
      return request(createApp()).patch("/api/v1/admin/incidents/inc_1").set(auth("admin_1")).send(payload);
    }

    it("moves a report forward, stamps the reviewer and tells the reporter", async () => {
      prismaMock.incident.findUnique.mockResolvedValue(row());
      prismaMock.incident.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.incident.findUniqueOrThrow.mockResolvedValue(row({ status: "reviewing", revision: 2, admin_note: "Calling the driver" }));
      prismaMock.notification.create.mockResolvedValue({});

      const response = await triage({ status: "reviewing", expected_revision: 1, note: "Calling the driver" }).expect(200);

      expect(response.body.incident.status).toBe("reviewing");
      const update = prismaMock.incident.updateMany.mock.calls[0][0];
      expect(update.where).toEqual({ id: "inc_1", revision: 1, status: "open" });
      expect(update.data).toMatchObject({ status: "reviewing", reviewed_by_id: "admin_1", admin_note: "Calling the driver" });
      expect(prismaMock.notification.create.mock.calls[0][0].data).toMatchObject({
        user_id: "passenger_1",
        type: "incident_updated",
        dedupe_key: "incident_updated:inc_1:2",
        params: { status: "reviewing" }
      });
    });

    it("rejects a stale revision, a backwards move and reopening", async () => {
      prismaMock.incident.findUnique.mockResolvedValue(row({ revision: 3 }));
      await triage({ status: "reviewing", expected_revision: 1 }).expect(409);

      prismaMock.incident.findUnique.mockResolvedValue(row({ status: "resolved", revision: 1 }));
      await triage({ status: "reviewing", expected_revision: 1 }).expect(409);

      await triage({ status: "open", expected_revision: 1 }).expect(400);
      expect(prismaMock.incident.updateMany).not.toHaveBeenCalled();
    });

    it("reports a lost race as a conflict", async () => {
      prismaMock.incident.findUnique.mockResolvedValue(row());
      prismaMock.incident.updateMany.mockResolvedValue({ count: 0 });
      await triage({ status: "resolved", expected_revision: 1 }).expect(409);
    });

    it("404s for an unknown report", async () => {
      prismaMock.incident.findUnique.mockResolvedValue(null);
      await triage({ status: "resolved", expected_revision: 1 }).expect(404);
    });
  });
});
