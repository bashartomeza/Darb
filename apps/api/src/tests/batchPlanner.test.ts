import { describe, expect, it } from "vitest";
import { BATCHING_LIMITS, PARCEL_LOAD_UNITS } from "../lib/batchingConfig.js";
import { planBatches, type PlannerOrder, type PlannerParcel } from "../services/batchPlanner.js";

const HEBRON_PICKUP = { lat: 31.5326, lng: 35.0998 };
const HALHUL = { lat: 31.5834, lng: 35.0966 };
const BETHLEHEM_CENTER = { lat: 31.7054, lng: 35.2024 };
const BETHLEHEM_MANGER = { lat: 31.7043, lng: 35.2075 };
const BEIT_JALA = { lat: 31.7155, lng: 35.1873 };
const RAMALLAH = { lat: 31.9038, lng: 35.2034 };

function order(
  id: string,
  to: { lat: number; lng: number },
  sizes: Array<"S" | "M" | "L"> = ["S"],
  extra: Partial<PlannerOrder> = {}
): PlannerOrder {
  const parcels: PlannerParcel[] = sizes.map((size) => ({ lat: to.lat, lng: to.lng, size }));
  return { id, pickup: HEBRON_PICKUP, parcels, ...extra };
}

describe("batch limits config", () => {
  it("raises the per-batch and per-upload limits to 50", () => {
    expect(BATCHING_LIMITS.maxParcelsPerBatch).toBe(50);
    expect(BATCHING_LIMITS.maxParcelsPerOrder).toBe(50);
    expect(BATCHING_LIMITS.maxBulkUploadOrders).toBe(50);
    expect(BATCHING_LIMITS.maxOrdersPerBatch).toBe(50);
    expect(PARCEL_LOAD_UNITS).toEqual({ S: 1, M: 2, L: 4 });
  });
});

describe("planBatches destination clustering", () => {
  it("groups nearby dropoffs and separates a far city", () => {
    const plan = planBatches([
      order("o-ramallah", RAMALLAH),
      order("o-manger", BETHLEHEM_MANGER),
      order("o-center", BETHLEHEM_CENTER),
      order("o-beitjala", BEIT_JALA)
    ]);
    expect(plan.unbatchable).toEqual([]);
    expect(plan.batches).toHaveLength(2);
    const bethlehem = plan.batches.find((batch) => batch.order_ids.includes("o-center"))!;
    expect([...bethlehem.order_ids].sort()).toEqual(["o-beitjala", "o-center", "o-manger"]);
    expect(plan.batches.find((batch) => batch.order_ids.includes("o-ramallah"))!.order_ids).toEqual(["o-ramallah"]);
  });

  it("sequences dropoffs by distance from the pickup along the route", () => {
    const plan = planBatches([order("far", BETHLEHEM_CENTER), order("near", HALHUL)], undefined, {
      dropoffSpreadKm: 40
    });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]!.order_ids).toEqual(["near", "far"]);
  });

  it("is deterministic regardless of input order", () => {
    const input = [
      order("a", BETHLEHEM_CENTER),
      order("b", BETHLEHEM_MANGER),
      order("c", RAMALLAH),
      order("d", BEIT_JALA),
      order("e", HALHUL)
    ];
    const forward = planBatches(input);
    expect(planBatches([...input].reverse())).toEqual(forward);
    expect(planBatches([input[3]!, input[0]!, input[4]!, input[2]!, input[1]!])).toEqual(forward);
  });

  it("does not group orders whose pickups are further than the pickup radius", () => {
    const elsewhere = order("p2", BETHLEHEM_CENTER, ["S"], { pickup: { lat: 31.58, lng: 35.1 } });
    const plan = planBatches([order("p1", BETHLEHEM_CENTER), elsewhere]);
    expect(plan.batches).toHaveLength(2);
  });
});

