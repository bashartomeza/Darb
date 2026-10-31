import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { TripStatus } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { adminDeliveryConfirmations } from "../services/deliveryHandover.js";
import { recomputeTrustForTrip } from "../services/driverTrust.js";
import { ADMIN_FORWARD_TRIP_TRANSITION, advanceLegacyTrip } from "../services/tripLifecycle.js";

const tripStatuses = ["created", "accepted", "pickup_started", "picked_up", "in_transit", "delivered", "completed", "cancelled"] as const;
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(100).optional(),
  status: z.enum(tripStatuses).optional(),
  kind: z.enum(["legacy", "canonical", "shared"]).optional(),
});
const mutationSchema = z.object({
  status: z.enum(["pickup_started", "picked_up", "in_transit", "delivered", "completed"]),
  expected_status: z.enum(tripStatuses),
});

const personSelect = { id: true, name: true, phone: true, demo_account: true } as const;
const tripBaseSelect = {
  id: true,
  driver_id: true,
  driver_route_id: true,
  passenger_request_id: true,
  merchant_order_id: true,
  parcel_batch_id: true,
  status: true,
  started_at: true,
  completed_at: true,
  created_at: true,
  operational_mode: true,
  canonical_trip_version: true,
  manifest_id: true,
  route_version_id: true,
  route_version: {
    select: { id: true, version_number: true, status: true, name_ar: true, name_en: true },
  },
  driver_route: {
    select: {
      id: true,
      origin_label: true,
      destination_label: true,
      departure_at: true,
      driver: {
        select: {
          id: true,
          vehicle_type: true,
          seats_total: true,
          parcel_capacity: true,
          verified: true,
          trust_score: true,
          user: { select: personSelect },
        },
      },
    },
  },
  passenger_request: {
    select: {
      id: true,
      pickup_label: true,
      destination_label: true,
      passenger_count: true,
      passenger: { select: personSelect },
    },
  },
  merchant_order: {
    select: {
      id: true,
      pickup_label: true,
      merchant: { select: personSelect },
      _count: { select: { parcels: true } },
    },
  },
  parcel_batch: { select: { id: true, status: true } },
  canonical_manifest: {
    select: {
      id: true,
      lifecycle_status: true,
      member_count: true,
      passenger_request_count: true,
      passenger_seat_count: true,
      merchant_order_count: true,
      parcel_unit_count: true,
    },
  },
  _count: { select: { location_events: true } },
} satisfies Prisma.TripSelect;

const tripDetailSelect = {
  ...tripBaseSelect,
  location_events: {
    select: { lat: true, lng: true, source: true, sequence: true, recorded_at: true },
    orderBy: [{ recorded_at: "desc" as const }, { sequence: "desc" as const }, { id: "asc" as const }],
    take: 1,
  },
  canonical_manifest: {
    select: {
      ...tripBaseSelect.canonical_manifest.select,
      members: {
        select: {
          id: true,
          demand_type: true,
          member_status: true,
          member_sequence: true,
          passenger_seats: true,
          parcel_units: true,
          passenger_request: {
            select: { id: true, passenger_count: true, passenger: { select: personSelect } },
          },
          merchant_order: {
            select: { id: true, merchant: { select: personSelect }, _count: { select: { parcels: true } } },
          },
        },
        orderBy: [{ member_sequence: "asc" as const }, { id: "asc" as const }],
        take: 100,
      },
    },
  },
} satisfies Prisma.TripSelect;

type TripListRow = Prisma.TripGetPayload<{ select: typeof tripBaseSelect }>;
type TripDetailRow = Prisma.TripGetPayload<{ select: typeof tripDetailSelect }>;

function tripKind(trip: Pick<TripListRow, "manifest_id" | "operational_mode" | "canonical_trip_version">) {
  if (trip.manifest_id) return "shared" as const;
  if (trip.operational_mode !== "legacy" || trip.canonical_trip_version) return "canonical" as const;
  return "legacy" as const;
}

function serializeTrip(trip: TripListRow) {
  const kind = tripKind(trip);
  const demoContext = Boolean(
    trip.driver_route.driver.user.demo_account ||
    trip.passenger_request?.passenger.demo_account ||
    trip.merchant_order?.merchant.demo_account,
  );
  return {
    ...trip,
    kind,
    demo_context: demoContext,
    has_stored_location: trip._count.location_events > 0,
    supported_admin_transition: kind === "legacy" ? (ADMIN_FORWARD_TRIP_TRANSITION[trip.status] ?? null) : null,
  };
}

