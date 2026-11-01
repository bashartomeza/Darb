import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";
import { canonicalMatchingSerializers } from "../modules/canonicalMatching.js";
import {
  canonicalOfferPagination,
  canonicalScoring,
  createCanonicalMatchingService
} from "../services/canonicalMatching.js";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
const { createApp } = await import("../app.js");

type Role = "passenger" | "driver" | "merchant";
const environment = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
  JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent",
  MULTI_ROUTE_ENTRY_ENABLED: "true",
  MULTI_ROUTE_MATCHING_ENABLED: "true",
  CANONICAL_TRIP_CREATION_ENABLED: "true"
};
const enabled = createConfig(environment);
const disabled = createConfig({
  ...environment,
  MULTI_ROUTE_MATCHING_ENABLED: "false",
  CANONICAL_TRIP_CREATION_ENABLED: "false"
});

function auth(id: string, role: Role) {
  const token = jwt.sign({ role, sid: `session_${id}`, ver: 1 }, environment.JWT_SECRET, {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const offer = {
  id: "offer_1",
  canonical_match_version: "canonical_route_match_v1",
  status: "sent_to_driver",
  route_version_id: "version_1",
  attempt_number: 1,
  created_at: new Date(),
  offered_at: new Date(),
  expires_at: new Date(Date.now() + 300_000),
  driver_route: { departure_at: new Date(), route_version_id: "version_1" },
  passenger_request: {
    passenger_count: 2,
    pickup_stop_id: "stop_1",
    dropoff_stop_id: "stop_3",
    requested_departure_from: new Date(),
    requested_departure_until: new Date(),
    phone: "must-not-leak"
  },
  merchant_order: null,
  scoring_breakdown: { must_not_leak: true },
  reservation_id: "must-not-leak",
  demand_checksum: "must-not-leak",
  active_driver_route_key: "must-not-leak",
  accepted_driver_route_key: "must-not-leak",
  canonical_assignment_key: "must-not-leak"
};

function serviceMock() {
  return {
    assertDriverEligible: vi.fn().mockResolvedValue(undefined),
    listDriverOffers: vi.fn().mockResolvedValue({ offers: [offer], nextCursor: null }),
    getDriverOffer: vi.fn().mockResolvedValue(offer),
    accept: vi.fn().mockResolvedValue({
      trip: { id: "trip_1", status: "accepted", route_version_id: "version_1" },
      replayed: false
    }),
    reject: vi.fn().mockResolvedValue({
      offer: { id: "offer_1", status: "rejected", reject_reason: "schedule_conflict" },
      replayed: false
    }),
    passengerStatus: vi.fn().mockResolvedValue([{
      id: "request_1",
      status: "matched",
      route_version_id: "version_1",
      pickup_stop_id: "stop_1",
      dropoff_stop_id: "stop_3",
      requested_departure_from: new Date(),
      requested_departure_until: new Date(),
      canonical_created_at: new Date(),
      passenger: { phone: "must-not-leak" },
      canonical_dispatch: {
        status: "assigned",
        updated_at: new Date(),
        assigned_trip: {
          id: "trip_1",
          status: "accepted",
          driver_route: { driver: { vehicle_type: "sedan", user: { phone: "must-not-leak" } } }
        }
      }
    }]),
    merchantStatus: vi.fn().mockResolvedValue([{
      id: "order_1",
      status: "assigned",
      route_version_id: "version_1",
      pickup_stop_id: "stop_1",
      requested_departure_from: new Date(),
      requested_departure_until: new Date(),
      canonical_created_at: new Date(),
      parcels: [{ id: "parcel_1", status: "assigned", destination_stop_id: "stop_3", destination_label: "must-not-leak" }],
      canonical_dispatch: { status: "offered", updated_at: new Date(), assigned_trip: null }
    }])
  };
}

describe("M7C3A canonical matching APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const id = where.id.replace("session_", "");
      const role = id.startsWith("driver") ? "driver" : id.startsWith("merchant") ? "merchant" : "passenger";
      return {
        id: where.id,
        user_id: id,
        user: { email_verified_at: new Date(), id, role, account_status: "active", security_version: 1 },
        security_version_at_issue: 1,
        expires_at: new Date(Date.now() + 60_000),
        revoked_at: null
      };
    });
    prismaMock.authSession.update.mockResolvedValue({});
  });

  it("hides offer mutation while keeping owner assignment reads available when matching is disabled", async () => {
    const app = createApp(disabled, { canonicalMatchingService: serviceMock() as never });
    await request(app).get("/api/v1/driver/canonical-match-offers").set(auth("driver_1", "driver")).expect(404);
    await request(app).get("/api/v1/passenger/route-requests").set(auth("passenger_1", "passenger")).expect(200);
    await request(app).get("/api/v1/merchant/route-orders").set(auth("merchant_1", "merchant")).expect(200);
  });

  it("requires authentication, the driver role, and verified-driver eligibility", async () => {
    const service = serviceMock();
    const app = createApp(enabled, { canonicalMatchingService: service as never });
    await request(app).get("/api/v1/driver/canonical-match-offers").expect(401);
    await request(app).get("/api/v1/driver/canonical-match-offers").set(auth("passenger_1", "passenger")).expect(403);
    await request(app).get("/api/v1/driver/canonical-match-offers").set(auth("driver_1", "driver")).expect(200);
    expect(service.assertDriverEligible).toHaveBeenCalledWith("driver_1");
    expect(service.listDriverOffers).toHaveBeenCalledWith("driver_1", { limit: 25 });
  });

  it("returns an opaque next cursor and rejects malformed cursors", async () => {
    const service = serviceMock();
    service.listDriverOffers.mockImplementation(async (_driverId, input) => {
      if (input.cursor) canonicalOfferPagination.decode(input.cursor);
      return {
        offers: [offer],
        nextCursor: canonicalOfferPagination.encode({
          createdAt: offer.created_at,
          id: offer.id
        })
      };
    });
    const app = createApp(enabled, { canonicalMatchingService: service as never });
    const response = await request(app)
      .get("/api/v1/driver/canonical-match-offers?limit=1")
      .set(auth("driver_1", "driver"))
      .expect(200);
    expect(response.body.next_cursor).toEqual(expect.any(String));
    const invalid = await request(app)
      .get("/api/v1/driver/canonical-match-offers?cursor=%25%25%25")
      .set(auth("driver_1", "driver"))
      .expect(400);
    expect(invalid.body).toEqual(
      expect.objectContaining({ error: "invalid_cursor" })
    );
  });

  it("strictly validates opaque driver-offer cursors", () => {
    const encoded = canonicalOfferPagination.encode({
      createdAt: new Date("2026-07-27T10:00:00.000Z"),
      id: "offer_1"
    });
    expect(canonicalOfferPagination.decode(encoded)).toEqual({
      createdAt: new Date("2026-07-27T10:00:00.000Z"),
      id: "offer_1"
    });
    expect(() => canonicalOfferPagination.decode("%%%")).toThrowError(
      expect.objectContaining({ statusCode: 400, message: "invalid_cursor" })
    );
  });

  it("paginates by created_at and id without duplicates when newer offers arrive", async () => {
    const sameTime = new Date("2026-07-27T10:00:00.000Z");
    const rows = [
      { id: "offer_c", created_at: sameTime },
      { id: "offer_b", created_at: sameTime },
      { id: "offer_a", created_at: new Date("2026-07-27T09:00:00.000Z") }
    ];
    const findMany = vi.fn(async ({ where, take }: Record<string, any>) => {
      const boundary = where.OR as
        | [{ created_at: { lt: Date } }, { created_at: Date; id: { lt: string } }]
        | undefined;
      return rows
        .filter((row) => {
          if (!boundary) return true;
          return (
            row.created_at < boundary[0].created_at.lt ||
            (row.created_at.getTime() === boundary[1].created_at.getTime() &&
              row.id < boundary[1].id.lt)
          );
        })
        .sort(
          (left, right) =>
            right.created_at.getTime() - left.created_at.getTime() ||
            right.id.localeCompare(left.id)
        )
        .slice(0, take);
    });
    const service = createCanonicalMatchingService(
      { match: { findMany } } as never,
      enabled
    );

    const first = await service.listDriverOffers("driver_1", { limit: 2 });
    expect(first.offers.map(({ id }) => id)).toEqual(["offer_c", "offer_b"]);
    expect(first.nextCursor).toEqual(expect.any(String));
    rows.unshift({
      id: "offer_d",
      created_at: new Date("2026-07-27T11:00:00.000Z")
    });
    const second = await service.listDriverOffers("driver_1", {
      cursor: first.nextCursor!,
      limit: 2
    });
    expect(second.offers.map(({ id }) => id)).toEqual(["offer_a"]);
    expect(
      findMany.mock.calls[0]?.[0].where.driver_route.driver.user_id
    ).toBe("driver_1");
  });

  it("returns bounded driver summaries without score, reservation, phone, or profile data", async () => {
    const app = createApp(enabled, { canonicalMatchingService: serviceMock() as never });
    const response = await request(app)
      .get("/api/v1/driver/canonical-match-offers/offer_1")
      .set(auth("driver_1", "driver"))
      .expect(200);
    const encoded = JSON.stringify(response.body);
    expect(response.body.offer).toEqual(expect.objectContaining({ id: "offer_1", demand_type: "passenger" }));
    for (const forbidden of ["must-not-leak", "reservation_id", "scoring_breakdown", "phone"]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it("requires idempotency and forwards exact accept/reject scopes", async () => {
    const service = serviceMock();
    const app = createApp(enabled, { canonicalMatchingService: service as never });
    await request(app)
      .post("/api/v1/driver/canonical-match-offers/offer_1/accept")
      .set(auth("driver_1", "driver"))
      .expect(400);
    await request(app)
      .post("/api/v1/driver/canonical-match-offers/offer_1/accept")
      .set(auth("driver_1", "driver"))
      .set("idempotency-key", "accept-key-1")
      .expect(200);
    await request(app)
      .post("/api/v1/driver/canonical-match-offers/offer_1/reject")
      .set(auth("driver_1", "driver"))
      .set("idempotency-key", "reject-key-1")
      .send({ reason: "schedule_conflict" })
      .expect(200);
    expect(service.accept).toHaveBeenCalledWith("driver_1", "offer_1", expect.objectContaining({ idempotencyKey: "accept-key-1" }));
    expect(service.reject).toHaveBeenCalledWith("driver_1", "offer_1", "schedule_conflict", expect.objectContaining({ idempotencyKey: "reject-key-1" }));
  });

  it("rejects free-form rejection reasons", async () => {
    const app = createApp(enabled, { canonicalMatchingService: serviceMock() as never });
    await request(app)
      .post("/api/v1/driver/canonical-match-offers/offer_1/reject")
      .set(auth("driver_1", "driver"))
      .set("idempotency-key", "reject-key-1")
      .send({ reason: "because this contains arbitrary private text" })
      .expect(400);
  });

  it("returns owner assignment status without candidate, phone, or parcel-description disclosure", async () => {
    const service = serviceMock();
    const app = createApp(enabled, { canonicalMatchingService: service as never });
    const passenger = await request(app).get("/api/v1/passenger/route-requests/request_1").set(auth("passenger_1", "passenger")).expect(200);
    const merchant = await request(app).get("/api/v1/merchant/route-orders/order_1").set(auth("merchant_1", "merchant")).expect(200);
    expect(passenger.body.request).toEqual(expect.objectContaining({ assigned: true, trip: { id: "trip_1", status: "accepted", vehicle_type: "sedan" } }));
    expect(merchant.body.order).toEqual(expect.objectContaining({ offer_pending: true, assigned: false }));
    const encoded = JSON.stringify({ passenger: passenger.body, merchant: merchant.body });
    for (const forbidden of ["must-not-leak", "phone", "destination_label", "attempt_count", "score"]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it("keeps owner status routes role-scoped", async () => {
    const app = createApp(enabled, { canonicalMatchingService: serviceMock() as never });
    await request(app).get("/api/v1/passenger/route-requests").set(auth("merchant_1", "merchant")).expect(403);
    await request(app).get("/api/v1/merchant/route-orders").set(auth("passenger_1", "passenger")).expect(403);
  });

  it("associates each passenger request only with its exact single or shared assigned Trip", () => {
    const resource = (id: string, trip: Record<string, unknown> | null) => ({
      id,
      status: trip ? "matched" : "pending",
      route_version_id: "version_1",
      pickup_stop_id: "stop_1",
      dropoff_stop_id: "stop_3",
      requested_departure_from: new Date("2026-08-06T10:00:00.000Z"),
      requested_departure_until: new Date("2026-08-06T11:00:00.000Z"),
      canonical_created_at: new Date("2026-08-06T09:00:00.000Z"),
      canonical_dispatch: {
        status: trip ? "assigned" : "pending",
        updated_at: new Date("2026-08-06T12:00:00.000Z"),
        assigned_trip: trip
      }
    });
    const trip = (id: string, version: string) => ({
      id,
      status: "accepted",
      canonical_trip_version: version,
      route_version_id: "version_1",
      created_at: new Date("2026-08-06T12:00:00.000Z"),
      driver_route: {
        departure_at: new Date("2026-08-06T13:00:00.000Z"),
        driver: { vehicle_type: "sedan", phone: "must-not-leak" }
      }
    });

    const requestA = canonicalMatchingSerializers.statusResponse(
      resource("request_a", trip("trip_a", "canonical_route_trip_v1"))
    );
    const requestB = canonicalMatchingSerializers.statusResponse(
      resource("request_b", trip("trip_b", "canonical_route_trip_v1"))
    );
    const shared = canonicalMatchingSerializers.statusResponse(
      resource("request_shared", trip("trip_shared", "canonical_shared_trip_v1")),
      true
    );
    const unassigned = canonicalMatchingSerializers.statusResponse(resource("request_unassigned", null));

    expect(requestA.trip).toEqual(expect.objectContaining({ id: "trip_a" }));
    expect(requestB.trip).toEqual(expect.objectContaining({ id: "trip_b" }));
    expect(shared.trip).toEqual(expect.objectContaining({
      id: "trip_shared",
      trip_version: "canonical_shared_trip_v1",
      shared_trip: true
    }));
    expect(unassigned.trip).toBeNull();
    expect(JSON.stringify({ requestA, requestB, shared, unassigned }))
      .not.toMatch(/must-not-leak|phone|manifest|member|reservation|fingerprint/i);
  });

  describe("merchant order to driver visibility", () => {
    const merchantOffer = {
      ...offer,
      id: "offer_parcels",
      passenger_request: null,
      merchant_order: {
        pickup_stop_id: "stop_1",
        requested_departure_from: new Date(),
        requested_departure_until: new Date(),
        _count: { parcels: 2 },
        parcels: [
          { destination_stop_id: "stop_2", size: "S", fare_minor: null, fare_currency: null },
          { destination_stop_id: "stop_3", size: "M", fare_minor: null, fare_currency: null }
        ]
      }
    };

    it("lists a merchant parcel offer for the offered driver with parcel summary and no private data", async () => {
      const service = serviceMock();
      service.listDriverOffers.mockResolvedValue({ offers: [merchantOffer], nextCursor: null });
      const app = createApp(enabled, { canonicalMatchingService: service as never });
      const response = await request(app)
        .get("/api/v1/driver/canonical-match-offers")
        .set(auth("driver_1", "driver"))
        .expect(200);
      expect(service.listDriverOffers).toHaveBeenCalledWith("driver_1", { limit: 25 });
      expect(response.body.offers[0]).toEqual(
        expect.objectContaining({
          id: "offer_parcels",
          status: "offered",
          demand_type: "merchant_order",
          demand: expect.objectContaining({
            parcel_count: 2,
            pickup_stop_id: "stop_1",
            destination_stop_ids: ["stop_2", "stop_3"]
          })
        })
      );
      expect(JSON.stringify(response.body)).not.toMatch(/must-not-leak|phone|destination_label/);
    });

    it("gives the merchant parcel_count and destinations and only ever queries its own orders", async () => {
      const service = serviceMock();
      const app = createApp(enabled, { canonicalMatchingService: service as never });
      const response = await request(app)
        .get("/api/v1/merchant/route-orders")
        .set(auth("merchant_7", "merchant"))
        .expect(200);
      expect(service.merchantStatus).toHaveBeenCalledWith("merchant_7", undefined, 25);
      expect(response.body.orders[0]).toEqual(
        expect.objectContaining({
          status: "assigned",
          dispatch_status: "offered",
          offer_pending: true,
          parcel_count: 1,
          destination_stop_ids: ["stop_3"]
        })
      );
      // A driver cannot read merchant order status, nor a merchant the driver inbox.
      await request(app).get("/api/v1/merchant/route-orders").set(auth("driver_1", "driver")).expect(403);
      await request(app).get("/api/v1/driver/canonical-match-offers").set(auth("merchant_7", "merchant")).expect(403);
    });

    it("scopes merchant status and driver offer queries to the caller", async () => {
      const orderFindMany = vi.fn().mockResolvedValue([]);
      const matchFindMany = vi.fn().mockResolvedValue([]);
      const service = createCanonicalMatchingService(
        { merchantOrder: { findMany: orderFindMany }, match: { findMany: matchFindMany } } as never,
        enabled
      );
      await service.merchantStatus("merchant_7", "order_9", 5);
      expect(orderFindMany.mock.calls[0]?.[0].where).toEqual({
        merchant_id: "merchant_7",
        operational_mode: "canonical_route_v1",
        id: "order_9"
      });
      await service.listDriverOffers("driver_1");
      const where = matchFindMany.mock.calls[0]?.[0].where;
      expect(where.driver_route.driver).toEqual(
        expect.objectContaining({ user_id: "driver_1", verified: true })
      );
    });
  });

  it("scores deterministically and applies documented component weights", () => {
    const input = {
      departureAt: new Date("2026-07-26T10:30:00.000Z"),
      departureFrom: new Date("2026-07-26T10:00:00.000Z"),
      departureUntil: new Date("2026-07-26T12:00:00.000Z"),
      requestedCapacity: 2,
      availableCapacity: 4,
      trustScore: 80,
      recentAssignments: 1
    };
    expect(canonicalScoring.scoreCandidate(input)).toEqual(canonicalScoring.scoreCandidate(input));
    expect(canonicalScoring.scoreCandidate(input)).toEqual({
      score: 0.6725,
      departureDeltaSeconds: 1800,
      trust: 0.8,
      fairness: 0.5
    });
  });

  it("serializers remain explicit allowlists", () => {
    const summary = canonicalMatchingSerializers.offerResponse(offer);
    expect(summary.offer_version).toBe("canonical_route_match_v1");
    expect(summary).not.toHaveProperty("reservation_id");
    expect(summary).not.toHaveProperty("scoring_breakdown");
  });

  it("rejects shared and unknown versions in the single-offer serializer", () => {
    expect(() => canonicalMatchingSerializers.offerResponse({
      ...offer,
      canonical_match_version: "canonical_shared_trip_match_v1"
    })).toThrow("canonical_offer_version_mismatch");
    expect(() => canonicalMatchingSerializers.offerResponse({
      ...offer,
      canonical_match_version: "future_match_v2"
    })).toThrow("canonical_offer_version_mismatch");
  });

  it("does not expose database integrity keys through driver offer serializers", () => {
    const encoded = JSON.stringify(canonicalMatchingSerializers.offerResponse(offer));
    for (const field of [
      "demand_checksum",
      "active_driver_route_key",
      "accepted_driver_route_key",
      "canonical_assignment_key"
    ]) {
      expect(encoded).not.toContain(field);
    }
    expect(encoded).not.toContain("must-not-leak");
  });

  it("keeps the internal runner unavailable in production-like configuration", async () => {
    const production = createConfig({
      APP_ENV: "production",
      DATABASE_URL: "mysql://database-user:database-password@db.internal:3306/darb",
      JWT_SECRET: "production-jwt-secret-with-more-than-thirty-two-characters",
      REFRESH_TOKEN_PEPPER: "production-refresh-secret-with-more-than-thirty-two-characters",
      CORS_ORIGINS: "https://admin.darb.example",
      APP_RELEASE: "m7c3a-test",
      TRUST_PROXY: "none"
    });
    const service = createCanonicalMatchingService({} as never, production);
    await expect(service.run()).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.expire()).rejects.toMatchObject({ statusCode: 404 });
  });
});
