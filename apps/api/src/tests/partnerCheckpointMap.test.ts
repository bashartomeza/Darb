import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { config, createConfig } from "../config.js";
import { LimitedCheckpointDirectoryService, mapLimitedPartnerResponse } from "../services/limitedCheckpointDirectory.js";
import {
  OsmCheckpointIndex,
  PartnerCheckpointMapService,
  loadOsmCheckpoints,
  normaliseArabicName,
  osmArabicNames,
  placePartnerCheckpoints,
  type OsmCheckpointFile
} from "../services/partnerCheckpointMap.js";

const db = vi.hoisted(() => ({ authSession: { findUnique: vi.fn(), update: vi.fn() } }));
vi.mock("../lib/prisma.js", () => ({ prisma: db }));
const { createApp } = await import("../app.js");

// Synthetic fixtures only: fake ids, fake times, invented-for-test places.
const osm: OsmCheckpointFile = {
  source: "test fixture",
  licence: "ODbL-1.0",
  attribution: "© OpenStreetMap contributors",
  fetched_at: "2026-11-01T00:00:00Z",
  checkpoints: [
    { id: "node/1", name: "نقطة تفتيش حوارة العسكرية الاسرائيلية", name_ar: null, lat: 32.178, lng: 35.2734 },
    { id: "node/2", name: "מחסום דיר שרף حاجز ديار شرف", name_ar: null, lat: 32.255, lng: 35.185 },
    { id: "node/3", name: "Container Checkpoint", name_ar: "حاجز وادي النار /الكونتينار", lat: 31.7422, lng: 35.2892 },
    // Same name in two far-apart places: never guessed between.
    { id: "node/4", name: null, name_ar: "حاجز التوأم", lat: 31.53, lng: 35.1 },
    { id: "node/5", name: null, name_ar: "حاجز التوأم", lat: 31.9, lng: 35.2 },
    // One checkpoint mapped as two nearby nodes.
    { id: "node/6", name: null, name_ar: "حاجز تياسير", lat: 32.3289, lng: 35.4353 },
    { id: "node/7", name: null, name_ar: "حاجز تياسير", lat: 32.329, lng: 35.4354 }
  ]
};

const partner = (rows: Array<{ id: string; city: string; checkpoint: string }>) =>
  mapLimitedPartnerResponse(
    {
      generatedAt: "2026-11-01T10:00:00Z",
      checkpoints: rows.map((row) => ({
        ...row,
        entering_status_last_updated: "2026-11-01T09:00:00",
        leaving_status_last_updated: "2026-11-01T09:30:00Z"
      }))
    },
    "2026-11-01T10:00:01Z"
  );

describe("Arabic name normalisation", () => {
  it("ignores diacritics, letter variants and generic words", () => {
    expect(normaliseArabicName("حَاجِز حوّارة")).toBe(normaliseArabicName("حوارة"));
    expect(normaliseArabicName("حاجز أريحا")).toBe("اريحا");
    expect(normaliseArabicName("معبر الكرامة")).toBe("الكرامه");
    expect(normaliseArabicName("مدخل عين يبرود")).toBe(normaliseArabicName("عين يبرود"));
    expect(normaliseArabicName("نقطة التفتيش ٥٦")).toBe("التفتيش 56");
  });

  it("reads the Arabic part of mixed-script OSM names and alternatives", () => {
    expect(osmArabicNames({ name: "מחסום דיר שרף حاجز ديار شرف", name_ar: null })).toEqual(["ديار شرف"]);
    expect(osmArabicNames({ name: "Container", name_ar: "حاجز وادي النار /الكونتينار" })).toEqual(["وادي النار", "الكونتينار"]);
  });
});

describe("placing partner rows", () => {
  const index = new OsmCheckpointIndex(osm.checkpoints);

  it("pins only exact name matches, keeps status unknown and lists the rest", () => {
    const result = placePartnerCheckpoints(
      partner([
        { id: "p1", city: "نابلس", checkpoint: "حوارة" },
        { id: "p2", city: "نابلس", checkpoint: "دير شرف" },
        { id: "p3", city: "بيت لحم", checkpoint: "وادي النار - الكونتينر" },
        { id: "p4", city: "القدس", checkpoint: "التوأم" },
        { id: "p5", city: "أريحا - طوباس", checkpoint: "تياسير" },
        { id: "p6", city: "الخليل", checkpoint: "تياسير" }
      ]),
      index,
      osm
    );
    expect(result.checkpoints.map((c) => [c.id, c.position_osm_id])).toEqual([
      ["aweenrayeh:p1", "node/1"],
      ["aweenrayeh:p3", "node/3"],
      ["aweenrayeh:p5", "node/6"]
    ]);
    expect(result.checkpoints.every((c) => c.status === "unknown")).toBe(true);
    expect(result.checkpoints[0]).toMatchObject({
      name_ar: "حوارة",
      city: "نابلس",
      latitude: 32.178,
      longitude: 35.2734,
      entering_status_last_updated: "2026-11-01T09:00:00",
      leaving_status_last_updated: "2026-11-01T09:30:00Z",
      timezone_specified: false,
      position_source: "openstreetmap"
    });
    // "دير شرف" is not "ديار شرف": no fuzzy guess. p4 is ambiguous, p6 is in another city.
    expect(result.unplaced.map((c) => [c.id, c.reason])).toEqual([
      ["aweenrayeh:p2", "no_name_match"],
      ["aweenrayeh:p4", "ambiguous"],
      ["aweenrayeh:p6", "outside_city"]
    ]);
    expect(result.unplaced[0]).not.toHaveProperty("latitude");
    expect(result.position_attribution).toContain("OpenStreetMap");
  });

  it("the committed OSM extract loads and carries its licence", () => {
    const file = loadOsmCheckpoints();
    expect(file.licence).toBe("ODbL-1.0");
    expect(file.attribution).toContain("OpenStreetMap");
    for (const entry of file.checkpoints) {
      expect(entry.lat).toBeGreaterThan(31.2);
      expect(entry.lat).toBeLessThan(32.6);
      expect(entry.lng).toBeGreaterThan(34.85);
      expect(entry.lng).toBeLessThan(35.6);
    }
  });
});