function serializeTripDetail(trip: TripDetailRow) {
  const [location] = trip.location_events;
  const { location_events: _locations, ...base } = trip;
  return {
    ...serializeTrip(base),
    latest_stored_location: location ? {
      lat: location.lat.toString(),
      lng: location.lng.toString(),
      source: location.source,
      sequence: location.sequence,
      recorded_at: location.recorded_at,
    } : null,
  };
}

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

function kindWhere(kind: "legacy" | "canonical" | "shared" | undefined): Prisma.TripWhereInput {
  if (kind === "legacy") return { operational_mode: "legacy", canonical_trip_version: null, manifest_id: null };
  if (kind === "canonical") return {
    manifest_id: null,
    OR: [{ operational_mode: { not: "legacy" } }, { canonical_trip_version: { not: null } }],
  };
  if (kind === "shared") return { manifest_id: { not: null } };
  return {};
}

function searchWhere(search: string | undefined): Prisma.TripWhereInput {
  if (!search) return {};
  const person = { OR: [{ name: { contains: search } }, { phone: { contains: search } }] };
  return {
    OR: [
      { id: { contains: search } },
      { driver_route: { driver: { user: { is: person } } } },
      { passenger_request: { passenger: { is: person } } },
      { merchant_order: { merchant: { is: person } } },
    ],
  };
}

export const adminTripsRouter = Router();
adminTripsRouter.use("/admin/trips", requireAuth, requireRole("admin"));

adminTripsRouter.get("/admin/trips", async (req, res, next) => {
  try {
    const input = querySchema.parse(req.query);
    const where: Prisma.TripWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      AND: [kindWhere(input.kind), searchWhere(input.search)],
    };
    const [trips, total] = await prisma.$transaction([
      prisma.trip.findMany({
        where,
        select: tripBaseSelect,
        orderBy: [{ created_at: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.trip.count({ where }),
    ], { isolationLevel: "RepeatableRead" });
    const confirmations = await adminDeliveryConfirmations(prisma, trips);
    res.json({
      trips: trips.map((trip) => ({ ...serializeTrip(trip), delivery_confirmation: confirmations.get(trip.id) ?? null })),
      page: input.page,
      limit: input.limit,
      total
    });
  } catch (error) {
    next(error);
  }
});

adminTripsRouter.get("/admin/trips/:id", async (req, res, next) => {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: routeParam(req.params.id) },
      select: tripDetailSelect,
    });
    if (!trip) throw new HttpError(404, "trip_not_found");
    const confirmations = await adminDeliveryConfirmations(prisma, [trip]);
    res.json({ trip: { ...serializeTripDetail(trip), delivery_confirmation: confirmations.get(trip.id) ?? null } });
  } catch (error) {
    next(error);
  }
});

adminTripsRouter.post("/admin/trips/:id/status", async (req: AuthenticatedRequest, res, next) => {
  try {
    const tripId = routeParam(req.params.id);
    const input = mutationSchema.parse(req.body);
    const trip = await prisma.$transaction(async (tx) => {
      const current = await tx.trip.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          status: true,
          driver_route_id: true,
          passenger_request_id: true,
          merchant_order_id: true,
          parcel_batch_id: true,
          operational_mode: true,
          canonical_trip_version: true,
          manifest_id: true,
        },
      });
      if (!current) throw new HttpError(404, "trip_not_found");
      if (tripKind(current) !== "legacy") throw new HttpError(409, "admin_trip_read_only");
      if (current.status !== input.expected_status) throw new HttpError(409, "trip_status_conflict");
      if (ADMIN_FORWARD_TRIP_TRANSITION[current.status] !== input.status) {
        throw new HttpError(409, "invalid_trip_status_transition");
      }
      const updated = await advanceLegacyTrip(tx, current, input.status as TripStatus, {
        actorId: req.user!.id,
        expectedStatus: input.expected_status as TripStatus,
        adminOverride: true,
      });
      return { id: updated.id, status: updated.status };
    }, { isolationLevel: "Serializable" });
    if (trip.status === TripStatus.completed) await recomputeTrustForTrip(prisma, trip.id);
    res.json({ trip });
  } catch (error) {
    next(error);
  }
});
