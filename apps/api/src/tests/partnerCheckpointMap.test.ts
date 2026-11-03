import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { config, createConfig } from "../config.js";
import { LimitedCheckpointDirectoryService, mapLimitedPartnerResponse } from "../services/limitedCheckpointDirectory.js";
import {
  OsmCheckpointIndex,
  PartnerCheckpointMapService,
  checkpointPositionKey,
  loadOsmCheckpoints,
  nameSkeleton,
  normaliseArabicName,
  osmArabicNames,
  partnerDirectionStatus,
  partnerOverallStatus,
  placePartnerCheckpoints,
  type OsmCheckpointFile,
  type ResearchedCheckpointPosition
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

const partner = (rows: Array<{ id: string; city: string; checkpoint: string; entering_status?: string; leaving_status?: string }>) =>
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

  it("matches the article and long-vowel spellings, but not short names", () => {
    const index = new OsmCheckpointIndex([
      { id: "node/10", name: "نقطة تفتيش الجبع الاسرائيلية", name_ar: null, lat: 31.854, lng: 35.256 },
      { id: "node/11", name: null, name_ar: "حاجز الكونتينار", lat: 31.742, lng: 35.289 },
      { id: "node/12", name: null, name_ar: "حاجز دار", lat: 31.75, lng: 35.2 }
    ]);
    expect(index.match("جبع", "القدس")).toMatchObject({ entry: { id: "node/10" }, quality: "article" });
    expect(index.match("الكونتينر", "بيت لحم")).toMatchObject({ entry: { id: "node/11" }, quality: "spelling_variant" });
    // A three-letter skeleton is too short to trust.
    expect(index.match("دير", "القدس")).toEqual({ entry: null, reason: "no_name_match" });
    expect(nameSkeleton("دير")).toBeNull();
  });

  it("reads the Arabic part of mixed-script OSM names and alternatives", () => {
    expect(osmArabicNames({ name: "מחסום דיר שרף حاجز ديار شرف", name_ar: null })).toEqual(["ديار شرف"]);
    expect(osmArabicNames({ name: "Container", name_ar: "حاجز وادي النار /الكونتينار" })).toEqual(["وادي النار", "الكونتينار"]);
  });
});

