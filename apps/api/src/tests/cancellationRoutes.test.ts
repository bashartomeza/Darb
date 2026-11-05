import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  trip: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
  cancellation: { count: vi.fn(), findMany: vi.fn() },
  auditEvent: { create: vi.fn() }
}));
const service = vi.hoisted(() => ({
  driverCancelTrip: vi.fn(),
  adminCancelTrip: vi.fn(),
  cancelPassengerRequest: vi.fn(),
  cancelMerchantOrder: vi.fn()
}));
const trust = vi.hoisted(() => ({ recomputeTrustForTrip: vi.fn() }));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/cancellations.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/cancellations.js")>()),
  ...service
}));
vi.mock("../services/driverTrust.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/driverTrust.js")>()),
  ...trust
}));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");

const base = { email_verified_at: new Date(), name: "QA", phone: "+15550000001", account_status: "active" as const, security_version: 1, demo_account: false };
const people = {
  admin: { ...base, id: "admin_1", role: "admin" as const },
  driver: { ...base, id: "driver_1", role: "driver" as const },
  passenger: { ...base, id: "passenger_1", role: "passenger" as const }
};
const as = (key: keyof typeof people) => ({
  Authorization: `Bearer ${signAuthToken({ id: people[key].id, role: people[key].role, sessionId: `session_${key}`, securityVersion: 1 })}`
});

