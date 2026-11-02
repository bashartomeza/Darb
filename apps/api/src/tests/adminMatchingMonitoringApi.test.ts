import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../middleware/error.js";
import type { MonitoringService } from "../services/adminMatchingMonitoring/contracts.js";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { config } = await import("../config.js");
const { signAuthToken } = await import("../middleware/auth.js");

const observedAt = "2026-09-10T12:00:01.000Z";
const range = { from: "2026-09-03T12:00:00.000Z", until: "2026-09-10T12:00:00.000Z" };
const users = {
  admin: { id: "admin_1", role: "admin" as const },
  passenger: { id: "passenger_1", role: "passenger" as const },
  driver: { id: "driver_1", role: "driver" as const },
  merchant: { id: "merchant_1", role: "merchant" as const }
};
type AuthUser = (typeof users)[keyof typeof users];

function authorization(user: AuthUser = users.admin, sessionSuffix = "active") {
  return {
    Authorization: `Bearer ${signAuthToken({
      id: user.id,
      role: user.role,
      sessionId: `session_${user.id}_${sessionSuffix}`,
      securityVersion: 1
    })}`
  };
}

function service(): MonitoringService {
  return {
    overview: vi.fn().mockResolvedValue({
      observed_at: observedAt,
      scope: "production_supported_legacy",
      data: {
        range,
        pending_passenger_requests: 0,
        submitted_merchant_orders: 0,
        match_results_by_status: { proposed: 0, accepted: 0, rejected: 0, expired: 0 },
        batches_by_status: { created: 0, assigned: 0, picked_up: 0, in_transit: 0, delivered: 0 },
        active_batches: 0,
        capabilities: { canonical_monitoring: "unavailable", failed_attempt_history: "not_recorded", completed_batches: "not_supported" }
      }
    }),
    matches: vi.fn().mockResolvedValue({ observed_at: observedAt, scope: "production_supported_legacy", data: { items: [], page: 1, limit: 25, total: 0, has_more: false, range } }),
    match: vi.fn().mockResolvedValue({ observed_at: observedAt, scope: "production_supported_legacy", data: { id: "match_1" } as never }),
    batches: vi.fn().mockResolvedValue({ observed_at: observedAt, scope: "production_supported_legacy", data: { items: [], page: 1, limit: 25, total: 0, has_more: false, range } }),
    batch: vi.fn().mockResolvedValue({ observed_at: observedAt, scope: "production_supported_legacy", data: { id: "batch_1" } as never }),
    parcels: vi.fn().mockResolvedValue({ observed_at: observedAt, scope: "production_supported_legacy", data: { items: [], page: 1, limit: 25, total: 0, has_more: false, range: null, contents_semantics: "current_eligible_order_contents", merchant_order_id: "order_1" } })
  };
}

function allCalls(mock: MonitoringService) {
  return Object.values(mock).reduce((total, method) => total + vi.mocked(method).mock.calls.length, 0);
}

const routes = [
  "/overview",
  "/matches",
  "/matches/match_1",
  "/batches",
  "/batches/batch_1",
  "/batches/batch_1/parcels"
] as const;
const root = "/api/v1/admin/matching-batching";

