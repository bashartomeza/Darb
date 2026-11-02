import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { count: vi.fn(), create: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");

const people: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  driver_1: { id: "driver_1", role: "driver", name: "D", phone: "+1", demo_account: true },
  passenger_1: { id: "passenger_1", role: "passenger", name: "P", phone: "+2", demo_account: true }
};

function auth(id: string) {
  const token = jwt.sign({ role: people[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

describe("driver performance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = people[where.id.replace(/^session_/, "")];
      return {
        id: where.id,
        user_id: user.id,
        user: { email_verified_at: new Date(), ...user, account_status: "active", security_version: 1 },
        security_version_at_issue: 1,
        expires_at: new Date(Date.now() + 60_000),
        revoked_at: null
      };
    });
  });

  const counts = (accepted: number, rejected: number) =>
    prismaMock.auditEvent.count.mockImplementation(({ where }: { where: { action: string } }) =>
      Promise.resolve(where.action === "match_accepted" ? accepted : rejected)
    );

  it("is for drivers only", async () => {
    await request(createApp()).get("/api/v1/driver/performance").expect(401);
    await request(createApp()).get("/api/v1/driver/performance").set(auth("passenger_1")).expect(403);
  });

  it("gives the rate of answered offers once there are enough of them", async () => {
    counts(7, 3);
    const response = await request(createApp()).get("/api/v1/driver/performance").set(auth("driver_1")).expect(200);

    expect(response.body).toMatchObject({ offers_responded: 10, offers_accepted: 7, acceptance_rate: 70, min_sample: 5 });
    for (const call of prismaMock.auditEvent.count.mock.calls) expect(call[0].where.user_id).toBe("driver_1");
  });

  it("withholds the percentage for a small sample rather than showing a misleading one", async () => {
    counts(1, 0);
    const response = await request(createApp()).get("/api/v1/driver/performance").set(auth("driver_1")).expect(200);
    expect(response.body).toMatchObject({ offers_responded: 1, offers_accepted: 1, acceptance_rate: null });
  });
});
