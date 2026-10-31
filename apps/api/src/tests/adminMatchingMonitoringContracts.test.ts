import { describe, expect, it } from "vitest";
import {
  parseBatchQuery,
  parseMatchQuery,
  parseMonitoringId,
  parsePageQuery,
  parseRange
} from "../services/adminMatchingMonitoring/contracts.js";
import {
  batchSelect,
  eligibleBatch,
  eligibleMatch,
  eligibleOrder,
  eligibleParcel,
  eligiblePassenger,
  eligibleRoute,
  matchSelect,
  parcelSelect
} from "../services/adminMatchingMonitoring/policy.js";

const now = new Date("2026-09-10T12:00:00.000Z");

describe("admin matching monitoring query contracts", () => {
  it("defaults match pagination and its seven-day server range", () => {
    expect(parseMatchQuery({}, now)).toEqual({
      page: 1,
      limit: 25,
      from: "2026-09-03T12:00:00.000Z",
      until: "2026-09-10T12:00:00.000Z"
    });
  });

  it("accepts scalar integer strings only within the paging bounds", () => {
    expect(parsePageQuery({ page: "1000", limit: "50" })).toEqual({ page: 1000, limit: 50 });
    for (const input of [
      { page: "0" }, { page: "1001" }, { page: "1.5" }, { page: 1 },
      { limit: "0" }, { limit: "51" }, { limit: ["25"] }, { cursor: "next" }
    ]) expect(() => parsePageQuery(input)).toThrow();
  });

  it("requires strict paired UTC ranges bounded to 31 days and server time", () => {
    expect(parseRange({
      from: "2026-08-10T12:00:00.000Z",
      until: "2026-09-10T12:00:00.000Z"
    }, now)).toEqual({
      from: "2026-08-10T12:00:00.000Z",
      until: "2026-09-10T12:00:00.000Z"
    });
    expect(parseRange({
      from: "2026-09-03T12:00:00.1Z",
      until: "2026-09-10T12:00:00Z"
    }, now)).toEqual({
      from: "2026-09-03T12:00:00.100Z",
      until: "2026-09-10T12:00:00.000Z"
    });

    for (const input of [
      { from: "2026-09-01T00:00:00.000Z" },
      { until: "2026-09-10T00:00:00.000Z" },
      { from: "2026-09-10T12:00:00.000Z", until: "2026-09-10T12:00:00.000Z" },
      { from: "2026-08-10T11:59:59.999Z", until: "2026-09-10T12:00:00.000Z" },
      { from: "2026-09-03T12:00:00.000Z", until: "2026-09-10T12:00:00.001Z" },
      { from: "2026-02-30T12:00:00Z", until: "2026-09-10T12:00:00.000Z" },
      { from: "2026-09-03T12:00:00.0000Z", until: "2026-09-10T12:00:00.000Z" },
      { from: "2026-09-03T12:00:00+00:00", until: "2026-09-10T12:00:00.000Z" },
      { from: ["2026-09-03T12:00:00.000Z"], until: "2026-09-10T12:00:00.000Z" }
    ]) expect(() => parseRange(input, now)).toThrow();
  });

  it("strictly validates entity filters and normalizes blank or trimmed search", () => {
    expect(parseMatchQuery({ demand_kind: "combined", search: " m1 " }, now)).toMatchObject({
      demand_kind: "combined",
      search: "m1"
    });
    expect(parseMatchQuery({ search: "   " }, now)).not.toHaveProperty("search");
    expect(parseMatchQuery({ search: `  ${"x".repeat(191)}  ` }, now).search).toBe("x".repeat(191));
    expect(parseMatchQuery({ search: " ".repeat(192) }, now)).not.toHaveProperty("search");
    expect(parseBatchQuery({ status: "assigned", search: " batch-1 " }, now)).toMatchObject({
      status: "assigned",
      search: "batch-1"
    });

    for (const input of [
      { limit: "51" }, { limit: ["25"] }, { source: "canonical" }, { cursor: "opaque" },
      { status: "unknown" }, { demand_kind: "passenger" }, { search: ` ${"x".repeat(192)} ` }
    ]) expect(() => parseMatchQuery(input, now)).toThrow();
    expect(() => parseBatchQuery({ status: "completed" }, now)).toThrow();
    expect(() => parseBatchQuery({ cursor: "opaque" }, now)).toThrow();
  });

  it("trims bounded exact operational IDs and rejects other shapes", () => {
    expect(parseMonitoringId(" match-1 ")).toBe("match-1");
    expect(parseMonitoringId(`  ${"x".repeat(191)}  `)).toBe("x".repeat(191));
    for (const input of ["", "   ", ` ${"x".repeat(192)} `, ["match-1"], 1, null]) {
      expect(() => parseMonitoringId(input)).toThrow();
    }
  });
});

