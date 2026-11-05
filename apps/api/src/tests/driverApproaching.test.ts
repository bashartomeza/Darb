import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  trip: { findUnique: vi.fn() },
  notification: { findFirst: vi.fn(), create: vi.fn() },
  locationEvent: { findFirst: vi.fn() }
}));

const { evaluateApproaching, hasRealPickupCoordinate, maybeNotifyDriverApproaching, maybeNotifyDriverApproachingFromLatest } = await import(
  "../services/driverApproaching.js"
);

const pickup = { lat: 31.9, lng: 35.2 };
const thresholds = { radiusKm: 1, etaMinutes: 0, assumedSpeedKmh: 30 };
// One degree of latitude is about 111.19 km on the haversine sphere used by geo.ts.
const northOf = (km: number) => ({ lat: pickup.lat + km / 111.194926, lng: pickup.lng });

function trip(status = "accepted") {
  return {
    id: "trip_1",
    status,
    passenger_request: { passenger_id: "passenger_1", pickup_lat: "31.900000", pickup_lng: "35.200000" }
  };
}

describe("evaluateApproaching", () => {
  it("fires inside the radius and not outside it", () => {
    expect(evaluateApproaching(northOf(0.95), pickup, thresholds)?.reason).toBe("radius");
    expect(evaluateApproaching(northOf(1.05), pickup, thresholds)).toBeNull();
  });

  it("treats the exact boundary as inside", () => {
    expect(evaluateApproaching(pickup, pickup, { ...thresholds, radiusKm: 0.05 })?.distanceKm).toBe(0);
    const at = northOf(1);
    const { distanceKm } = evaluateApproaching(at, pickup, { ...thresholds, radiusKm: 5 })!;
    expect(evaluateApproaching(at, pickup, { ...thresholds, radiusKm: distanceKm })).not.toBeNull();
    expect(evaluateApproaching(at, pickup, { ...thresholds, radiusKm: distanceKm - 1e-9 })).toBeNull();
  });

  it("honours the ETA trigger only when enabled", () => {
    const far = northOf(2.5); // 5 minutes at 30 km/h
    expect(evaluateApproaching(far, pickup, thresholds)).toBeNull();
    expect(evaluateApproaching(far, pickup, { ...thresholds, etaMinutes: 5.1 })?.reason).toBe("eta");
    expect(evaluateApproaching(far, pickup, { ...thresholds, etaMinutes: 4.9 })).toBeNull();
  });

  it("ignores non-finite coordinates", () => {
    expect(evaluateApproaching({ lat: NaN, lng: 0 }, pickup, thresholds)).toBeNull();
  });
});