describe("Admin matching and batching monitoring HTTP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const user = Object.values(users).find(({ id }) => where.id.startsWith(`session_${id}_`));
      return user ? {
        id: where.id,
        user_id: user.id,
        user: {
          ...user,
          account_status: "active",
          security_version: 1,
          profile_state: "complete",
          email_verified_at: new Date()
        },
        security_version_at_issue: 1,
        expires_at: new Date(where.id.endsWith("_expired") ? Date.now() - 60_000 : Date.now() + 60_000),
        revoked_at: where.id.endsWith("_revoked") ? new Date() : null
      } : null;
    });
    prismaMock.authSession.update.mockResolvedValue({});
  });

  it.each(routes)("rejects unauthenticated GET %s before a service read", async (path) => {
    const mock = service();
    await request(createApp(undefined, { adminMatchingMonitoringService: mock })).get(root + path).expect(401);
    expect(allCalls(mock)).toBe(0);
  });

  it.each(routes)("rejects every non-Admin role on GET %s before a service read", async (path) => {
    for (const user of [users.passenger, users.driver, users.merchant]) {
      const mock = service();
      await request(createApp(undefined, { adminMatchingMonitoringService: mock })).get(root + path).set(authorization(user)).expect(403);
      expect(allCalls(mock)).toBe(0);
    }
  });

  it.each(routes)("rejects revoked and expired Admin sessions on GET %s", async (path) => {
    for (const suffix of ["revoked", "expired"] as const) {
      const mock = service();
      await request(createApp(undefined, { adminMatchingMonitoringService: mock })).get(root + path).set(authorization(users.admin, suffix)).expect(401);
      expect(allCalls(mock)).toBe(0);
    }
  });

  it.each(routes)("allows an active Admin to GET %s", async (path) => {
    await request(createApp(undefined, { adminMatchingMonitoringService: service() })).get(root + path).set(authorization()).expect(200);
  });

  it("normalizes directory queries and preserves exact search strings", async () => {
    const mock = service();
    const app = createApp(undefined, { adminMatchingMonitoringService: mock });
    await request(app).get(`${root}/matches?page=2&limit=50&from=${range.from}&until=${range.until}&status=proposed&demand_kind=combined&search=%20match_1%20`).set(authorization()).expect(200);
    expect(mock.matches).toHaveBeenCalledWith({ page: 2, limit: 50, ...range, status: "proposed", demand_kind: "combined", search: "match_1" });
    await request(app).get(`${root}/batches?search=%20batch_1%20`).set(authorization()).expect(200);
    expect(mock.batches).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 25, search: "batch_1" }));
  });

  it.each(["matches", "batches"])("rejects source and cursor toggles on the %s directory", async (directory) => {
    for (const query of ["source=canonical", "cursor=next"]) {
      const mock = service();
      await request(createApp(undefined, { adminMatchingMonitoringService: mock })).get(`${root}/${directory}?${query}`).set(authorization()).expect(400);
      expect(allCalls(mock)).toBe(0);
    }
  });

  it.each(["matches/match_1", "batches/batch_1"])("requires an empty scalar query on detail %s", async (path) => {
    for (const query of ["source=canonical", "cursor=next", "unknown=value", "unknown=a&unknown=b"]) {
      const mock = service();
      await request(createApp(undefined, { adminMatchingMonitoringService: mock })).get(`${root}/${path}?${query}`).set(authorization()).expect(400);
      expect(allCalls(mock)).toBe(0);
    }
  });

  it("delegates parsed IDs and member pagination", async () => {
    const mock = service();
    const app = createApp(undefined, { adminMatchingMonitoringService: mock });
    await request(app).get(`${root}/matches/%20match_1%20`).set(authorization()).expect(200);
    await request(app).get(`${root}/batches/%20batch_1%20`).set(authorization()).expect(200);
    await request(app).get(`${root}/batches/%20batch_1%20/parcels?page=3&limit=10`).set(authorization()).expect(200);
    expect(mock.match).toHaveBeenCalledWith("match_1");
    expect(mock.batch).toHaveBeenCalledWith("batch_1");
    expect(mock.parcels).toHaveBeenCalledWith("batch_1", { page: 3, limit: 10 });
  });

  it.each(["match", "batch", "parcels"] as const)("preserves eligible-missing and excluded-parent 404 equivalence for %s", async (method) => {
    const missing = service();
    vi.mocked(missing[method]).mockRejectedValue(new HttpError(404, "monitoring_record_not_found"));
    const path = method === "match" ? "/matches/missing" : method === "batch" ? "/batches/missing" : "/batches/missing/parcels";
    const response = await request(createApp(undefined, { adminMatchingMonitoringService: missing })).get(root + path).set(authorization()).expect(404);
    expect(response.body.error).toBe("monitoring_record_not_found");
  });

  it("returns a sanitized service-unavailable envelope", async () => {
    const mock = service();
    vi.mocked(mock.overview).mockRejectedValue(Object.assign(new HttpError(503, "monitoring_unavailable"), { secret: "database-host" }));
    const response = await request(createApp(undefined, { adminMatchingMonitoringService: mock })).get(`${root}/overview`).set(authorization()).expect(503);
    expect(response.body).toMatchObject({ error: "monitoring_unavailable", request_id: expect.any(String) });
    expect(JSON.stringify(response.body)).not.toContain("database-host");
  });

  it.each(["post", "patch", "delete"] as const)("does not expose %s mutations", async (method) => {
    const mock = service();
    await request(createApp(undefined, { adminMatchingMonitoringService: mock }))[method](`${root}/matches`).set(authorization()).send({}).expect(404);
    expect(allCalls(mock)).toBe(0);
  });

  it.each([false, true])("mounts the same injected legacy-only service when demoFeaturesEnabled=%s", async (demoFeaturesEnabled) => {
    const mock = service();
    await request(createApp({ ...config, demoFeaturesEnabled }, { adminMatchingMonitoringService: mock })).get(`${root}/overview`).set(authorization()).expect(200);
    expect(mock.overview).toHaveBeenCalledOnce();
  });
});
