import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { count: vi.fn(), create: vi.fn() },
  driverProfile: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  trip: { findUnique: vi.fn(), findMany: vi.fn() },
  tripRating: { findUnique: vi.fn(), create: vi.fn(), groupBy: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { recomputeDriverTrust, recomputeAllDriverTrust } = await import("../services/driverTrust.js");

const people: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  driver_1: { id: "driver_1", role: "driver", name: "D", phone: "+1", demo_account: true },
  passenger_1: { id: "passenger_1", role: "passenger", name: "P", phone: "+2", demo_account: true },
  passenger_2: { id: "passenger_2", role: "passenger", name: "Q", phone: "+3", demo_account: true }
};

function auth(id: string) {
  const token = jwt.sign({ role: people[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const departure = new Date("2026-10-29T08:00:00Z");
const finishedTrip = (over: Record<string, unknown> = {}) => ({
  status: "completed",
  cancelled_by_user_id: null,
  started_at: new Date(departure.getTime() + 60_000),
  completed_at: new Date(departure.getTime() + 90 * 60_000),
  driver_route: { departure_at: departure, availability_window_end: new Date(departure.getTime() + 3 * 3_600_000) },
  ...over
});

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
  prismaMock.driverProfile.findUnique.mockResolvedValue({ id: "profile_1", user_id: "driver_1" });
  prismaMock.driverProfile.update.mockResolvedValue({});
  prismaMock.trip.findMany.mockResolvedValue([]);
  prismaMock.tripRating.groupBy.mockResolvedValue([]);
});

describe("recomputeDriverTrust", () => {
  it("stores the neutral score for a driver with no trips", async () => {
    const result = await recomputeDriverTrust(prismaMock as never, "profile_1", new Date("2026-10-29T00:00:00Z"));
    expect(result?.score).toBe(70);
    expect(prismaMock.driverProfile.update).toHaveBeenCalledWith({
      where: { id: "profile_1" },
      data: expect.objectContaining({ trust_score: 70, trust_computed_at: new Date("2026-10-29T00:00:00Z") })
    });
  });

  it("returns null and writes nothing for an unknown driver", async () => {
    prismaMock.driverProfile.findUnique.mockResolvedValue(null);
    expect(await recomputeDriverTrust(prismaMock as never, "nope")).toBeNull();
    expect(prismaMock.driverProfile.update).not.toHaveBeenCalled();
  });

  it("counts only the driver's own cancellations against them", async () => {
    prismaMock.trip.findMany.mockResolvedValue([
      finishedTrip({ status: "cancelled", cancelled_by_user_id: "driver_1" }),
      finishedTrip({ status: "cancelled", cancelled_by_user_id: "passenger_1" }),
      finishedTrip({ status: "cancelled", cancelled_by_user_id: "some_admin" })
    ]);
    const result = await recomputeDriverTrust(prismaMock as never, "profile_1");
    expect(result?.components.cancellation.sample).toBe(1);
  });

  it("scores a driver whose trips were all cancelled by them below neutral", async () => {
    prismaMock.trip.findMany.mockResolvedValue(
      Array.from({ length: 12 }, () => finishedTrip({ status: "cancelled", cancelled_by_user_id: "driver_1", started_at: null, completed_at: null }))
    );
    const result = await recomputeDriverTrust(prismaMock as never, "profile_1");
    expect(result!.score).toBeLessThan(60);
  });

  it("feeds per-passenger rating aggregates, so spam from one passenger is capped", async () => {
    prismaMock.tripRating.groupBy.mockResolvedValue([{ passenger_id: "passenger_1", _count: { _all: 200 }, _avg: { stars: 5 } }]);
    const result = await recomputeDriverTrust(prismaMock as never, "profile_1");
    expect(result?.components.rating.sample).toBe(3);
  });

  it("reads ratings by driver id and never passes passenger identities into the stored components", async () => {
    prismaMock.tripRating.groupBy.mockResolvedValue([{ passenger_id: "passenger_1", _count: { _all: 1 }, _avg: { stars: 4 } }]);
    await recomputeDriverTrust(prismaMock as never, "profile_1");
    const stored = JSON.stringify(prismaMock.driverProfile.update.mock.calls[0][0].data);
    expect(stored).not.toContain("passenger_1");
  });
});

describe("recomputeAllDriverTrust", () => {
  it("pages through every profile and reports failures without stopping", async () => {
    prismaMock.driverProfile.findMany
      .mockResolvedValueOnce([{ id: "a" }, { id: "b" }])
      .mockResolvedValueOnce([{ id: "c" }]);
    prismaMock.driverProfile.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === "b" ? Promise.reject(new Error("boom")) : Promise.resolve({ id: where.id, user_id: "u" })
    );
    const result = await recomputeAllDriverTrust(prismaMock as never, { batchSize: 2 });
    expect(result).toEqual({ recomputed: 2, failed: 1 });
    expect(prismaMock.driverProfile.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: "b" }, skip: 1 });
  });
});

