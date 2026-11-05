import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
  mapPlace: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    groupBy: vi.fn()
  },
  mapPlaceReport: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { importPlaces, loadMapPlaceCategories, loadPlacesFile, MAP_PLACE_CATEGORIES, OSM_PLACES_FILE } = await import("../services/mapPlaces.js");

const users: Record<string, { id: string; role: string; name: string; phone: string; demo_account: boolean }> = {
  admin_1: { id: "admin_1", role: "admin", name: "Admin", phone: "+7", demo_account: false },
  driver_1: { id: "driver_1", role: "driver", name: "Driver", phone: "+3", demo_account: false },
  merchant_1: { id: "merchant_1", role: "merchant", name: "Merchant", phone: "+4", demo_account: false }
};

function auth(id: keyof typeof users) {
  const token = jwt.sign({ role: users[id].role, sid: `session_${id}`, ver: 1 }, "test-only-jwt-secret-with-at-least-thirty-two-characters", {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

const stamp = new Date("2026-11-04T09:00:00.000Z");
const row = (id: string, category: string, latitude: string, longitude: string, extra: Record<string, unknown> = {}) => ({
  id,
  category,
  name_ar: "مقهى",
  name_en: null,
  latitude,
  longitude,
  phone: null,
  opening_hours: "Mo-Su 08:00-22:00",
  city: "ramallah",
  source: "osm",
  osm_id: `node/${id}`,
  active: true,
  admin_edited: false,
  created_at: stamp,
  updated_at: stamp,
  ...extra
});

describe("map places", () => {
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
  });

  describe("category list", () => {
    it("is the data file the importer, the API and the apps share", () => {
      expect(loadMapPlaceCategories()).toEqual(MAP_PLACE_CATEGORIES);
      for (const key of ["cafe", "restaurant", "hospital", "clinic", "pharmacy", "fuel"]) expect(MAP_PLACE_CATEGORIES).toContain(key);
    });
  });

  describe("GET /map/places", () => {
    const bbox = "31.8,35.1,32.0,35.3";

    it("needs a signed-in user but any role may read", async () => {
      await request(createApp()).get(`/api/v1/map/places?bbox=${bbox}`).expect(401);
      prismaMock.mapPlace.findMany.mockResolvedValue([]);
      for (const id of ["driver_1", "merchant_1", "admin_1"] as const) {
        await request(createApp()).get(`/api/v1/map/places?bbox=${bbox}`).set(auth(id)).expect(200);
      }
    });

    it("answers the active places in the box nearest to its centre first, with attribution and cache headers", async () => {
      prismaMock.mapPlace.findMany.mockResolvedValue([
        row("far", "cafe", "31.99", "35.29"),
        row("near", "cafe", "31.90", "35.20"),
        row("mid", "fuel", "31.95", "35.20")
      ]);
      const response = await request(createApp()).get(`/api/v1/map/places?bbox=${bbox}&categories=cafe,fuel`).set(auth("driver_1")).expect(200);
      expect(response.body.places.map((place: { id: string }) => place.id)).toEqual(["near", "mid", "far"]);
      expect(response.body.places[0]).toEqual({
        id: "near",
        category: "cafe",
        name_ar: "مقهى",
        name_en: null,
        lat: 31.9,
        lng: 35.2,
        phone: null,
        opening_hours: "Mo-Su 08:00-22:00"
      });
      expect(response.body.truncated).toBe(false);
      expect(response.body.attribution).toContain("OpenStreetMap");
      expect(response.headers["cache-control"]).toBe("private, max-age=300");
      expect(response.headers.etag).toBeTruthy();
      const query = prismaMock.mapPlace.findMany.mock.calls[0][0];
      expect(query.where).toEqual({
        active: true,
        latitude: { gte: 31.8, lte: 32 },
        longitude: { gte: 35.1, lte: 35.3 },
        category: { in: ["cafe", "fuel"] }
      });
    });

    it("bounds the answer and says when more matched", async () => {
      prismaMock.mapPlace.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, i) => row(`p${i}`, "cafe", "31.9", `35.${10 + i}`)));
      const response = await request(createApp()).get(`/api/v1/map/places?bbox=${bbox}&limit=3`).set(auth("driver_1")).expect(200);
      expect(response.body.places).toHaveLength(3);
      expect(response.body.truncated).toBe(true);
    });

    it("refuses a missing, malformed, oversized or out-of-area box, unknown categories and huge limits", async () => {
      for (const query of [
        "",
        "bbox=1,2,3",
        "bbox=a,b,c,d",
        "bbox=32,35,31,36",
        "bbox=31.0,34.5,33.0,35.5",
        "bbox=10,10,11,11",
        `bbox=${bbox}&categories=casino`,
        `bbox=${bbox}&limit=100000`
      ]) {
        await request(createApp()).get(`/api/v1/map/places?${query}`).set(auth("driver_1")).expect(400);
      }
      expect(prismaMock.mapPlace.findMany).not.toHaveBeenCalled();
    });
  });

  describe("POST /map/places/:id/report", () => {
    it("records one report and answers 202; repeating it changes nothing", async () => {
      prismaMock.mapPlace.findUnique.mockResolvedValue({ id: "p1" });
      prismaMock.mapPlaceReport.create.mockResolvedValue({ id: "r1" });
      await request(createApp()).post("/api/v1/map/places/p1/report").set(auth("driver_1")).send({ reason: "closed", note: " gone " }).expect(202);
      expect(prismaMock.mapPlaceReport.create).toHaveBeenCalledWith({
        data: { place_id: "p1", reporter_id: "driver_1", reason: "closed", note: "gone" }
      });
      const { Prisma } = await import("../generated/prisma/client.js");
      prismaMock.mapPlaceReport.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));
      await request(createApp()).post("/api/v1/map/places/p1/report").set(auth("driver_1")).send({ reason: "closed" }).expect(202);
    });

    it("refuses unknown reasons and unknown places", async () => {
      prismaMock.mapPlace.findUnique.mockResolvedValue(null);
      await request(createApp()).post("/api/v1/map/places/p1/report").set(auth("driver_1")).send({ reason: "spam" }).expect(400);
      await request(createApp()).post("/api/v1/map/places/p1/report").set(auth("driver_1")).send({ reason: "closed" }).expect(404);
    });
  });

  describe("admin", () => {
    it("is for admins only", async () => {
      await request(createApp()).get("/api/v1/admin/map-places").set(auth("driver_1")).expect(403);
      await request(createApp()).patch("/api/v1/admin/map-places/p1").set(auth("driver_1")).send({ active: false }).expect(403);
      await request(createApp()).get("/api/v1/admin/map-place-reports").set(auth("driver_1")).expect(403);
    });

    it("lists with filters and paging", async () => {
      prismaMock.mapPlace.findMany.mockResolvedValue([row("p1", "cafe", "31.9", "35.2")]);
      prismaMock.mapPlace.count.mockResolvedValue(1);
      const response = await request(createApp())
        .get("/api/v1/admin/map-places?category=cafe&city=ramallah&active=false&search=%D9%85&page=2&limit=10")
        .set(auth("admin_1"))
        .expect(200);
      expect(response.body).toMatchObject({ page: 2, limit: 10, total: 1 });
      expect(response.body.places[0]).toMatchObject({ id: "p1", latitude: 31.9, longitude: 35.2, admin_edited: false });
      const query = prismaMock.mapPlace.findMany.mock.calls[0][0];
      expect(query.skip).toBe(10);
      expect(query.where).toEqual({
        category: "cafe",
        city: "ramallah",
        active: false,
        OR: [{ name_ar: { contains: "م" } }, { name_en: { contains: "م" } }]
      });
    });

    it("summarises counts per category and city, active places only for cities", async () => {
      prismaMock.mapPlace.groupBy.mockResolvedValue([
        { category: "cafe", city: "ramallah", active: true, _count: { _all: 4 } },
        { category: "cafe", city: "ramallah", active: false, _count: { _all: 1 } },
        { category: "fuel", city: null, active: true, _count: { _all: 2 } }
      ]);
      const response = await request(createApp()).get("/api/v1/admin/map-places/summary").set(auth("admin_1")).expect(200);
      expect(response.body.by_category).toEqual({ cafe: { active: 4, inactive: 1 }, fuel: { active: 2, inactive: 0 } });
      expect(response.body.by_city).toEqual({ ramallah: 4, other: 2 });
    });

    it("adds a place by hand, inside the West Bank, with a name, and audits it", async () => {
      prismaMock.mapPlace.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(row("new1", String(data.category), "31.95", "35.2", data)));
      const response = await request(createApp())
        .post("/api/v1/admin/map-places")
        .set(auth("admin_1"))
        .send({ category: "pharmacy", name_ar: "صيدلية الأمل", latitude: 31.95, longitude: 35.2, phone: "+970 2 123 4567" })
        .expect(201);
      expect(response.body.place).toMatchObject({ id: "new1", category: "pharmacy", source: "admin", admin_edited: true });
      expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ user_id: "admin_1", entity_type: "MapPlace", entity_id: "new1", metadata: expect.objectContaining({ action: "map_place_created" }) })
      });
      for (const body of [
        { category: "pharmacy", latitude: 31.95, longitude: 35.2 }, // no name
        { category: "casino", name_ar: "x1", latitude: 31.95, longitude: 35.2 },
        { category: "pharmacy", name_ar: "x1", latitude: 31.5, longitude: 34.45 }, // Gaza
        { category: "pharmacy", name_ar: "x1", latitude: 31.95, longitude: 35.2, phone: "abc" },
        { category: "pharmacy", name_ar: "x1", latitude: 31.95, longitude: 35.2, extra: 1 }
      ]) {
        await request(createApp()).post("/api/v1/admin/map-places").set(auth("admin_1")).send(body).expect(400);
      }
    });

    it("disables a place, marks it edited so imports leave it alone, and audits before and after", async () => {
      prismaMock.mapPlace.findUnique.mockResolvedValue(row("p1", "cafe", "31.9", "35.2"));
      prismaMock.mapPlace.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(row("p1", "cafe", "31.9", "35.2", data)));
      const response = await request(createApp()).patch("/api/v1/admin/map-places/p1").set(auth("admin_1")).send({ active: false }).expect(200);
      expect(response.body.place).toMatchObject({ active: false, admin_edited: true });
      expect(prismaMock.mapPlace.update.mock.calls[0][0].data).toEqual({ active: false, admin_edited: true });
      expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ metadata: expect.objectContaining({ action: "map_place_disabled", before: expect.objectContaining({ active: true }) }) })
      });
      await request(createApp()).patch("/api/v1/admin/map-places/p1").set(auth("admin_1")).send({}).expect(400);
      prismaMock.mapPlace.findUnique.mockResolvedValue(null);
      await request(createApp()).patch("/api/v1/admin/map-places/gone").set(auth("admin_1")).send({ active: true }).expect(404);
    });

    it("lists open reports and closes one, optionally switching the place off", async () => {
      prismaMock.mapPlaceReport.findMany.mockResolvedValue([
        { id: "r1", place_id: "p1", reason: "closed", note: null, status: "open", created_at: stamp, resolved_at: null, place: row("p1", "cafe", "31.9", "35.2") }
      ]);
      prismaMock.mapPlaceReport.count.mockResolvedValue(1);
      const list = await request(createApp()).get("/api/v1/admin/map-place-reports").set(auth("admin_1")).expect(200);
      expect(list.body.reports[0]).toMatchObject({ id: "r1", reason: "closed", place: { id: "p1" } });
      expect(prismaMock.mapPlaceReport.findMany.mock.calls[0][0].where).toEqual({ status: "open" });

      prismaMock.mapPlaceReport.findUnique.mockResolvedValue({ id: "r1", place_id: "p1" });
      prismaMock.mapPlaceReport.update.mockResolvedValue({ id: "r1", status: "resolved", resolved_at: stamp });
      await request(createApp()).patch("/api/v1/admin/map-place-reports/r1").set(auth("admin_1")).send({ status: "resolved", deactivate_place: true }).expect(200);
      expect(prismaMock.mapPlace.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { active: false, admin_edited: true } });
      expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ entity_type: "MapPlaceReport", metadata: expect.objectContaining({ action: "map_place_report_reviewed", place_deactivated: true }) })
      });
      await request(createApp()).patch("/api/v1/admin/map-place-reports/r1").set(auth("admin_1")).send({ status: "open" }).expect(400);
    });
  });

  describe("importer", () => {
    const place = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      c: "cafe",
      ar: "مقهى",
      en: null,
      lat: 31.9,
      lng: 35.2,
      ph: null,
      oh: null,
      city: "ramallah",
      ...extra
    });

    it("the committed extract matches the schema and the category list", () => {
      const places = loadPlacesFile(OSM_PLACES_FILE);
      expect(places.length).toBeGreaterThan(100);
      expect(new Set(places.map((entry) => entry.id)).size).toBe(places.length);
    });

    it("creates new places, updates changed ones, leaves edited rows alone and never deactivates by default", async () => {
      const existing = (id: string, extra: Record<string, unknown> = {}) => ({
        ...row(id, "cafe", "31.9", "35.2", { osm_id: id, name_ar: "مقهى", opening_hours: null }),
        ...extra
      });
      prismaMock.mapPlace.findMany.mockResolvedValue([
        existing("node/1"), // unchanged
        existing("node/2", { name_ar: "قديم" }), // changed upstream
        existing("node/3", { admin_edited: true, name_ar: "عدلته" }), // admin edited
        existing("node/9") // no longer in the extract
      ]);
      const result = await importPlaces(prismaMock as never, [place("node/1"), place("node/2"), place("node/3"), place("node/4")]);
      expect(result).toEqual({ created: 1, updated: 1, unchanged: 1, skipped_admin_edited: 1, deactivated: 0 });
      expect(prismaMock.mapPlace.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.mapPlace.createMany.mock.calls[0][0].data).toHaveLength(1);
      expect(prismaMock.mapPlace.updateMany).not.toHaveBeenCalled();

      prismaMock.mapPlace.update.mockClear();
      prismaMock.mapPlace.createMany.mockClear();
      const dry = await importPlaces(prismaMock as never, [place("node/4")], { deactivateMissing: true, dryRun: true });
      expect(dry.deactivated).toBe(3); // node/1, node/2, node/9 are active and unedited; node/3 is protected
      expect(prismaMock.mapPlace.createMany).not.toHaveBeenCalled();
      expect(prismaMock.mapPlace.updateMany).not.toHaveBeenCalled();
    });
  });
});
