import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  appRating: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

const users: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  admin_1: { id: "admin_1", role: "admin", name: "Admin", phone: "+7", demo_account: false },
  passenger_1: { id: "passenger_1", role: "passenger", name: "Passenger", phone: "+1", demo_account: false }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const savedAt = new Date("2026-11-03T10:00:00.000Z");

describe("admin app ratings", () => {
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
    prismaMock.appRating.findMany.mockResolvedValue([
      {
        user_id: "passenger_1",
        stars: 4,
        feedback: "Works well",
        created_at: savedAt,
        updated_at: savedAt,
        user: { id: "passenger_1", name: "Passenger", role: "passenger", phone: "+1", email: "secret@example.com" }
      }
    ]);
    prismaMock.appRating.count.mockResolvedValue(1);
    prismaMock.appRating.groupBy.mockResolvedValue([
      { stars: 5, _count: { _all: 3 } },
      { stars: 4, _count: { _all: 1 } },
      { stars: 1, _count: { _all: 1 } }
    ]);
  });

  it("lists ratings newest first with the average and the 1-5 distribution", async () => {
    const response = await request(createApp()).get("/api/v1/admin/app-ratings").set(auth("admin_1")).expect(200);

    expect(response.body.ratings).toEqual([
      {
        user: { id: "passenger_1", name: "Passenger", role: "passenger" },
        stars: 4,
        feedback: "Works well",
        created_at: savedAt.toISOString(),
        updated_at: savedAt.toISOString()
      }
    ]);
    expect(response.body).toMatchObject({ page: 1, limit: 25, total: 1 });
    expect(response.body.summary).toEqual({ count: 5, average: 4, distribution: { "1": 1, "2": 0, "3": 0, "4": 1, "5": 3 } });
    expect(JSON.stringify(response.body)).not.toContain("secret@example.com");
    expect(prismaMock.appRating.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: [{ updated_at: "desc" }, { user_id: "asc" }], skip: 0, take: 25 })
    );
  });

  it("filters the list by stars and dates; the summary follows the dates only", async () => {
    await request(createApp())
      .get("/api/v1/admin/app-ratings?stars=5&from=2026-11-01&to=2026-11-03&page=2&limit=10")
      .set(auth("admin_1"))
      .expect(200);

    const range = { updated_at: { gte: new Date("2026-11-01T00:00:00.000Z"), lt: new Date("2026-11-04T00:00:00.000Z") } };
    expect(prismaMock.appRating.findMany.mock.calls[0][0]).toMatchObject({ where: { ...range, stars: 5 }, skip: 10, take: 10 });
    expect(prismaMock.appRating.count).toHaveBeenCalledWith({ where: { ...range, stars: 5 } });
    expect(prismaMock.appRating.groupBy).toHaveBeenCalledWith({ by: ["stars"], where: range, _count: { _all: true } });
  });

  it("reports no average when there are no ratings", async () => {
    prismaMock.appRating.findMany.mockResolvedValue([]);
    prismaMock.appRating.count.mockResolvedValue(0);
    prismaMock.appRating.groupBy.mockResolvedValue([]);
    const response = await request(createApp()).get("/api/v1/admin/app-ratings").set(auth("admin_1")).expect(200);
    expect(response.body.summary).toEqual({ count: 0, average: null, distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } });
  });

  it("refuses bad filters and non-admins", async () => {
    for (const query of ["stars=0", "stars=6", "from=2026-13-01", "from=yesterday", "from=2026-11-05&to=2026-11-01", "limit=101"]) {
      await request(createApp()).get(`/api/v1/admin/app-ratings?${query}`).set(auth("admin_1")).expect(400);
    }
    await request(createApp()).get("/api/v1/admin/app-ratings").set(auth("passenger_1")).expect(403);
    await request(createApp()).get("/api/v1/admin/app-ratings").expect(401);
    expect(prismaMock.appRating.findMany).not.toHaveBeenCalled();
  });
});