describe("trip rating API", () => {
  const completedTrip = (over: Record<string, unknown> = {}) => ({
    status: "completed",
    driver_route: { driver_id: "profile_1" },
    passenger_request: { passenger_id: "passenger_1" },
    canonical_manifest: null,
    ...over
  });

  it("requires a passenger", async () => {
    await request(createApp()).post("/api/v1/trips/t1/rating").send({ stars: 5 }).expect(401);
    await request(createApp()).post("/api/v1/trips/t1/rating").set(auth("driver_1")).send({ stars: 5 }).expect(403);
  });

  it("records one rating for a completed trip and refreshes the driver score", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(completedTrip());
    prismaMock.tripRating.create.mockResolvedValue({});
    const response = await request(createApp()).post("/api/v1/trips/t1/rating").set(auth("passenger_1")).send({ stars: 4 }).expect(201);
    expect(response.body).toEqual({ rating: { stars: 4 } });
    expect(prismaMock.tripRating.create).toHaveBeenCalledWith({
      data: { trip_id: "t1", passenger_id: "passenger_1", driver_id: "profile_1", stars: 4 }
    });
    expect(prismaMock.driverProfile.update).toHaveBeenCalled();
  });

  it("rejects a second rating from the same passenger", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(completedTrip());
    prismaMock.tripRating.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const response = await request(createApp()).post("/api/v1/trips/t1/rating").set(auth("passenger_1")).send({ stars: 5 }).expect(409);
    expect(response.body.error?.code ?? response.body.error ?? response.body.code).toContain("trip_already_rated");
    expect(prismaMock.driverProfile.update).not.toHaveBeenCalled();
  });

  it("treats someone else's trip as not found", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(completedTrip());
    await request(createApp()).post("/api/v1/trips/t1/rating").set(auth("passenger_2")).send({ stars: 1 }).expect(404);
    expect(prismaMock.tripRating.create).not.toHaveBeenCalled();
  });

  it("lets a shared-trip passenger rate through the manifest", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(
      completedTrip({
        passenger_request: null,
        canonical_manifest: { members: [{ passenger_request: { passenger_id: "passenger_1" } }, { passenger_request: { passenger_id: "passenger_2" } }] }
      })
    );
    prismaMock.tripRating.create.mockResolvedValue({});
    await request(createApp()).post("/api/v1/trips/t1/rating").set(auth("passenger_2")).send({ stars: 3 }).expect(201);
  });

  it("only allows rating a completed trip", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(completedTrip({ status: "in_transit" }));
    await request(createApp()).post("/api/v1/trips/t1/rating").set(auth("passenger_1")).send({ stars: 5 }).expect(409);
    expect(prismaMock.tripRating.create).not.toHaveBeenCalled();
  });

  it.each([0, 6, 3.5, "5", null])("rejects invalid stars %s", async (stars) => {
    prismaMock.trip.findUnique.mockResolvedValue(completedTrip());
    const response = await request(createApp()).post("/api/v1/trips/t1/rating").set(auth("passenger_1")).send({ stars });
    expect(response.status).toBe(400);
    expect(prismaMock.tripRating.create).not.toHaveBeenCalled();
  });

  it("tells a passenger whether they already rated, and nobody else", async () => {
    prismaMock.trip.findUnique.mockResolvedValue(completedTrip());
    prismaMock.tripRating.findUnique.mockResolvedValue({ stars: 4 });
    const mine = await request(createApp()).get("/api/v1/trips/t1/rating").set(auth("passenger_1")).expect(200);
    expect(mine.body).toEqual({ rating: { stars: 4 } });
    await request(createApp()).get("/api/v1/trips/t1/rating").set(auth("driver_1")).expect(403);
    await request(createApp()).get("/api/v1/trips/t1/rating").set(auth("passenger_2")).expect(404);
  });
});
