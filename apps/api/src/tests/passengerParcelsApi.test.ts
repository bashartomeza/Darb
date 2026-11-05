import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
const { createApp } = await import("../app.js");
const { serializePassengerParcel } = await import("../services/passengerParcels.js");

const environment = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
  JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent",
  MULTI_ROUTE_ENTRY_ENABLED: "true"
};
const enabled = createConfig(environment);
const disabled = createConfig({ ...environment, MULTI_ROUTE_ENTRY_ENABLED: "false" });

function auth(id: string, role: "passenger" | "driver" | "merchant") {
  const token = jwt.sign({ role, sid: `session_${role}_${id}`, ver: 1 }, environment.JWT_SECRET, { subject: id, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

const detail = {
  id: "detail_1", order_id: "order_1", sender_id: "p1", size: "S", note: null,
  receiver_name: "Sami", receiver_phone: "+970591234567", receiver_purged_at: null, created_at: new Date(),
  order: {
    status: "submitted", pickup_label: "A", route_version_id: "route_1", pickup_stop_id: "stop_a",
    requested_departure_from: new Date(), requested_departure_until: new Date(),
    parcels: [{ status: "pending", destination_label: "B", destination_stop_id: "stop_b" }],
    canonical_dispatch: { status: "pending" }
  }
};

const body = {
  route_version_id: "route_1", pickup_stop_id: "stop_a", dropoff_stop_id: "stop_b",
  requested_departure_from: "2030-01-01T10:00:00Z", requested_departure_until: "2030-01-01T11:00:00Z",
  size: "S", receiver_name: "Sami", receiver_phone: "0591234567", forbidden_items_acknowledged: true
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    const [, role, id] = where.id.split("_");
    return {
      id: where.id, user_id: id,
      user: { email_verified_at: new Date(), id, role, account_status: "active", security_version: 1 },
      security_version_at_issue: 1, expires_at: new Date(Date.now() + 60_000), revoked_at: null
    };
  });
  prismaMock.authSession.update.mockResolvedValue({});
});

function setup() {
  const service = {
    create: vi.fn().mockResolvedValue({ parcel: detail, replayed: false }),
    list: vi.fn().mockResolvedValue([detail]),
    get: vi.fn().mockResolvedValue(detail),
    cancel: vi.fn().mockResolvedValue(detail)
  };
  return { service, app: createApp(enabled, { passengerParcelService: service as never }) };
}