describe("planBatches time windows", () => {
  const h = 3_600_000;
  it("keeps orders with disjoint windows apart and joins overlapping ones", () => {
    const plan = planBatches([
      order("morning", BETHLEHEM_CENTER, ["S"], { window: { from: 8 * h, until: 10 * h } }),
      order("overlap", BETHLEHEM_MANGER, ["S"], { window: { from: 9 * h, until: 12 * h } }),
      order("evening", BEIT_JALA, ["S"], { window: { from: 17 * h, until: 19 * h } }),
      order("anytime", BEIT_JALA)
    ]);
    const withMorning = plan.batches.find((batch) => batch.order_ids.includes("morning"))!;
    expect(withMorning.order_ids).toContain("overlap");
    expect(withMorning.order_ids).not.toContain("evening");
    expect(plan.batches.flatMap((batch) => batch.order_ids).sort()).toEqual(["anytime", "evening", "morning", "overlap"]);
  });

  it("narrows the batch window as members join", () => {
    const plan = planBatches([
      order("a", BETHLEHEM_CENTER, ["S"], { window: { from: 0, until: 100 } }),
      order("b", BETHLEHEM_MANGER, ["S"], { window: { from: 60, until: 200 } }),
      order("c", BEIT_JALA, ["S"], { window: { from: 150, until: 300 } })
    ]);
    expect(plan.batches).toHaveLength(2);
  });
});

describe("planBatches vehicle capacity", () => {
  it("splits 50 orders into several batches when load exceeds one vehicle", () => {
    const orders = Array.from({ length: 50 }, (_, index) =>
      order(`o${String(index).padStart(2, "0")}`, BETHLEHEM_CENTER, ["M", "M"])
    );
    const plan = planBatches(orders);
    expect(plan.unbatchable).toEqual([]);
    expect(plan.batches.length).toBeGreaterThan(1);
    for (const batch of plan.batches) {
      expect(batch.parcel_count).toBeLessThanOrEqual(BATCHING_LIMITS.maxParcelsPerBatch);
      expect(batch.load_units).toBeLessThanOrEqual(BATCHING_LIMITS.maxBatchLoadUnits);
    }
    expect(plan.batches.reduce((sum, batch) => sum + batch.order_ids.length, 0)).toBe(50);
  });

  it("never exceeds 50 parcels in one batch", () => {
    const plan = planBatches(Array.from({ length: 60 }, (_, index) => order(`s${index}`, BETHLEHEM_CENTER)));
    expect(plan.batches.map((batch) => batch.parcel_count)).toEqual([50, 10]);
  });

  it("places the seed order in the first batch even when it sorts last", () => {
    const orders = Array.from({ length: 51 }, (_, index) => order(`s${String(index).padStart(2, "0")}`, BETHLEHEM_CENTER));
    const plan = planBatches(orders, undefined, { seedId: "s50" });
    expect(plan.batches[0]!.order_ids).toHaveLength(50);
    expect(plan.batches[0]!.order_ids).toContain("s50");
  });

  it("caps large parcels per batch", () => {
    const plan = planBatches(
      Array.from({ length: 5 }, (_, index) => order(`l${index}`, BETHLEHEM_CENTER, ["L", "L", "L", "L", "L"]))
    );
    for (const batch of plan.batches) expect(batch.large_parcels).toBeLessThanOrEqual(BATCHING_LIMITS.maxLargeParcelsPerBatch);
    expect(plan.batches).toHaveLength(3);
  });

  it("reports a single order that alone exceeds capacity instead of overloading a driver", () => {
    const heavy = order("heavy", BETHLEHEM_CENTER, Array<"L">(30).fill("L"));
    const plan = planBatches([heavy, order("ok", BETHLEHEM_CENTER)]);
    expect(plan.unbatchable).toEqual([{ id: "heavy", reason: "order_exceeds_capacity" }]);
    expect(plan.batches).toHaveLength(1);
  });

  it("honours a smaller vehicle capacity profile", () => {
    const plan = planBatches(
      [order("a", BETHLEHEM_CENTER, ["S", "S", "S"]), order("b", BETHLEHEM_CENTER, ["S", "S", "S"])],
      { maxParcels: 4, maxOrders: 10, maxLoadUnits: 10, maxLargeParcels: 1 }
    );
    expect(plan.batches).toHaveLength(2);
  });

  it("flags orders without parcels", () => {
    expect(planBatches([{ id: "empty", pickup: HEBRON_PICKUP, parcels: [] }]).unbatchable).toEqual([
      { id: "empty", reason: "no_parcels" }
    ]);
  });
});
