import { haversineKm, type Point } from "../lib/geo.js";
import { BATCHING_LIMITS, PARCEL_LOAD_UNITS, type ParcelSize } from "../lib/batchingConfig.js";

export type PlannerParcel = { lat: number; lng: number; size: ParcelSize };

export type PlannerOrder = {
  id: string;
  pickup: Point;
  parcels: PlannerParcel[];
  /** Optional pickup/delivery window (epoch ms). Orders with disjoint windows never share a batch. */
  window?: { from: number; until: number } | null;
};

export type BatchCapacity = {
  maxParcels: number;
  maxOrders: number;
  maxLoadUnits: number;
  maxLargeParcels: number;
};

export const DEFAULT_BATCH_CAPACITY: BatchCapacity = {
  maxParcels: BATCHING_LIMITS.maxParcelsPerBatch,
  maxOrders: BATCHING_LIMITS.maxOrdersPerBatch,
  maxLoadUnits: BATCHING_LIMITS.maxBatchLoadUnits,
  maxLargeParcels: BATCHING_LIMITS.maxLargeParcelsPerBatch
};

export type PlannedBatch = {
  /** Order ids in the sequence their dropoffs are met travelling away from the pickup. */
  order_ids: string[];
  parcel_count: number;
  load_units: number;
  large_parcels: number;
};

export type UnbatchableOrder = { id: string; reason: "order_exceeds_capacity" | "no_parcels" };

export type BatchPlan = { batches: PlannedBatch[]; unbatchable: UnbatchableOrder[] };

type Prepared = {
  order: PlannerOrder;
  centroid: Point;
  distanceFromPickup: number;
  load: number;
  large: number;
};

type Window = { from: number; until: number } | null;

type Open = {
  members: Prepared[];
  anchor: Point;
  pickup: Point;
  parcels: number;
  load: number;
  large: number;
  window: Window;
};

function centroid(parcels: PlannerParcel[]): Point {
  const lat = parcels.reduce((sum, parcel) => sum + parcel.lat, 0) / parcels.length;
  const lng = parcels.reduce((sum, parcel) => sum + parcel.lng, 0) / parcels.length;
  return { lat, lng };
}

function intersect(a: Window, b: Window): Window | "disjoint" {
  if (!a) return b;
  if (!b) return a;
  const from = Math.max(a.from, b.from);
  const until = Math.min(a.until, b.until);
  return from <= until ? { from, until } : "disjoint";
}

/**
 * Pure, deterministic destination-aware grouping.
 *
 * Orders are swept in the order their dropoff centroid is met travelling away
 * from the pickup (distance, then id as a tie-break). Each order joins the first
 * open batch that still accepts it; otherwise it opens a new one. A batch
 * refuses an order when pickups are further apart than the pickup radius,
 * dropoffs are further than the spread radius from the batch's first dropoff,
 * the windows do not overlap, or any vehicle capacity limit (parcels, orders,
 * size-weighted load, large parcels) would be exceeded. An order that alone
 * exceeds capacity is reported as unbatchable instead of overloading a driver.
 * With `seedId`, that order is placed first so it always lands in the first batch.
 */
export function planBatches(
  orders: PlannerOrder[],
  capacity: BatchCapacity = DEFAULT_BATCH_CAPACITY,
  options: { pickupRadiusKm?: number; dropoffSpreadKm?: number; seedId?: string } = {}
): BatchPlan {
  const pickupRadiusKm = options.pickupRadiusKm ?? BATCHING_LIMITS.pickupRadiusKm;
  const dropoffSpreadKm = options.dropoffSpreadKm ?? BATCHING_LIMITS.dropoffSpreadKm;
  const unbatchable: UnbatchableOrder[] = [];
  const prepared: Prepared[] = [];
  for (const order of orders) {
    if (order.parcels.length === 0) {
      unbatchable.push({ id: order.id, reason: "no_parcels" });
      continue;
    }
    const load = order.parcels.reduce((sum, parcel) => sum + PARCEL_LOAD_UNITS[parcel.size], 0);
    const large = order.parcels.filter((parcel) => parcel.size === "L").length;
    if (order.parcels.length > capacity.maxParcels || load > capacity.maxLoadUnits || large > capacity.maxLargeParcels) {
      unbatchable.push({ id: order.id, reason: "order_exceeds_capacity" });
      continue;
    }
    const middle = centroid(order.parcels);
    prepared.push({ order, centroid: middle, distanceFromPickup: haversineKm(order.pickup, middle), load, large });
  }
  // The requested (seed) order is swept first so it anchors the first batch;
  // everything else keeps the deterministic distance-then-id order.
  prepared.sort(
    (a, b) =>
      Number(b.order.id === options.seedId) - Number(a.order.id === options.seedId) ||
      a.distanceFromPickup - b.distanceFromPickup || (a.order.id < b.order.id ? -1 : a.order.id > b.order.id ? 1 : 0)
  );

  const open: Open[] = [];
  for (const item of prepared) {
    const target = open.find((batch) => {
      if (batch.members.length + 1 > capacity.maxOrders) return false;
      if (batch.parcels + item.order.parcels.length > capacity.maxParcels) return false;
      if (batch.load + item.load > capacity.maxLoadUnits) return false;
      if (batch.large + item.large > capacity.maxLargeParcels) return false;
      if (haversineKm(batch.pickup, item.order.pickup) > pickupRadiusKm) return false;
      if (haversineKm(batch.anchor, item.centroid) > dropoffSpreadKm) return false;
      return intersect(batch.window, item.order.window ?? null) !== "disjoint";
    });
    if (target) {
      target.members.push(item);
      target.parcels += item.order.parcels.length;
      target.load += item.load;
      target.large += item.large;
      target.window = intersect(target.window, item.order.window ?? null) as Window;
    } else {
      open.push({
        members: [item],
        anchor: item.centroid,
        pickup: item.order.pickup,
        parcels: item.order.parcels.length,
        load: item.load,
        large: item.large,
        window: item.order.window ?? null
      });
    }
  }

  return {
    batches: open.map((batch) => ({
      order_ids: batch.members.map((member) => member.order.id),
      parcel_count: batch.parcels,
      load_units: batch.load,
      large_parcels: batch.large
    })),
    unbatchable
  };
}