describe("cancellation endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(prismaMock));
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = people[where.id.replace("session_", "") as keyof typeof people];
      return { id: where.id, user_id: user.id, user, security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null };
    });
    prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Object.values(people).find((person) => person.id === where.id) ?? null);
    service.driverCancelTrip.mockResolvedValue({ tripId: "trip_1", returnedToWaiting: 1 });
    service.adminCancelTrip.mockResolvedValue({ tripId: "trip_1" });
    service.cancelPassengerRequest.mockResolvedValue(undefined);
    service.cancelMerchantOrder.mockResolvedValue({ closed: null, tripId: "trip_1" });
    prismaMock.trip.findUniqueOrThrow.mockResolvedValue({ id: "trip_1", status: "cancelled" });
  });

  describe("POST /trips/:id/cancel (driver)", () => {
    it("cancels with the driver's reason, then recomputes their trust score", async () => {
      const response = await request(createApp()).post("/api/v1/trips/trip_1/cancel").set(as("driver"))
        .send({ reason: "vehicle_problem", note: "flat tyre" }).expect(200);

      expect(service.driverCancelTrip).toHaveBeenCalledWith(prismaMock, {
        tripId: "trip_1", driverUserId: "driver_1", reason: { code: "vehicle_problem", note: "flat tyre" }
      });
      expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted" });
      expect(trust.recomputeTrustForTrip).toHaveBeenCalledWith(prismaMock, "trip_1");
      expect(response.body).toMatchObject({ trip: { status: "cancelled" }, returned_to_waiting: 1 });
    });

    it("needs a reason from the driver's list", async () => {
      await request(createApp()).post("/api/v1/trips/trip_1/cancel").set(as("driver")).send({}).expect(400);
      await request(createApp()).post("/api/v1/trips/trip_1/cancel").set(as("driver")).send({ reason: "changed_plans" }).expect(400);
      expect(service.driverCancelTrip).not.toHaveBeenCalled();
    });

    it("is for drivers only", async () => {
      await request(createApp()).post("/api/v1/trips/trip_1/cancel").set(as("passenger")).send({ reason: "other" }).expect(403);
      await request(createApp()).post("/api/v1/trips/trip_1/cancel").send({ reason: "other" }).expect(401);
      expect(service.driverCancelTrip).not.toHaveBeenCalled();
    });

    it("passes the daily limit refusal through", async () => {
      const { HttpError } = await import("../middleware/error.js");
      service.driverCancelTrip.mockRejectedValue(new HttpError(429, "driver_cancellation_limit_reached"));
      const response = await request(createApp()).post("/api/v1/trips/trip_1/cancel").set(as("driver")).send({ reason: "other" }).expect(429);
      expect(response.body.error).toBe("driver_cancellation_limit_reached");
      expect(trust.recomputeTrustForTrip).not.toHaveBeenCalled();
    });
  });

  describe("administrator cancellations", () => {
    it.each([
      ["/api/v1/admin/trips/trip_1/cancel", () => service.adminCancelTrip],
      ["/api/v1/admin/requests/request_1/cancel", () => service.cancelPassengerRequest],
      ["/api/v1/admin/orders/order_1/cancel", () => service.cancelMerchantOrder]
    ])("%s cancels with an administrator reason and records the administrator", async (path, target) => {
      await request(createApp()).post(path).set(as("admin")).send({ reason: "safety_concern", note: "reported" }).expect(200);
      expect(target()).toHaveBeenCalledWith(prismaMock, expect.objectContaining({
        reason: { code: "safety_concern", note: "reported" }
      }));
      const input = target().mock.calls[0]![1];
      expect(input.actorId ?? input.actor?.userId).toBe("admin_1");
      if (input.actor) expect(input.actor.role).toBe("admin");
    });

    it.each([
      "/api/v1/admin/trips/trip_1/cancel",
      "/api/v1/admin/requests/request_1/cancel",
      "/api/v1/admin/orders/order_1/cancel"
    ])("%s needs an administrator and an administrator reason", async (path) => {
      await request(createApp()).post(path).set(as("passenger")).send({ reason: "duplicate" }).expect(403);
      await request(createApp()).post(path).set(as("driver")).send({ reason: "duplicate" }).expect(403);
      await request(createApp()).post(path).set(as("admin")).send({}).expect(400);
      await request(createApp()).post(path).set(as("admin")).send({ reason: "vehicle_problem" }).expect(400);
      await request(createApp()).post(path).set(as("admin")).send({ reason: "no_driver_in_time" }).expect(400);
      expect(service.adminCancelTrip).not.toHaveBeenCalled();
      expect(service.cancelPassengerRequest).not.toHaveBeenCalled();
      expect(service.cancelMerchantOrder).not.toHaveBeenCalled();
    });
  });

  describe("GET /admin/cancellations", () => {
    beforeEach(() => {
      prismaMock.cancellation.findMany.mockResolvedValue([
        {
          id: "c1", actor_role: "system", actor: null, reason_code: "no_driver_in_time", note: null, automatic: true, ends_order: true,
          trip_id: null, created_at: new Date("2026-11-12T10:00:00Z"),
          passenger_request: { id: "request_1", status: "cancelled", passenger: { id: "p1", name: "Sara" } }, merchant_order: null
        },
        {
          id: "c2", actor_role: "driver", actor: { id: "d1", name: "Omar" }, reason_code: "emergency", note: "private", automatic: false, ends_order: false,
          trip_id: "trip_1", created_at: new Date("2026-11-12T09:00:00Z"), passenger_request: null,
          merchant_order: { id: "order_1", status: "batched", merchant: { id: "m1", name: "Shop" }, passenger_parcel: { order_id: "order_1" } }
        },
        { id: "c3", actor_role: "admin", actor: null, reason_code: "other", note: null, automatic: false, ends_order: true, trip_id: null, created_at: new Date(), passenger_request: null, merchant_order: null }
      ]);
    });

    it("lists newest first, with who cancelled, the order and its owner, and what became of the order", async () => {
      const response = await request(createApp()).get("/api/v1/admin/cancellations?limit=2").set(as("admin")).expect(200);
      expect(prismaMock.cancellation.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {}, take: 3, orderBy: [{ created_at: "desc" }, { id: "desc" }]
      }));
      expect(response.body.cancellations).toEqual([
        {
          id: "c1", created_at: "2026-11-12T10:00:00.000Z", kind: "automatic", by_role: "system", by: null, reason: "no_driver_in_time", note: null,
          outcome: "cancelled", trip_id: null, order: { type: "ride", id: "request_1", status: "cancelled", owner: { id: "p1", name: "Sara" } }
        },
        {
          id: "c2", created_at: "2026-11-12T09:00:00.000Z", kind: "manual", by_role: "driver", by: { id: "d1", name: "Omar" }, reason: "emergency", note: "private",
          outcome: "requeued", trip_id: "trip_1", order: { type: "parcel", id: "order_1", status: "batched", owner: { id: "m1", name: "Shop" } }
        }
      ]);
      // A third row exists, so there is a next page that starts after the last one shown.
      expect(response.body.next_cursor).toBe("c2");
      expect(response.body.reasons.driver).toContain("vehicle_problem");
    });

    it("continues after a cursor", async () => {
      prismaMock.cancellation.findMany.mockResolvedValue([]);
      const response = await request(createApp()).get("/api/v1/admin/cancellations?cursor=c2").set(as("admin")).expect(200);
      expect(prismaMock.cancellation.findMany).toHaveBeenCalledWith(expect.objectContaining({ cursor: { id: "c2" }, skip: 1, take: 51 }));
      expect(response.body.next_cursor).toBeNull();
    });

    it("filters by date, automatic or manual, role and reason", async () => {
      await request(createApp())
        .get("/api/v1/admin/cancellations?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z&kind=automatic&role=system&reason=no_driver_in_time")
        .set(as("admin")).expect(200);
      expect(prismaMock.cancellation.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          created_at: { gte: new Date("2026-11-01T00:00:00Z"), lte: new Date("2026-11-30T00:00:00Z") },
          automatic: true, actor_role: "system", reason_code: "no_driver_in_time"
        }
      }));
      await request(createApp()).get("/api/v1/admin/cancellations?kind=manual").set(as("admin")).expect(200);
      expect(prismaMock.cancellation.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { automatic: false } }));
    });

    it("rejects unknown filters and non-administrators", async () => {
      await request(createApp()).get("/api/v1/admin/cancellations?role=hacker").set(as("admin")).expect(400);
      await request(createApp()).get("/api/v1/admin/cancellations?reason=nonsense").set(as("admin")).expect(400);
      await request(createApp()).get("/api/v1/admin/cancellations").set(as("driver")).expect(403);
    });
  });
});
