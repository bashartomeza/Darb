import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  checkpointPosition: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { createAdminCheckpointPositionsRouter } = await import("../modules/adminCheckpointPositions.js");
const { errorHandler } = await import("../middleware/error.js");

const users: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  admin_1: { id: "admin_1", role: "admin", name: "Admin", phone: "+7", demo_account: false },
  driver_1: { id: "driver_1", role: "driver", name: "Driver", phone: "+3", demo_account: false }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const stamp = new Date("2026-11-04T09:00:00.000Z");
const huwwara = {
  id: "pos_1",
  city_ar: "نابلس",
  name_ar: "حوارة",
  latitude: "32.153000",
  longitude: "35.256000",
  confidence: "medium",
  source: "corrected polygon centroid",
  dataset_name: null,
  note: null,
  created_at: stamp,
  updated_at: stamp
};

const newPosition = {
  city_ar: "رام الله",
  name_ar: "عطارة",
  latitude: 31.99,
  longitude: 35.19,
  confidence: "high",
  source: "user screenshot"
};

describe("admin checkpoint positions", () => {
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
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.checkpointPosition.findMany.mockResolvedValue([huwwara]);
    prismaMock.checkpointPosition.count.mockResolvedValue(1);
    prismaMock.checkpointPosition.findUnique.mockResolvedValue(huwwara);
    prismaMock.checkpointPosition.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "pos_2", dataset_name: null, note: null, created_at: stamp, updated_at: stamp, ...data }));
    prismaMock.checkpointPosition.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...huwwara, ...data }));
    prismaMock.checkpointPosition.delete.mockResolvedValue(huwwara);
  });

  it("lists positions with numbers for coordinates, paged and searchable", async () => {
    const response = await request(createApp())
      .get("/api/v1/admin/checkpoint-positions?search=%D8%AD%D9%88&page=2&limit=10")
      .set(auth("admin_1"))
      .expect(200);
    expect(response.body.positions[0]).toMatchObject({ id: "pos_1", latitude: 32.153, longitude: 35.256, confidence: "medium" });
    expect(response.body).toMatchObject({ page: 2, limit: 10, total: 1 });
    const query = prismaMock.checkpointPosition.findMany.mock.calls[0][0];
    expect(query.skip).toBe(10);
    expect(query.take).toBe(10);
    expect(query.where).toEqual({ OR: [{ name_ar: { contains: "حو" } }, { city_ar: { contains: "حو" } }] });
  });

  it("creates a position inside the West Bank and records an audit event", async () => {
    const response = await request(createApp()).post("/api/v1/admin/checkpoint-positions").set(auth("admin_1")).send(newPosition).expect(201);
    expect(response.body.position).toMatchObject({ id: "pos_2", city_ar: "رام الله", name_ar: "عطارة", latitude: 31.99, confidence: "high" });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: "admin_1",
        entity_type: "CheckpointPosition",
        entity_id: "pos_2",
        metadata: expect.objectContaining({ action: "checkpoint_position_created" })
      })
    });
  });

  it("refuses coordinates outside the West Bank and incomplete bodies", async () => {
    for (const body of [
      { ...newPosition, latitude: 31.5, longitude: 34.45 }, // Gaza
      { ...newPosition, latitude: 35.19, longitude: 31.99 }, // swapped
      { ...newPosition, latitude: 32.8 },
      { ...newPosition, confidence: "certain" },
      { ...newPosition, source: "" },
      { ...newPosition, extra: true },
      { city_ar: "رام الله", name_ar: "عطارة" }
    ]) {
      await request(createApp()).post("/api/v1/admin/checkpoint-positions").set(auth("admin_1")).send(body).expect(400);
    }
    expect(prismaMock.checkpointPosition.create).not.toHaveBeenCalled();
  });

  it("refuses a second position for the same city and name, whatever the spelling", async () => {
    const response = await request(createApp())
      .post("/api/v1/admin/checkpoint-positions")
      .set(auth("admin_1"))
      .send({ ...newPosition, city_ar: "نابلس", name_ar: "  حواره " })
      .expect(409);
    expect(response.body.error).toBe("checkpoint_position_exists");
    expect(prismaMock.checkpointPosition.create).not.toHaveBeenCalled();
  });

  it("updates coordinates, confidence and note, and audits before and after", async () => {
    const response = await request(createApp())
      .patch("/api/v1/admin/checkpoint-positions/pos_1")
      .set(auth("admin_1"))
      .send({ latitude: 32.16, longitude: 35.26, confidence: "high", note: "  checked on site " })
      .expect(200);
    expect(prismaMock.checkpointPosition.update).toHaveBeenCalledWith({
      where: { id: "pos_1" },
      data: { latitude: 32.16, longitude: 35.26, confidence: "high", note: "checked on site" }
    });
    expect(response.body.position).toMatchObject({ latitude: 32.16, confidence: "high", note: "checked on site" });
    const metadata = prismaMock.auditEvent.create.mock.calls[0][0].data.metadata;
    expect(metadata).toMatchObject({ action: "checkpoint_position_updated", before: { latitude: 32.153, confidence: "medium" } });
  });

  it("clears a note and refuses empty, unknown or out-of-area updates", async () => {
    await request(createApp()).patch("/api/v1/admin/checkpoint-positions/pos_1").set(auth("admin_1")).send({ note: null }).expect(200);
    expect(prismaMock.checkpointPosition.update.mock.calls[0][0].data).toEqual({ note: null });
    for (const body of [{}, { name_ar: "x" }, { latitude: 30 }, { confidence: "certain" }]) {
      await request(createApp()).patch("/api/v1/admin/checkpoint-positions/pos_1").set(auth("admin_1")).send(body).expect(400);
    }
    prismaMock.checkpointPosition.findUnique.mockResolvedValue(null);
    await request(createApp()).patch("/api/v1/admin/checkpoint-positions/missing").set(auth("admin_1")).send({ confidence: "low" }).expect(404);
  });

  it("deletes a position with an audit event", async () => {
    await request(createApp()).delete("/api/v1/admin/checkpoint-positions/pos_1").set(auth("admin_1")).expect(200, { deleted: true });
    expect(prismaMock.checkpointPosition.delete).toHaveBeenCalledWith({ where: { id: "pos_1" } });
    expect(prismaMock.auditEvent.create.mock.calls[0][0].data.metadata).toMatchObject({ action: "checkpoint_position_deleted", name_ar: "حوارة" });

    prismaMock.checkpointPosition.findUnique.mockResolvedValue(null);
    await request(createApp()).delete("/api/v1/admin/checkpoint-positions/missing").set(auth("admin_1")).expect(404);
  });

  it("is for admins only", async () => {
    await request(createApp()).get("/api/v1/admin/checkpoint-positions").set(auth("driver_1")).expect(403);
    await request(createApp()).post("/api/v1/admin/checkpoint-positions").send(newPosition).expect(401);
  });

  describe("unplaced partner checkpoints", () => {
    function appWith(partnerMap?: { list: () => Promise<unknown> }) {
      const app = express();
      app.use(express.json());
      app.use("/api/v1", createAdminCheckpointPositionsRouter(partnerMap as never));
      app.use(errorHandler);
      return app;
    }

    it("says the list is unavailable when the partner map is off", async () => {
      const response = await request(createApp()).get("/api/v1/admin/checkpoint-positions/unplaced").set(auth("admin_1")).expect(200);
      expect(response.body).toEqual({ available: false, unplaced: [] });
    });

    it("lists the partner checkpoints that have no position", async () => {
      const partnerMap = {
        list: vi.fn().mockResolvedValue({
          fetched_at: "2026-11-04T08:00:00.000Z",
          checkpoints: [],
          unplaced: [{ id: "aweenrayeh:p2", name_ar: "غير موجود", city: "نابلس", reason: "no_name_match", status: "open" }]
        })
      };
      const response = await request(appWith(partnerMap)).get("/api/v1/admin/checkpoint-positions/unplaced").set(auth("admin_1")).expect(200);
      expect(response.body).toEqual({
        available: true,
        fetched_at: "2026-11-04T08:00:00.000Z",
        unplaced: [{ id: "aweenrayeh:p2", city_ar: "نابلس", name_ar: "غير موجود", reason: "no_name_match" }]
      });
    });

    it("treats a partner failure as unavailable rather than an error", async () => {
      const partnerMap = { list: vi.fn().mockRejectedValue(new Error("provider_budget")) };
      const response = await request(appWith(partnerMap)).get("/api/v1/admin/checkpoint-positions/unplaced").set(auth("admin_1")).expect(200);
      expect(response.body).toEqual({ available: false, unplaced: [] });
    });
  });
});
