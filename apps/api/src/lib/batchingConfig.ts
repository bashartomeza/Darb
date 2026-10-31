/**
 * Single source of truth for batching and bulk-order limits. Everything that
 * caps parcels, orders or upload rows reads from here so the limits cannot
 * drift between the order schema, the batching service and the bulk upload.
 */
export const BATCHING_LIMITS = {
  /** Parcels one merchant order may carry (was 10). */
  maxParcelsPerOrder: 50,
  /** Parcels one batch (one driver allocation) may carry. */
  maxParcelsPerBatch: 50,
  /** Orders one batch may group. */
  maxOrdersPerBatch: 50,
  /** Orders accepted by one bulk upload. */
  maxBulkUploadOrders: 50,
  /** Largest accepted CSV payload, in characters. */
  maxBulkCsvChars: 48_000,
  /** Size-weighted load one driver vehicle carries (S=1, M=2, L=4). */
  maxBatchLoadUnits: 80,
  /** Large parcels one batch may hold, so a vehicle is never filled with bulky items. */
  maxLargeParcelsPerBatch: 12,
  /** Pickups of grouped orders must lie within this distance. */
  pickupRadiusKm: 1,
  /** Dropoffs in one batch must stay within this distance of the batch's first dropoff. */
  dropoffSpreadKm: 6,
  /** Abuse limits per merchant. */
  bulkSubmitsPerHour: 10,
  bulkPreviewsPerHour: 60
} as const;

export type ParcelSize = "S" | "M" | "L";

export const PARCEL_LOAD_UNITS: Record<ParcelSize, number> = { S: 1, M: 2, L: 4 };
