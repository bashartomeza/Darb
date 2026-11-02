import { describe, expect, it } from "vitest";
import type { Trip } from "../../api";
import { ACTIVE_TRIP_STATUSES, activeTrips, isActiveTripStatus } from "./overviewMetrics";

const trip = (status: string): Trip => ({ id: status, status, driver_route_id: "route_1" });

describe("overview metric semantics", () => {
  it("uses only the repository lifecycle's operational in-progress trip states", () => {
    expect(ACTIVE_TRIP_STATUSES).toEqual(["pickup_started", "picked_up", "in_transit"]);
    expect(activeTrips([
      trip("created"),
      trip("accepted"),
      trip("pickup_started"),
      trip("picked_up"),
      trip("in_transit"),
      trip("delivered"),
      trip("completed"),
      trip("cancelled")
    ]).map(({ status }) => status)).toEqual(["pickup_started", "picked_up", "in_transit"]);
  });

  it("does not count pre-pickup, delivered, completed, or cancelled trips as active", () => {
    for (const status of ["created", "accepted", "delivered", "completed", "cancelled"]) {
      expect(isActiveTripStatus(status), status).toBe(false);
    }
  });
});