describe("placing partner rows", () => {
  const index = new OsmCheckpointIndex(osm.checkpoints);

  it("carries the partner's entering/leaving state; the worst direction sets the pin", () => {
    const result = placePartnerCheckpoints(
      partner([
        { id: "s1", city: "نابلس", checkpoint: "حوارة", entering_status: "سالك", leaving_status: "سالك" },
        { id: "s2", city: "نابلس", checkpoint: "دير شرف", entering_status: "سالك", leaving_status: "مغلق" },
        { id: "s3", city: "بيت لحم", checkpoint: "الكونتينر", entering_status: "أزمة خانقة", leaving_status: "سالك" },
        { id: "s4", city: "أريحا - طوباس", checkpoint: "تياسير", entering_status: "سالك" },
        { id: "s5", city: "نابلس", checkpoint: "المربعة", entering_status: "أزمة متوسطة", leaving_status: "مغلق" }
      ]),
      index,
      osm
    );
    expect(result.checkpoints.map((c) => [c.id, c.status, c.entering_status, c.leaving_status])).toEqual([
      ["aweenrayeh:s1", "open", "سالك", "سالك"],
      ["aweenrayeh:s2", "closed", "سالك", "مغلق"],
      ["aweenrayeh:s3", "congested", "أزمة خانقة", "سالك"],
      // One direction missing: not called open.
      ["aweenrayeh:s4", "unknown", "سالك", null]
    ]);
    expect(result.unplaced[0]).toMatchObject({ id: "aweenrayeh:s5", status: "closed", entering_status: "أزمة متوسطة", leaving_status: "مغلق" });
  });

  it("does not guess a state from unfamiliar wording", () => {
    expect(partnerDirectionStatus("مغلقة")).toBe("closed");
    expect(partnerDirectionStatus("ازمة")).toBe("congested");
    expect(partnerDirectionStatus("غير محدد")).toBe("unknown");
    expect(partnerDirectionStatus(null)).toBe("unknown");
    expect(partnerOverallStatus("سالك", "غير محدد")).toBe("unknown");
  });

  it("pins only exact name matches, keeps status unknown without a state and lists the rest", () => {
    const result = placePartnerCheckpoints(
      partner([
        { id: "p1", city: "نابلس", checkpoint: "حوارة" },
        { id: "p2", city: "نابلس", checkpoint: "دير شرف" },
        { id: "p3", city: "بيت لحم", checkpoint: "وادي النار - الكونتينر" },
        { id: "p4", city: "القدس", checkpoint: "التوأم" },
        { id: "p5", city: "أريحا - طوباس", checkpoint: "تياسير" },
        { id: "p6", city: "الخليل", checkpoint: "تياسير" },
        { id: "p7", city: "نابلس", checkpoint: "المربعة" }
      ]),
      index,
      osm
    );
    expect(result.checkpoints.map((c) => (c.position_source === "openstreetmap" ? [c.id, c.position_osm_id, c.position_match] : [c.id]))).toEqual([
      ["aweenrayeh:p1", "node/1", "exact"],
      // "دير شرف" / "ديار شرف": the same name written with an extra long vowel.
      ["aweenrayeh:p2", "node/2", "spelling_variant"],
      ["aweenrayeh:p3", "node/3", "exact"],
      ["aweenrayeh:p5", "node/6", "exact"]
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
    // p4 is ambiguous, p6 is in another city, p7 is not a known place.
    expect(result.unplaced.map((c) => [c.id, c.reason])).toEqual([
      ["aweenrayeh:p4", "ambiguous"],
      ["aweenrayeh:p6", "outside_city"],
      ["aweenrayeh:p7", "no_name_match"]
    ]);
    expect(result.unplaced[0]).not.toHaveProperty("latitude");
    expect(result.position_attribution).toContain("OpenStreetMap");
  });

  it("uses a researched position first, labels low and unverified ones approximate, and keeps the rest unplaced", () => {
    const researched: ResearchedCheckpointPosition[] = [
      // Wins over the OpenStreetMap match for the same partner row.
      { city_ar: "نابلس", name_ar: "حوارة", latitude: 32.17, longitude: 35.27, confidence: "high" },
      // Spelled with a plain alef here and a hamza in the feed: still the same row.
      { city_ar: "نابلس", name_ar: "المربعه", latitude: 32.195486, longitude: 35.2311, confidence: "medium" },
      { city_ar: "أريحا - طوباس", name_ar: "البنانا", latitude: 32.3155, longitude: 35.0682, confidence: "unverified" },
      // Same name in another city is another checkpoint.
      { city_ar: "الخليل", name_ar: "التوأم", latitude: 31.53, longitude: 35.1, confidence: "low" }
    ];
    const result = placePartnerCheckpoints(
      partner([
        { id: "r1", city: "نابلس", checkpoint: "حوارة" },
        { id: "r2", city: "نابلس", checkpoint: "المربعة" },
        { id: "r3", city: "أريحا  -  طوباس", checkpoint: "البنانا", entering_status: "مغلق", leaving_status: "سالك" },
        { id: "r4", city: "القدس", checkpoint: "التوأم" },
        { id: "r5", city: "نابلس", checkpoint: "غير موجود" }
      ]),
      index,
      osm,
      researched
    );
    expect(result.checkpoints.map((c) => [c.id, c.position_source, c.latitude])).toEqual([
      ["aweenrayeh:r1", "darb_research", 32.17],
      ["aweenrayeh:r2", "darb_research", 32.195486],
      ["aweenrayeh:r3", "darb_research", 32.3155]
    ]);
    expect(result.checkpoints[1]).toMatchObject({ position_confidence: "medium", position_approximate: false });
    expect(result.checkpoints[2]).toMatchObject({ position_confidence: "unverified", position_approximate: true, status: "closed", entering_status: "مغلق" });
    expect(result.checkpoints[2]).not.toHaveProperty("position_osm_id");
    expect(result.unplaced.map((c) => c.id)).toEqual(["aweenrayeh:r4", "aweenrayeh:r5"]);
  });

  it("the committed positions cover the 63 researched checkpoints, each once and inside the West Bank", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../prisma/migrations/20261108120000_checkpoint_positions/migration.sql", import.meta.url)),
      "utf8"
    );
    const rows = [...sql.matchAll(/\('cpos_\d{3}', '([^']*)', '((?:[^']|'')*)', (-?\d+\.\d+), (-?\d+\.\d+), '(high|medium|low|unverified)'/g)];
    expect(rows).toHaveLength(63);
    expect(new Set(rows.map((r) => checkpointPositionKey(r[1]!, r[2]!.replaceAll("''", "'")))).size).toBe(63);
    for (const [, , , lat, lng] of rows) {
      expect(Number(lat)).toBeGreaterThan(31.2);
      expect(Number(lat)).toBeLessThan(32.7);
      expect(Number(lng)).toBeGreaterThan(34.8);
      expect(Number(lng)).toBeLessThan(35.7);
    }
    // No trustworthy position yet: left unplaced rather than pinned at a guess.
    expect(sql).not.toMatch(/'الرام'|'كفر عقب'/);
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

  function app(mapEnabled: boolean, positions = { list: async (): Promise<ResearchedCheckpointPosition[]> => [] }) {
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            generatedAt: "2026-11-01T10:00:00Z",
            checkpoints: [
              { id: "p1", city: "نابلس", checkpoint: "حوارة", entering_status: "مغلق", leaving_status: "سالك", entering_status_last_updated: "2026-11-01T09:00:00", leaving_status_last_updated: "2026-11-01T09:00:00" },
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
        partnerCheckpointMapService: new PartnerCheckpointMapService(directory, osm, positions)
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
      expect(res.body.checkpoints[0]).toMatchObject({ id: "aweenrayeh:p1", status: "closed", entering_status: "مغلق", leaving_status: "سالك", latitude: 32.178 });
      expect(res.body.unplaced).toEqual([expect.objectContaining({ id: "aweenrayeh:p2", reason: "no_name_match" })]);
      expect((await request(server).get("/api/v1/capabilities").set(auth(next)).expect(200)).body.checkpoints_available).toBe(true);
    }
  });

  it("pins a row from the researched positions and still serves the map when they cannot be read", async () => {
    const researched = { list: async (): Promise<ResearchedCheckpointPosition[]> => [{ city_ar: "نابلس", name_ar: "غير موجود", latitude: 32.2, longitude: 35.2, confidence: "low" }] };
    let res = await request(app(true, researched).app).get("/api/v1/checkpoints").set(auth("passenger")).expect(200);
    expect(res.body.checkpoints.map((c: { id: string }) => c.id)).toEqual(["aweenrayeh:p1", "aweenrayeh:p2"]);
    expect(res.body.checkpoints[1]).toMatchObject({ position_source: "darb_research", position_approximate: true, latitude: 32.2 });
    expect(res.body.unplaced).toEqual([]);

    const broken = { list: async (): Promise<ResearchedCheckpointPosition[]> => { throw new Error("database unavailable"); } };
    res = await request(app(true, broken).app).get("/api/v1/checkpoints").set(auth("passenger")).expect(200);
    expect(res.body.checkpoints).toHaveLength(1);
    expect(res.body.unplaced).toHaveLength(1);
  });

  it("refuses merchants before contacting the provider", async () => {
    role = "merchant";
    const { app: server, transport } = app(true);
    await request(server).get("/api/v1/checkpoints").set(auth("merchant")).expect(403);
    expect((await request(server).get("/api/v1/capabilities").set(auth("merchant")).expect(200)).body.checkpoints_available).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
});
