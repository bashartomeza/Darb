import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  trip: { findUnique: vi.fn() },
  communityReport: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn()
  },
  communityReportVote: {
    groupBy: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn()
  },
  communityReportFlag: { upsert: vi.fn(), count: vi.fn(), groupBy: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

const users: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  admin_1: { id: "admin_1", role: "admin", name: "A", phone: "+7", demo_account: true },
  passenger_1: { id: "passenger_1", role: "passenger", name: "P", phone: "+1", demo_account: true },
  passenger_2: { id: "passenger_2", role: "passenger", name: "Q", phone: "+2", demo_account: true },
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
  id: "rep_1",
  author_id: "passenger_1",
  trip_id: null,
  category: "road_closure",
  description: "Road blocked near the junction",
  location_name: "Main junction",
  latitude: "32.221000",
  longitude: "35.262000",
  needs_admin_review: false,
  admin_reviewed_at: null,
  hidden_at: null,
  created_at: new Date("2026-11-01T10:00:00Z"),
  ...overrides
});

describe("community reports API", () => {
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
    prismaMock.communityReport.count.mockResolvedValue(0);
    prismaMock.communityReportVote.groupBy.mockResolvedValue([]);
    prismaMock.communityReportVote.findMany.mockResolvedValue([]);
    prismaMock.communityReportFlag.groupBy.mockResolvedValue([]);
  });

  const body = {
    category: "road_closure",
    description: "Road blocked near the junction",
    location_name: "Main junction",
    latitude: 32.221,
    longitude: 35.262
  };

  it("requires login and an eligible role", async () => {
    await request(createApp()).get("/api/v1/community-reports").expect(401);
    await request(createApp()).post("/api/v1/community-reports").send(body).expect(401);
    await request(createApp()).put("/api/v1/community-reports/rep_1/vote").send({ value: 1 }).expect(401);
    await request(createApp()).get("/api/v1/admin/community-reports").set(auth("passenger_1")).expect(403);
  });

  it("creates a report for passengers and drivers", async () => {
    prismaMock.communityReport.create.mockResolvedValue(row());
    const res = await request(createApp()).post("/api/v1/community-reports").set(auth("passenger_1")).send(body).expect(201);
    expect(prismaMock.communityReport.create.mock.calls[0][0].data).toMatchObject({
      author_id: "passenger_1",
      category: "road_closure",
      needs_admin_review: false
    });
    expect(res.body.report).toMatchObject({ upvotes: 0, downvotes: 0, my_vote: 0, is_mine: true });
    await request(createApp()).post("/api/v1/community-reports").set(auth("driver_1")).send(body).expect(201);
  });

  it("flags incorrect-map reports for admin verification", async () => {
    prismaMock.communityReport.create.mockResolvedValue(row({ category: "incorrect_map_info", needs_admin_review: true }));
    const res = await request(createApp())
      .post("/api/v1/community-reports")
      .set(auth("passenger_1"))
      .send({ ...body, category: "incorrect_map_info" })
      .expect(201);
    expect(prismaMock.communityReport.create.mock.calls[0][0].data.needs_admin_review).toBe(true);
    expect(res.body.report.awaiting_admin_review).toBe(true);
  });

  it("validates input and rate limits creation", async () => {
    const send = (b: object) => request(createApp()).post("/api/v1/community-reports").set(auth("passenger_1")).send(b);
    await send({ ...body, category: "fire" }).expect(400);
    await send({ ...body, description: "hi" }).expect(400);
    await send({ ...body, latitude: 120 }).expect(400);
    await send({ ...body, longitude: undefined }).expect(400);
    // Map categories need a place; a point outside the service area is refused.
    await send({ ...body, latitude: undefined, longitude: undefined }).expect(400);
    await send({ ...body, category: "checkpoint_outdated", latitude: undefined, longitude: undefined }).expect(400);
    await send({ ...body, latitude: 37.39, longitude: -122.08 }).expect(400);
    expect(prismaMock.communityReport.create).not.toHaveBeenCalled();
    prismaMock.communityReport.count.mockResolvedValue(10);
    await send(body).expect(429);
  });

  it("accepts driver and other reports without a location", async () => {
    prismaMock.communityReport.create.mockResolvedValue(row({ category: "other", latitude: null, longitude: null }));
    const send = (b: object) => request(createApp()).post("/api/v1/community-reports").set(auth("passenger_1")).send(b);
    await send({ ...body, category: "other", latitude: undefined, longitude: undefined }).expect(201);
    await send({ ...body, category: "driver_report", latitude: undefined, longitude: undefined }).expect(201);
  });

  it("lists reports with vote counts and the caller's vote, hiding the author", async () => {
    prismaMock.communityReport.findMany.mockResolvedValue([row({ trip_id: "trip_1" })]);
    prismaMock.communityReportVote.groupBy.mockResolvedValue([
      { report_id: "rep_1", value: 1, _count: { _all: 4 } },
      { report_id: "rep_1", value: -1, _count: { _all: 2 } }
    ]);
    prismaMock.communityReportVote.findMany.mockResolvedValue([{ report_id: "rep_1", value: -1 }]);
    const res = await request(createApp()).get("/api/v1/community-reports?sort=top").set(auth("passenger_2")).expect(200);
    const report = res.body.reports[0];
    expect(report).toMatchObject({ upvotes: 4, downvotes: 2, my_vote: -1, is_mine: false, has_trip: true });
    expect(report).not.toHaveProperty("author_id");
    expect(report).not.toHaveProperty("trip_id");
    expect(prismaMock.communityReport.findMany.mock.calls[0][0].where.hidden_at).toBeNull();
  });

  it("records one changeable vote per user and returns fresh counts", async () => {
    prismaMock.communityReport.findUnique.mockResolvedValue(row());
    prismaMock.communityReportVote.groupBy.mockResolvedValue([{ report_id: "rep_1", value: 1, _count: { _all: 1 } }]);
    prismaMock.communityReportVote.findMany.mockResolvedValue([{ report_id: "rep_1", value: 1 }]);
    const res = await request(createApp())
      .put("/api/v1/community-reports/rep_1/vote")
      .set(auth("passenger_2"))
      .send({ value: 1 })
      .expect(200);
    expect(prismaMock.communityReportVote.upsert.mock.calls[0][0]).toMatchObject({
      where: { report_id_user_id: { report_id: "rep_1", user_id: "passenger_2" } },
      create: { value: 1 },
      update: { value: 1 }
    });
    expect(res.body.report).toMatchObject({ upvotes: 1, my_vote: 1 });

    await request(createApp()).put("/api/v1/community-reports/rep_1/vote").set(auth("passenger_2")).send({ value: -1 }).expect(200);
    expect(prismaMock.communityReportVote.upsert.mock.calls[1][0].update).toEqual({ value: -1 });

    await request(createApp()).put("/api/v1/community-reports/rep_1/vote").set(auth("passenger_2")).send({ value: 0 }).expect(200);
    expect(prismaMock.communityReportVote.deleteMany).toHaveBeenCalledOnce();
  });

  it("rejects invalid votes, own-report votes and hidden or missing reports", async () => {
    prismaMock.communityReport.findUnique.mockResolvedValue(row());
    await request(createApp()).put("/api/v1/community-reports/rep_1/vote").set(auth("passenger_2")).send({ value: 5 }).expect(400);
    await request(createApp()).put("/api/v1/community-reports/rep_1/vote").set(auth("passenger_1")).send({ value: 1 }).expect(403);
    prismaMock.communityReport.findUnique.mockResolvedValue(row({ hidden_at: new Date() }));
    await request(createApp()).put("/api/v1/community-reports/rep_1/vote").set(auth("passenger_2")).send({ value: 1 }).expect(404);
    prismaMock.communityReport.findUnique.mockResolvedValue(null);
    await request(createApp()).put("/api/v1/community-reports/nope/vote").set(auth("passenger_2")).send({ value: 1 }).expect(404);
    expect(prismaMock.communityReportVote.upsert).not.toHaveBeenCalled();
  });

  it("queues a repeatedly flagged report for admin review without hiding it", async () => {
    prismaMock.communityReport.findUnique.mockResolvedValue(row());
    prismaMock.communityReportFlag.count.mockResolvedValue(3);
    await request(createApp()).post("/api/v1/community-reports/rep_1/flag").set(auth("passenger_2")).expect(200);
    expect(prismaMock.communityReport.update.mock.calls[0][0].data).toEqual({ needs_admin_review: true, admin_reviewed_at: null });
    await request(createApp()).post("/api/v1/community-reports/rep_1/flag").set(auth("passenger_1")).expect(403);
  });

  it("lets admins list the review queue and hide a report", async () => {
    prismaMock.communityReport.findMany.mockResolvedValue([row({ needs_admin_review: true })]);
    prismaMock.communityReport.count.mockResolvedValue(1);
    const list = await request(createApp()).get("/api/v1/admin/community-reports").set(auth("admin_1")).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.reports[0].author_id).toBe("passenger_1");

    prismaMock.communityReport.findUnique.mockResolvedValue(row());
    prismaMock.communityReport.update.mockResolvedValue(row({ hidden_at: new Date() }));
    await request(createApp()).patch("/api/v1/admin/community-reports/rep_1").set(auth("admin_1")).send({ action: "hide" }).expect(200);
    await request(createApp()).patch("/api/v1/admin/community-reports/rep_1").set(auth("admin_1")).send({ action: "delete" }).expect(400);
  });

  it("filters the admin list by category and visibility and reports flag counts", async () => {
    prismaMock.communityReport.findMany.mockResolvedValue([row({ id: "rep_1", hidden_at: new Date("2026-11-02T10:00:00Z") })]);
    prismaMock.communityReport.count.mockResolvedValue(1);
    prismaMock.communityReportFlag.groupBy.mockResolvedValue([{ report_id: "rep_1", _count: { _all: 4 } }]);

    const list = await request(createApp())
      .get("/api/v1/admin/community-reports?pending=false&category=road_closure&hidden=true&page=2&limit=10")
      .set(auth("admin_1"))
      .expect(200);

    const query = prismaMock.communityReport.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ category: "road_closure", hidden_at: { not: null } });
    expect(query.skip).toBe(10);
    expect(query.take).toBe(10);
    expect(list.body.reports[0]).toMatchObject({ id: "rep_1", flag_count: 4, admin_reviewed_at: null });
    expect(list.body).toMatchObject({ page: 2, limit: 10, total: 1 });

    await request(createApp()).get("/api/v1/admin/community-reports?hidden=false").set(auth("admin_1")).expect(200);
    expect(prismaMock.communityReport.findMany.mock.calls[1][0].where).toEqual({ needs_admin_review: true, admin_reviewed_at: null, hidden_at: null });
    await request(createApp()).get("/api/v1/admin/community-reports?category=unknown").set(auth("admin_1")).expect(400);
  });
});