const env = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://synthetic:unused@localhost:59998/limited",
  JWT_SECRET: "limited-synthetic-jwt-secret-over-thirty-two-characters",
  LOG_LEVEL: "silent"
};
const auth = (role: string) => ({
  Authorization: `Bearer ${jwt.sign({ role, sid: "session", ver: 1 }, config.jwtSecret, { subject: "actor", expiresIn: "1h" })}`
});

describe("GET /api/v1/checkpoints from the partner source", () => {
  let role = "passenger";
  beforeEach(() => {
    vi.clearAllMocks();
    role = "passenger";
    db.authSession.findUnique.mockImplementation(async () => ({
      id: "session",
      user_id: "actor",
      user: { id: "actor", role, account_status: "active", security_version: 1, email_verified_at: new Date() },
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60000),
      revoked_at: null
    }));
    db.authSession.update.mockResolvedValue({});
  });

  function app(mapEnabled: boolean) {
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            generatedAt: "2026-11-01T10:00:00Z",
            checkpoints: [
              { id: "p1", city: "نابلس", checkpoint: "حوارة", entering_status_last_updated: "2026-11-01T09:00:00", leaving_status_last_updated: "2026-11-01T09:00:00" },
              { id: "p2", city: "نابلس", checkpoint: "غير موجود", entering_status_last_updated: "2026-11-01T09:00:00", leaving_status_last_updated: "2026-11-01T09:00:00" }
            ]
          })
        )
    );
    const appConfig = createConfig({
      ...env,
      AWEENRAYEH_LIMITED_DIRECTORY_ENABLED: "true",
      AWEENRAYEH_PARTNER_API_KEY: "SYNTHETIC-LIMITED-KEY-ONLY",
      PARTNER_CHECKPOINT_MAP_ENABLED: String(mapEnabled)
    });
    const directory = new LimitedCheckpointDirectoryService(
      appConfig.limitedCheckpointDirectory!,
      { reserve: async () => ({ retryAfterSeconds: 0, lease: { id: "synthetic", notBefore: new Date(0) } }), settle: async () => {} },
      transport
    );
    return {
      transport,
      app: createApp(appConfig, {
        limitedCheckpointDirectoryService: directory,
        partnerCheckpointMapService: new PartnerCheckpointMapService(directory, osm)
      })
    };
  }

  it("stays off unless its own gate is on", async () => {
    const { app: server, transport } = app(false);
    await request(server).get("/api/v1/checkpoints").set(auth("passenger")).expect(404);
    expect((await request(server).get("/api/v1/capabilities").set(auth("passenger")).expect(200)).body.checkpoints_available).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("serves placed and unplaced rows to passengers and drivers", async () => {
    const { app: server } = app(true);
    for (const next of ["passenger", "driver"]) {
      role = next;
      const res = await request(server).get("/api/v1/checkpoints").set(auth(next)).expect(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body.source).toBe("aweenrayeh_partner");
      expect(res.body.checkpoints).toHaveLength(1);
      expect(res.body.checkpoints[0]).toMatchObject({ id: "aweenrayeh:p1", status: "unknown", latitude: 32.178 });
      expect(res.body.unplaced).toEqual([expect.objectContaining({ id: "aweenrayeh:p2", reason: "no_name_match" })]);
      expect((await request(server).get("/api/v1/capabilities").set(auth(next)).expect(200)).body.checkpoints_available).toBe(true);
    }
  });

  it("refuses merchants before contacting the provider", async () => {
    role = "merchant";
    const { app: server, transport } = app(true);
    await request(server).get("/api/v1/checkpoints").set(auth("merchant")).expect(403);
    expect((await request(server).get("/api/v1/capabilities").set(auth("merchant")).expect(200)).body.checkpoints_available).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
});
