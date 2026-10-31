import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReport,
  computeSuccessMetrics,
  hasContinuousHistory,
  previousWindow,
  successMetricsCsv,
  trendFor,
  type TripRow
} from "../services/successMetrics.js";

const t0 = new Date("2026-10-01T10:00:00.000Z");
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
const chain = ["accepted", "pickup_started", "picked_up", "in_transit", "delivered", "completed"];
const fullHistory = chain.slice(0, -1).map((from, i) => ({ from, to: chain[i + 1] }));

function trip(overrides: Partial<TripRow> = {}): TripRow {
  return {
    status: "completed",
    created_at: at(60),
    driver_route_id: "r1",
    request_created_at: t0,
    served_units: 1,
    batch_parcels: null,
    transitions: fullHistory,
    ...overrides
  };
}

const verification = { active_drivers: 4, verified_active_drivers: 4 };
const byKey = (rows: ReturnType<typeof computeSuccessMetrics>, key: string) => rows.find((r) => r.key === key)!;

describe("success metrics computation", () => {
  it("reports no data for every metric on an empty range", () => {
    const rows = computeSuccessMetrics({ trips: [], verification: { active_drivers: 0, verified_active_drivers: 0 } });
    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.status === "no_data" && row.value === null)).toBe(true);
  });

  it("passes the fixed fixture", () => {
    const rows = computeSuccessMetrics({
      trips: [
        trip(),
        trip({ created_at: at(100), driver_route_id: "r2" }),
        trip({ created_at: at(200), driver_route_id: "r2", served_units: 3, batch_parcels: 6, request_created_at: null })
      ],
      verification
    });
    expect(byKey(rows, "matching_time")).toMatchObject({ value: 80, status: "pass", sample_size: 2 });
    expect(byKey(rows, "status_continuity")).toMatchObject({ value: 100, status: "pass" });
    expect(byKey(rows, "batch_efficiency")).toMatchObject({ value: 0.17, status: "pass" });
    expect(byKey(rows, "driver_utilization")).toMatchObject({ value: 2.5, status: "pass" });
    expect(byKey(rows, "driver_verification")).toMatchObject({ value: 100, status: "pass" });
    expect(byKey(rows, "user_satisfaction").status).toBe("no_data");
    expect(byKey(rows, "ai_understanding").status).toBe("no_data");
  });

  it("fails slow matching, broken histories and unverified drivers", () => {
    const rows = computeSuccessMetrics({
      trips: [trip({ created_at: at(300) }), trip({ transitions: fullHistory.slice(1) })],
      verification: { active_drivers: 4, verified_active_drivers: 3 }
    });
    expect(byKey(rows, "matching_time")).toMatchObject({ value: 180, status: "fail" });
    expect(byKey(rows, "status_continuity")).toMatchObject({ value: 50, status: "fail" });
    expect(byKey(rows, "driver_verification")).toMatchObject({ value: 75, status: "fail" });
  });

  it("ignores cancelled trips for continuity and uses the median", () => {
    const rows = computeSuccessMetrics({
      trips: [trip({ status: "cancelled", transitions: [] }), trip({ created_at: at(30) }), trip({ created_at: at(50) }), trip({ created_at: at(1000) })],
      verification
    });
    expect(byKey(rows, "status_continuity")).toMatchObject({ value: 100, sample_size: 3 });
    expect(byKey(rows, "matching_time").value).toBe(55);
  });

  it("reads satisfaction from optional ratings and drops invalid values", () => {
    const rows = computeSuccessMetrics({ trips: [], verification, ratings: [5, 4, 9, 0, Number.NaN] });
    expect(byKey(rows, "user_satisfaction")).toMatchObject({ value: 4.5, status: "pass", sample_size: 2 });
    const low = computeSuccessMetrics({ trips: [], verification, ratings: [3, 4] });
    expect(byKey(low, "user_satisfaction").status).toBe("fail");
  });

  it("checks history continuity strictly", () => {
    expect(hasContinuousHistory(fullHistory)).toBe(true);
    expect(hasContinuousHistory([])).toBe(false);
    expect(hasContinuousHistory([...fullHistory].reverse())).toBe(false);
  });

  it("judges trend in the better direction per metric", () => {
    expect(trendFor("matching_time", 60, 90)).toBe("improving");
    expect(trendFor("matching_time", 90, 60)).toBe("worsening");
    expect(trendFor("status_continuity", 99, 90)).toBe("improving");
    expect(trendFor("status_continuity", 90, 90)).toBe("flat");
    expect(trendFor("status_continuity", null, 90)).toBe("none");
  });

  it("builds adjacent equal-length previous windows", () => {
    const window = { from: new Date("2026-10-11T00:00:00.000Z"), to: new Date("2026-10-20T23:59:59.999Z") };
    const prev = previousWindow(window);
    expect(prev.to.getTime()).toBe(window.from.getTime() - 1);
    expect(prev.to.getTime() - prev.from.getTime()).toBe(window.to.getTime() - window.from.getTime());
  });

  it("exports aggregates only as CSV", () => {
    const rows = computeSuccessMetrics({ trips: [trip()], verification });
    const csv = successMetricsCsv(buildReport(rows, computeSuccessMetrics({ trips: [], verification })), { from: t0, to: at(86400) });
    expect(csv).toContain("metric,target,value,unit,status,previous_value,trend,sample_size,from,to");
    expect(csv).toContain("matching_time");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(10);
  });
});

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  trip: { findMany: vi.fn() },
  driverProfile: { count: vi.fn() },
  auditEvent: { findMany: vi.fn(), create: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");

function session(role: "admin" | "passenger") {
  const user = {
    email_verified_at: new Date(), id: `${role}_1`, name: "N", phone: "+1", role,
    account_status: "active", security_version: 1, demo_account: false
  };
  prismaMock.authSession.findUnique.mockResolvedValue({
    id: `session_${user.id}`, user_id: user.id, user, security_version_at_issue: 1,
    expires_at: new Date(Date.now() + 60_000), revoked_at: null
  });
  return { Authorization: `Bearer ${signAuthToken({ id: user.id, role, sessionId: `session_${user.id}`, securityVersion: 1 })}` };
}

describe("success metrics API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.trip.findMany.mockResolvedValue([]);
    prismaMock.driverProfile.count.mockResolvedValue(0);
    prismaMock.auditEvent.findMany.mockResolvedValue([]);
  });

  it("is admin only", async () => {
    const response = await request(createApp()).get("/api/v1/admin/success-metrics").set(session("passenger"));
    expect(response.status).toBe(403);
    expect((await request(createApp()).get("/api/v1/admin/success-metrics")).status).toBe(401);
  });

  it("returns no-data metrics for an empty range", async () => {
    const response = await request(createApp()).get("/api/v1/admin/success-metrics?from=2026-10-01&to=2026-10-02").set(session("admin"));
    expect(response.status).toBe(200);
    expect(response.body.metrics).toHaveLength(9);
    expect(response.body.metrics.every((m: { status: string }) => m.status === "no_data")).toBe(true);
  });

  it("aggregates trips without leaking identifiers", async () => {
    prismaMock.driverProfile.count.mockResolvedValue(2);
    prismaMock.trip.findMany
      .mockResolvedValueOnce([
        {
          id: "trip_secret", status: "completed", created_at: at(60), driver_route_id: "r1",
          passenger_request: { created_at: t0 }, merchant_order_id: null, parcel_batch: null
        }
      ])
      .mockResolvedValueOnce([]);
    prismaMock.auditEvent.findMany.mockResolvedValue(fullHistory.map((m) => ({ entity_id: "trip_secret", metadata: m })));
    const response = await request(createApp()).get("/api/v1/admin/success-metrics").set(session("admin"));
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("trip_secret");
    expect(response.body.metrics.find((m: { key: string }) => m.key === "matching_time")).toMatchObject({ value: 60, status: "pass" });
  });

  it("rejects an inverted range and exports CSV", async () => {
    const bad = await request(createApp()).get("/api/v1/admin/success-metrics?from=2026-10-05&to=2026-10-01").set(session("admin"));
    expect(bad.status).toBe(400);
    const csv = await request(createApp()).get("/api/v1/admin/success-metrics/export").set(session("admin"));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("matching_time");
  });
});