describe("admin matching monitoring eligibility policy", () => {
  it("fails closed on passenger, order, route, parcel, and batch provenance", () => {
    expect(eligibleParcel).toEqual({
      operational_mode: "legacy", canonical_entry_version: null, route_version_id: null
    });
    expect(eligiblePassenger).toEqual({
      operational_mode: "legacy", canonical_entry_version: null, route_version_id: null,
      source: "manual", passenger: { is: { demo_account: false } }
    });
    expect(eligibleOrder).toEqual({
      operational_mode: "legacy", canonical_entry_version: null, route_version_id: null,
      merchant: { is: { demo_account: false } }, parcels: { every: eligibleParcel }
    });
    expect(eligibleRoute).toEqual({
      operational_mode: "legacy", canonical_availability_version: null, route_version_id: null,
      driver: { is: { user: { is: { demo_account: false } } } }
    });
    expect(eligibleBatch).toEqual({
      merchant_order: { is: eligibleOrder },
      OR: [{ driver_route_id: null }, { driver_route: { is: eligibleRoute } }]
    });
  });

  it("independently authorizes every optional match relation and requires demand", () => {
    const orderProvenance = {
      operational_mode: "legacy", canonical_entry_version: null, route_version_id: null,
      merchant: { is: { demo_account: false } }
    };
    expect(eligibleMatch).toEqual({
      operational_mode: "legacy",
      canonical_match_version: null,
      route_version_id: null,
      manifest_id: null,
      dispatch_id: null,
      reservation_id: null,
      driver_route: { is: eligibleRoute },
      OR: [
        { passenger_request_id: { not: null } },
        { merchant_order_id: { not: null } }
      ],
      AND: [
        { OR: [{ passenger_request_id: null }, { passenger_request: { is: eligiblePassenger } }] },
        { OR: [{ merchant_order_id: null }, { merchant_order: { is: orderProvenance } }] },
        { OR: [{ parcel_batch_id: null }, { parcel_batch: { is: { ...eligibleBatch, merchant_order: { is: orderProvenance } } } }] },
        { NOT: { merchant_order: { is: { parcels: { some: { NOT: eligibleParcel } } } } } },
        { NOT: { parcel_batch: { is: { merchant_order: { is: { parcels: { some: { NOT: eligibleParcel } } } } } } } }
      ]
    });
  });

  it("uses exact safe select allowlists and filtered parcel counts", () => {
    expect(parcelSelect).toEqual({ id: true, status: true });
    expect(matchSelect).toEqual({
      id: true,
      status: true,
      created_at: true,
      score: true,
      method: true,
      driver_route: { select: { id: true, status: true } },
      passenger_request: { select: { id: true, status: true, passenger_count: true } },
      merchant_order: {
        select: {
          id: true,
          status: true,
          _count: { select: { parcels: { where: eligibleParcel } } }
        }
      },
      parcel_batch: { select: { id: true, status: true } }
    });
    expect(batchSelect).toEqual({
      id: true,
      status: true,
      created_at: true,
      merchant_order: {
        select: {
          id: true,
          status: true,
          _count: { select: { parcels: { where: eligibleParcel } } }
        }
      },
      driver_route: { select: { id: true, status: true } }
    });
  });
});