describe("passenger parcel API", () => {
  it("creates a parcel with a normalised receiver phone and masks it in the response", async () => {
    const { app, service } = setup();
    const response = await request(app).post("/api/v1/passenger/parcels").set(auth("p1", "passenger")).set("Idempotency-Key", "parcel-key-0001").send(body);
    expect(response.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ receiverPhone: "+970591234567", size: "S", forbiddenItemsAcknowledged: true }),
      expect.objectContaining({ id: "p1", idempotencyKey: "parcel-key-0001" })
    );
    expect(JSON.stringify(response.body)).not.toContain("+970591234567");
    expect(response.body.parcel).toMatchObject({ tracking_state: "searching", can_cancel: true });
  });

  it("requires the forbidden-items acknowledgement", async () => {
    const { app, service } = setup();
    const response = await request(app).post("/api/v1/passenger/parcels").set(auth("p1", "passenger")).set("Idempotency-Key", "parcel-key-0001")
      .send({ ...body, forbidden_items_acknowledged: false });
    expect(response.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("rejects large parcels, bad phones, extra fields and missing idempotency keys", async () => {
    const { app, service } = setup();
    const post = (payload: object, key = "parcel-key-0001") =>
      request(app).post("/api/v1/passenger/parcels").set(auth("p1", "passenger")).set("Idempotency-Key", key).send(payload);
    expect((await post({ ...body, size: "L" })).status).toBe(400);
    expect((await post({ ...body, receiver_phone: "12345" })).status).toBe(400);
    expect((await request(app).post("/api/v1/passenger/parcels").set(auth("p1", "passenger")).send(body)).status).toBe(400);
    expect((await post({ ...body, extra: 1 })).status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("is passenger-only", async () => {
    const { app, service } = setup();
    for (const role of ["driver", "merchant"] as const) {
      const response = await request(app).post("/api/v1/passenger/parcels").set(auth("x1", role)).set("Idempotency-Key", "parcel-key-0001").send(body);
      expect(response.status).toBe(403);
    }
    expect((await request(app).get("/api/v1/passenger/parcels")).status).toBe(401);
    expect(service.create).not.toHaveBeenCalled();
  });

  it("lists, reads and cancels only through the signed-in passenger's id", async () => {
    const { app, service } = setup();
    await request(app).get("/api/v1/passenger/parcels").set(auth("p1", "passenger")).expect(200);
    await request(app).get("/api/v1/passenger/parcels/order_1").set(auth("p1", "passenger")).expect(200);
    await request(app).patch("/api/v1/passenger/parcels/order_1/cancel").send({ reason: "other" }).set(auth("p1", "passenger")).expect(200);
    expect(service.list).toHaveBeenCalledWith("p1");
    expect(service.get).toHaveBeenCalledWith("p1", "order_1");
    expect(service.cancel).toHaveBeenCalledWith("p1", "order_1", { code: "other", note: undefined });
  });

  it("stays available without multi-route entry, which only gates the canonical body", async () => {
    const { service } = setup();
    const app = createApp(disabled, { passengerParcelService: service as never });
    expect((await request(app).get("/api/v1/passenger/parcels").set(auth("p1", "passenger"))).status).toBe(200);
    const canonical = await request(app).post("/api/v1/passenger/parcels").set(auth("p1", "passenger"))
      .set("Idempotency-Key", "parcel-key-0001").send(body);
    expect(canonical.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  describe("route-based body", () => {
    const routeBody = {
      service_route_id: "service_route_hebron_bethlehem",
      pickup_details: " PPU main gate ",
      dropoff_details: "Manger Square",
      preferred_time: "2030-01-01T10:00:00Z",
      size: "M",
      receiver_name: "Sami",
      receiver_phone: "0591234567",
      forbidden_items_acknowledged: true,
      note: "books"
    };
    const legacyDetail = { ...detail, order: { ...detail.order, canonical_dispatch: null } };

    function routeSetup(replayed = false, matcher = vi.fn().mockResolvedValue({})) {
      const service = {
        create: vi.fn(),
        createForRoute: vi.fn().mockResolvedValue({ parcel: legacyDetail, replayed, handoverCode: replayed ? null : "123456" }),
        list: vi.fn(),
        get: vi.fn().mockResolvedValue(legacyDetail),
        cancel: vi.fn()
      };
      return { service, matcher, app: createApp(disabled, { passengerParcelService: service as never, passengerParcelMatcher: matcher }) };
    }

    it("creates through the legacy pipeline without multi-route entry and asks for a driver", async () => {
      const { app, service, matcher } = routeSetup();
      const response = await request(app).post("/api/v1/passenger/parcels").set(auth("p1", "passenger"))
        .set("Idempotency-Key", "parcel-key-0002").send(routeBody).expect(201);
      expect(service.createForRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceRouteId: "service_route_hebron_bethlehem", pickupDetails: "PPU main gate", dropoffDetails: "Manger Square",
          preferredTime: new Date("2030-01-01T10:00:00Z"), size: "M", receiverPhone: "+970591234567", note: "books"
        }),
        expect.objectContaining({ id: "p1", idempotencyKey: "parcel-key-0002" })
      );
      expect(service.create).not.toHaveBeenCalled();
      expect(matcher).toHaveBeenCalledWith({ id: "p1", role: "passenger" }, { merchantOrderId: "order_1" });
      expect(response.body).toMatchObject({ replayed: false, handover_code: "123456", parcel: { id: "order_1", can_cancel: true } });
      expect(JSON.stringify(response.body)).not.toContain("+970591234567");
    });

    it("keeps the parcel searching when no driver is on the route yet", async () => {
      const { HttpError } = await import("../middleware/error.js");
      const { app, matcher } = routeSetup(false, vi.fn().mockRejectedValue(new HttpError(404, "no_compatible_driver_route")));
      const response = await request(app).post("/api/v1/passenger/parcels").set(auth("p1", "passenger"))
        .set("Idempotency-Key", "parcel-key-0003").send(routeBody).expect(201);
      expect(matcher).toHaveBeenCalledOnce();
      expect(response.body.parcel.tracking_state).toBe("searching");
    });

    it("does not ask for a driver again on a replay", async () => {
      const { app, matcher } = routeSetup(true);
      const response = await request(app).post("/api/v1/passenger/parcels").set(auth("p1", "passenger"))
        .set("Idempotency-Key", "parcel-key-0004").send(routeBody).expect(200);
      expect(response.body).toMatchObject({ replayed: true, handover_code: null });
      expect(matcher).not.toHaveBeenCalled();
    });

    it.each([
      ["short details", { pickup_details: "ab" }],
      ["a large parcel", { size: "L" }],
      ["no acknowledgement", { forbidden_items_acknowledged: false }],
      ["a bad phone", { receiver_phone: "12345" }],
      ["no route", { service_route_id: undefined }]
    ])("rejects %s", async (_label, change) => {
      const { app, service } = routeSetup();
      await request(app).post("/api/v1/passenger/parcels").set(auth("p1", "passenger"))
        .set("Idempotency-Key", "parcel-key-0005").send({ ...routeBody, ...change }).expect(400);
      expect(service.createForRoute).not.toHaveBeenCalled();
    });
  });

  it("serialiser never exposes the stored receiver phone", () => {
    expect(JSON.stringify(serializePassengerParcel(detail as never))).not.toContain("970591234567");
  });
});