describe("maybeNotifyDriverApproaching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.trip.findUnique.mockResolvedValue(trip());
    db.notification.findFirst.mockResolvedValue(null);
    db.notification.create.mockResolvedValue({});
  });

  it("creates one passenger notification without coordinates or distance", async () => {
    expect(await maybeNotifyDriverApproaching(db as never, "trip_1", northOf(0.5), thresholds)).toBe(true);
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    const data = db.notification.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      user_id: "passenger_1",
      type: "driver_approaching",
      entity_id: "trip_1",
      dedupe_key: "driver_approaching:trip_1",
      params: { reason: "radius" }
    });
    expect(JSON.stringify(data)).not.toMatch(/lat|lng|31\.|35\.|distance/i);
  });

  it("does nothing when the driver is still far away", async () => {
    expect(await maybeNotifyDriverApproaching(db as never, "trip_1", northOf(3), thresholds)).toBe(false);
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("is idempotent: an existing notification blocks a second one", async () => {
    db.notification.findFirst.mockResolvedValue({ id: "n1" });
    expect(await maybeNotifyDriverApproaching(db as never, "trip_1", northOf(0.5), thresholds)).toBe(false);
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("survives a unique-key race without throwing", async () => {
    db.notification.create.mockRejectedValue(new Error("Unique constraint failed"));
    await expect(maybeNotifyDriverApproaching(db as never, "trip_1", northOf(0.5), thresholds)).resolves.toBe(true);
  });

  it.each(["picked_up", "in_transit", "delivered", "completed", "cancelled", "failed"])(
    "never fires for a %s trip",
    async (status) => {
      db.trip.findUnique.mockResolvedValue(trip(status));
      expect(await maybeNotifyDriverApproaching(db as never, "trip_1", pickup, thresholds)).toBe(false);
      expect(db.notification.create).not.toHaveBeenCalled();
    }
  );

  it.each(["created", "accepted", "pickup_started"])("fires for a %s trip", async (status) => {
    db.trip.findUnique.mockResolvedValue(trip(status));
    expect(await maybeNotifyDriverApproaching(db as never, "trip_1", pickup, thresholds)).toBe(true);
  });

  it("skips trips without a passenger request (parcel trips)", async () => {
    db.trip.findUnique.mockResolvedValue({ id: "trip_1", status: "accepted", passenger_request: null });
    expect(await maybeNotifyDriverApproaching(db as never, "trip_1", pickup, thresholds)).toBe(false);
  });

  it("never throws when the database fails", async () => {
    db.trip.findUnique.mockRejectedValue(new Error("down"));
    await expect(maybeNotifyDriverApproaching(db as never, "trip_1", pickup, thresholds)).resolves.toBe(false);
  });

  it("needs a driver position for a request with a real pickup coordinate", async () => {
    db.trip.findUnique.mockResolvedValue(trip("pickup_started"));
    expect(await maybeNotifyDriverApproaching(db as never, "trip_1", null, thresholds)).toBe(false);
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  describe("route request (pickup typed as text, coordinate is the city centre)", () => {
    const routeTrip = (status: string) => ({
      ...trip(status),
      passenger_request: { ...trip(status).passenger_request, pickup_details: "PPU main gate" }
    });

    it.each(["created", "accepted"])("never fires from a position while %s, even at the city centre", async (status) => {
      db.trip.findUnique.mockResolvedValue(routeTrip(status));
      expect(await maybeNotifyDriverApproaching(db as never, "trip_1", pickup, thresholds)).toBe(false);
      expect(await maybeNotifyDriverApproaching(db as never, "trip_1", null, thresholds)).toBe(false);
      expect(db.notification.create).not.toHaveBeenCalled();
    });

    it("fires once when the driver starts the pickup, wherever the driver is", async () => {
      db.trip.findUnique.mockResolvedValue(routeTrip("pickup_started"));
      expect(await maybeNotifyDriverApproaching(db as never, "trip_1", northOf(40), thresholds)).toBe(true);
      expect(db.notification.create.mock.calls[0][0].data).toMatchObject({
        dedupe_key: "driver_approaching:trip_1",
        params: { reason: "pickup_started" }
      });
      db.notification.findFirst.mockResolvedValue({ id: "n1" });
      expect(await maybeNotifyDriverApproaching(db as never, "trip_1", pickup, thresholds)).toBe(false);
      expect(db.notification.create).toHaveBeenCalledTimes(1);
    });

    it("treats blank typed text as no text", () => {
      expect(hasRealPickupCoordinate({ pickup_details: "  " })).toBe(true);
      expect(hasRealPickupCoordinate({ pickup_details: null })).toBe(true);
      expect(hasRealPickupCoordinate({ pickup_details: "Gate" })).toBe(false);
    });
  });
});

describe("maybeNotifyDriverApproachingFromLatest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.trip.findUnique.mockResolvedValue(trip("pickup_started"));
    db.notification.findFirst.mockResolvedValue(null);
    db.notification.create.mockResolvedValue({});
  });

  it("uses the latest recorded location with the configured default radius", async () => {
    db.locationEvent.findFirst.mockResolvedValue({ lat: "31.903000", lng: "35.200000" });
    expect(await maybeNotifyDriverApproachingFromLatest(db as never, "trip_1")).toBe(true);
  });

  it("does nothing when no location was recorded", async () => {
    db.locationEvent.findFirst.mockResolvedValue(null);
    expect(await maybeNotifyDriverApproachingFromLatest(db as never, "trip_1")).toBe(false);
  });

  it("fires for a route request at pickup_started even before any position", async () => {
    db.locationEvent.findFirst.mockResolvedValue(null);
    db.trip.findUnique.mockResolvedValue({
      ...trip("pickup_started"),
      passenger_request: { ...trip().passenger_request, pickup_details: "PPU main gate" }
    });
    expect(await maybeNotifyDriverApproachingFromLatest(db as never, "trip_1")).toBe(true);
  });
});
