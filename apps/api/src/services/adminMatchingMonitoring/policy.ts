import { Prisma } from "../../generated/prisma/client.js";

export const eligibleParcel = {
  operational_mode: "legacy",
  canonical_entry_version: null,
  route_version_id: null
} satisfies Prisma.ParcelWhereInput;

export const eligiblePassenger = {
  operational_mode: "legacy",
  canonical_entry_version: null,
  route_version_id: null,
  source: "manual",
  passenger: { is: { demo_account: false } }
} satisfies Prisma.PassengerRequestWhereInput;

const orderProvenance = {
  operational_mode: "legacy",
  canonical_entry_version: null,
  route_version_id: null,
  merchant: { is: { demo_account: false } }
} satisfies Prisma.MerchantOrderWhereInput;

export const eligibleOrder = {
  ...orderProvenance,
  parcels: { every: eligibleParcel }
} satisfies Prisma.MerchantOrderWhereInput;

export const eligibleRoute = {
  operational_mode: "legacy",
  canonical_availability_version: null,
  route_version_id: null,
  driver: { is: { user: { is: { demo_account: false } } } }
} satisfies Prisma.DriverRouteWhereInput;

export const eligibleBatch = {
  merchant_order: { is: eligibleOrder },
  OR: [
    { driver_route_id: null },
    { driver_route: { is: eligibleRoute } }
  ]
} satisfies Prisma.ParcelBatchWhereInput;

export const eligibleMatch = {
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
    // Keep each order's parcel exclusion outside the nullable relation OR.
    // MySQL otherwise repeats its correlated scan at multiple left-join stages.
    // The direct order and batch order are independent and both remain checked.
    { NOT: { merchant_order: { is: { parcels: { some: { NOT: eligibleParcel } } } } } },
    { NOT: { parcel_batch: { is: { merchant_order: { is: { parcels: { some: { NOT: eligibleParcel } } } } } } } }
  ]
} satisfies Prisma.MatchWhereInput;

const countedOrderSelect = {
  id: true,
  status: true,
  _count: { select: { parcels: { where: eligibleParcel } } }
} satisfies Prisma.MerchantOrderSelect;

export const matchSelect = {
  id: true,
  status: true,
  created_at: true,
  score: true,
  method: true,
  driver_route: { select: { id: true, status: true } },
  passenger_request: { select: { id: true, status: true, passenger_count: true } },
  merchant_order: { select: countedOrderSelect },
  parcel_batch: { select: { id: true, status: true } }
} satisfies Prisma.MatchSelect;

export const batchSelect = {
  id: true,
  status: true,
  created_at: true,
  merchant_order: { select: countedOrderSelect },
  driver_route: { select: { id: true, status: true } }
} satisfies Prisma.ParcelBatchSelect;

export const parcelSelect = {
  id: true,
  status: true
} satisfies Prisma.ParcelSelect;
