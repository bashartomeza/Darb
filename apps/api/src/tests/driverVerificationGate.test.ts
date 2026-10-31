import { describe, expect, it, vi } from "vitest";
import { createDriverAvailabilityService } from "../services/driverAvailability.js";

describe("driver verification operational gate", () => {
  it("keeps a rejected or unverified driver blocked from availability", async () => {
    const db = {
      driverProfile: { findUnique: vi.fn().mockResolvedValue({ id: "profile_1", verified: false }) },
      driverVerification: { findUnique: vi.fn().mockResolvedValue({ status: "rejected" }) },
      driverRoute: { findMany: vi.fn() }
    };
    const service = createDriverAvailabilityService(db as never);

    await expect(service.listOwner("driver_1")).rejects.toEqual(expect.objectContaining({ statusCode: 403, message: "driver_not_approved" }));
    expect(db.driverRoute.findMany).not.toHaveBeenCalled();
  });

  it("allows an approved profile through the existing availability gate", async () => {
    const routes = [{ id: "availability_1" }];
    const db = {
      driverProfile: { findUnique: vi.fn().mockResolvedValue({ id: "profile_1", verified: true }) },
      driverRoute: { findMany: vi.fn().mockResolvedValue(routes) }
    };
    const service = createDriverAvailabilityService(db as never);

    await expect(service.listOwner("driver_1")).resolves.toEqual(routes);
    expect(db.driverRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ driver: { user_id: "driver_1" } }) }));
  });
});
