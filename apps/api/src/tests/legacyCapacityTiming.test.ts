import { describe, expect, it, vi } from "vitest";
import { reserveLegacyCapacity } from "../services/legacyCapacity.js";

describe("legacy capacity timing boundary", () => {
  it("guards departure and expiry in the same atomic capacity claim while allowing undated routes", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const before = new Date();
    const $queryRaw = vi.fn().mockImplementation((parts: TemplateStringsArray) => parts.join("?").includes("UTC_TIMESTAMP")
      ? [{ now: new Date() }] : [{ id: "route_1", status: "active", verified: true, role: "driver", account_status: "active", departure_at: null, departed_at: null, availability_window_end: null }]);
    await reserveLegacyCapacity({ $queryRaw, driverRoute: { updateMany } } as never,
      { driverRouteId: "route_1", seats: 1, parcelUnits: 0 });
    const where = updateMany.mock.calls[0]![0].where;
    expect(where.departed_at).toBeNull();
    expect(where.AND).toEqual(expect.arrayContaining([
      { OR: [{ departure_at: null }, { departure_at: { gt: expect.any(Date) } }] },
      { OR: [{ availability_window_end: null }, { availability_window_end: { gt: expect.any(Date) } }] },
    ]));
    expect(where.AND[0].OR[1].departure_at.gt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
  it("binds capacity predicates to the authoritative DB clock sampled after the route lock", async () => {
    const clock = new Date("2040-01-01T10:00:00.123Z");
    const phases: string[] = [];
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const $queryRaw = vi.fn().mockImplementation((parts: TemplateStringsArray) => {
      if (parts.join("?").includes("UTC_TIMESTAMP")) { phases.push("clock"); return [{ now: clock }]; }
      phases.push("lock"); return [{ id: "route_1", status: "active", verified: true, role: "driver", account_status: "active", departure_at: null, departed_at: null, availability_window_end: null }];
    });
    await reserveLegacyCapacity({ $queryRaw, driverRoute: { updateMany } } as never, { driverRouteId: "route_1", seats: 1, parcelUnits: 0 });
    expect(phases).toEqual(["lock", "clock"]);
    expect(updateMany.mock.calls[0]![0].where.AND[0].OR[1].departure_at.gt).toEqual(clock);
    expect(updateMany.mock.calls[0]![0].where.AND[1].OR[1].availability_window_end.gt).toEqual(clock);
  });

});
