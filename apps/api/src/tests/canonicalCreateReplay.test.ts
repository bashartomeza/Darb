import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const idempotency = vi.hoisted(() => ({ claimIdempotency: vi.fn(), completeIdempotency: vi.fn() }));
vi.mock("../lib/idempotency.js", () => idempotency);
vi.mock("../lib/prisma.js", () => ({ prisma: {} }));
const { createCanonicalDemandService } = await import("../services/canonicalDemand.js");
const { createDriverAvailabilityService } = await import("../services/driverAvailability.js");

const actor = { id: "owner_1", idempotencyKey: "persisted-key" };
const from = new Date("2020-01-01T12:00:00Z");
const until = new Date("2020-01-01T13:00:00Z");

describe("canonical creation replay after departure", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["passenger", "merchant", "driver"] as const)("replays a completed %s creation even after its original valid departure passes", async (kind) => {
    const resource = { id: "original_resource" };
    const resourceType = kind === "passenger" ? "PassengerRequest" : kind === "merchant" ? "MerchantOrder" : "DriverRoute";
    idempotency.claimIdempotency.mockResolvedValue({ kind: "replay", record: { resource_type: resourceType, resource_id: resource.id } });
    const db = {
      $transaction: vi.fn(async (callback) => callback(db)),
      passengerRequest: { findFirst: vi.fn().mockResolvedValue(resource), create: vi.fn() },
      merchantOrder: { findFirst: vi.fn().mockResolvedValue(resource), create: vi.fn() },
      driverRoute: { findFirst: vi.fn().mockResolvedValue(resource), create: vi.fn() },
      driverProfile: { findUnique: vi.fn() },
    };
    const demand = createCanonicalDemandService(db as never);
    const result = kind === "passenger"
      ? demand.createPassengerRequest({ routeVersionId: "route_1", pickupStopId: "pickup", dropoffStopId: "dropoff",
        requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 1 }, actor)
      : kind === "merchant"
        ? demand.createMerchantOrder({ routeVersionId: "route_1", pickupStopId: "pickup", requestedDepartureFrom: from,
          requestedDepartureUntil: until, parcels: [{ destinationStopId: "dropoff", size: "S", priority: "normal" }] }, actor)
        : createDriverAvailabilityService(db as never).createOneOff({ routeVersionId: "route_1", departureAt: from,
          availabilityWindowEnd: until, totalSeats: 1, totalParcelCapacity: 0 }, actor);
    await expect(result).resolves.toEqual({ resource, replayed: true });
    expect(idempotency.claimIdempotency).toHaveBeenCalledWith(db, expect.objectContaining({ retainCompleted: true }));
    const lookup = kind === "passenger" ? db.passengerRequest.findFirst : kind === "merchant" ? db.merchantOrder.findFirst : db.driverRoute.findFirst;
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining(
      kind === "passenger" ? { passenger_id: actor.id } : kind === "merchant" ? { merchant_id: actor.id } : { driver: { user_id: actor.id } },
    ) }));
    expect(db.passengerRequest.create).not.toHaveBeenCalled();
    expect(db.merchantOrder.create).not.toHaveBeenCalled();
    expect(db.driverRoute.create).not.toHaveBeenCalled();
    expect(db.driverProfile.findUnique).not.toHaveBeenCalled();
  });

  it.each(["passenger", "merchant", "driver"] as const)("returns %s payload conflict before dynamic departure validation", async (kind) => {
    idempotency.claimIdempotency.mockResolvedValue({ kind: "conflict", record: {} });
    const db = { $transaction: vi.fn(async callback => callback(db)) };
    const demand = createCanonicalDemandService(db as never);
    const result = kind === "passenger"
      ? demand.createPassengerRequest({ routeVersionId: "route_1", pickupStopId: "pickup", dropoffStopId: "dropoff",
        requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 2 }, actor)
      : kind === "merchant"
        ? demand.createMerchantOrder({ routeVersionId: "route_1", pickupStopId: "pickup", requestedDepartureFrom: from,
          requestedDepartureUntil: until, parcels: [{ destinationStopId: "dropoff", size: "M", priority: "normal" }] }, actor)
        : createDriverAvailabilityService(db as never).createOneOff({ routeVersionId: "route_1", departureAt: from,
          availabilityWindowEnd: until, totalSeats: 2, totalParcelCapacity: 0 }, actor);
    await expect(result).rejects.toMatchObject({ statusCode: 409, message: "idempotency_conflict" });
  });

  it.each(["passenger", "merchant", "driver"] as const)("still rejects a new %s creation whose departure is past", async (kind) => {
    idempotency.claimIdempotency.mockResolvedValue({ kind: "claimed", record: { id: "new_claim" } });
    const db = { $transaction: vi.fn(async callback => callback(db)) };
    const demand = createCanonicalDemandService(db as never);
    const result = kind === "passenger"
      ? demand.createPassengerRequest({ routeVersionId: "route_1", pickupStopId: "pickup", dropoffStopId: "dropoff",
        requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 1 }, actor)
      : kind === "merchant"
        ? demand.createMerchantOrder({ routeVersionId: "route_1", pickupStopId: "pickup", requestedDepartureFrom: from,
          requestedDepartureUntil: until, parcels: [{ destinationStopId: "dropoff", size: "S", priority: "normal" }] }, actor)
        : createDriverAvailabilityService(db as never).createOneOff({ routeVersionId: "route_1", departureAt: from,
          availabilityWindowEnd: until, totalSeats: 1, totalParcelCapacity: 0 }, actor);
    await expect(result).rejects.toMatchObject({ statusCode: 400 });
  });

  it.each(["passenger", "merchant", "driver"] as const)("isolates %s creation keys by actor and preserves its established operation scope", async (kind) => {
    idempotency.claimIdempotency.mockResolvedValue({ kind: "claimed", record: { id: "new_claim" } });
    const db = { $transaction: vi.fn(async callback => callback(db)) };
    const demand = createCanonicalDemandService(db as never);
    const create = (owner: typeof actor) => kind === "passenger"
      ? demand.createPassengerRequest({ routeVersionId: "route_1", pickupStopId: "pickup", dropoffStopId: "dropoff",
        requestedDepartureFrom: from, requestedDepartureUntil: until, passengerCount: 1 }, owner)
      : kind === "merchant"
        ? demand.createMerchantOrder({ routeVersionId: "route_1", pickupStopId: "pickup", requestedDepartureFrom: from,
          requestedDepartureUntil: until, parcels: [{ destinationStopId: "dropoff", size: "S", priority: "normal" }] }, owner)
        : createDriverAvailabilityService(db as never).createOneOff({ routeVersionId: "route_1", departureAt: from,
          availabilityWindowEnd: until, totalSeats: 1, totalParcelCapacity: 0 }, owner);
    await expect(create(actor)).rejects.toMatchObject({ statusCode: 400 });
    await expect(create({ ...actor, id: "other_owner" })).rejects.toMatchObject({ statusCode: 400 });
    const original = idempotency.claimIdempotency.mock.calls[0]![1];
    const other = idempotency.claimIdempotency.mock.calls[1]![1];
    expect(original.keyDigest).toBe(other.keyDigest);
    expect(original.scopeDigest).not.toBe(other.scopeDigest);
    expect(original.requestDigest).not.toBe(other.requestDigest);
    const operationScope = kind === "driver" ? `driver-availability:${actor.id}:route_1`
      : `canonical_${kind}_request_create:${actor.id}`.replace("merchant_request", "merchant_order");
    expect(original.scopeDigest).toBe(createHash("sha256").update(operationScope).digest("hex"));
  });
});
