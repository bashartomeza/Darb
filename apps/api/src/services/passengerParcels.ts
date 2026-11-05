import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { maskPhone } from "../lib/phone.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import {
  canonicalDemandService,
  type CanonicalDemandService
} from "./canonicalDemand.js";
import { issueHandover } from "./deliveryHandover.js";
import { releaseLegacyCapacity } from "./legacyCapacity.js";
import { createLegacyMerchantOrder } from "./legacyMerchantOrders.js";
import { routeFields, routeSummarySelect } from "./operatingRoutes.js";
import { parcelFareResponse } from "./routeFares.js";

/**
 * Parcels sent by ordinary passengers ("individual delivery").
 *
 * A passenger parcel is a normal parcel order whose owner happens to be a
 * passenger. Route-based parcels (the default) are legacy merchant orders
 * created by the same `createLegacyMerchantOrder` the merchant orders use, on
 * the route the passenger picked, so they are matched to driver routes on that
 * route by the legacy matcher and closed with the same receiver handover code.
 * The canonical body (route version + stop ids) still goes through the
 * canonical `createMerchantOrder` while MULTI_ROUTE_ENTRY_ENABLED is on.
 * Either way the only extra state is one `PassengerParcelDetail` row holding
 * what is specific to a person-to-person parcel: the receiver (who is not an
 * app user), an optional note and the forbidden-items acknowledgement.
 */
export const PASSENGER_PARCEL_LIMITS = {
  /** Parcels a passenger may have in flight at once. */
  maximumOpen: 3,
  /** Parcels a passenger may create in any rolling 24 hours. */
  maximumPerDay: 10,
  /** Large parcels are for shops; people may send small and medium. */
  allowedSizes: ["S", "M"] as const,
  noteMaxLength: 200,
  receiverNameMaxLength: 80,
  /** Receiver data is erased this long after the end of the departure window. */
  receiverRetentionDays: 14,
  /** A route-based parcel waits this long after its preferred time before it expires. */
  routeDepartureWindowMinutes: 120
} as const;

const LEGACY_PARCEL_OPERATION = "passenger_parcel_route_create_v1";

export type PassengerParcelSize = (typeof PASSENGER_PARCEL_LIMITS.allowedSizes)[number];

const OPEN_ORDER_STATUSES = ["submitted", "batched", "matched", "assigned", "in_transit"] as const;

export type PassengerParcelInput = {
  routeVersionId: string;
  pickupStopId: string;
  dropoffStopId: string;
  requestedDepartureFrom: Date;
  requestedDepartureUntil: Date;
  size: PassengerParcelSize;
  note?: string;
  receiverName: string;
  /** Already normalised to E.164 by the caller. */
  receiverPhone: string;
  forbiddenItemsAcknowledged: true;
};

/** The route-based body: a predefined route and the exact pickup and drop-off as text. */
export type RoutePassengerParcelInput = {
  serviceRouteId: string;
  pickupDetails: string;
  dropoffDetails: string;
  preferredTime: Date;
  size: PassengerParcelSize;
  note?: string;
  receiverName: string;
  /** Already normalised to E.164 by the caller. */
  receiverPhone: string;
  forbiddenItemsAcknowledged: true;
};

export type PassengerParcelCreatedContext = {
  tx: Prisma.TransactionClient;
  senderId: string;
  orderId: string;
  parcelId: string;
  detailId: string;
  routeVersionId: string;
  receiverName: string;
  receiverPhone: string;
};

/**
 * Creation hook. Runs inside the creation transaction, once per new parcel
 * (never on an idempotent replay), after the order, parcel and detail rows exist
 * and before the transaction commits. A thrown error rolls the parcel back.
 * The receiver handover-code service plugs in here.
 */
export type PassengerParcelHooks = {
  onCreated?: (context: PassengerParcelCreatedContext) => Promise<void>;
};

type Actor = { id: string; requestId?: string; idempotencyKey: string };

/** What the passenger sees. Each value has an English and Arabic label in the app and admin. */
export type PassengerParcelTrackingState =
  | "searching"
  | "assigned"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "cancelled"
  | "failed"
  | "expired";

export function passengerParcelTrackingState(order: { status: string }, parcelStatus: string | undefined): PassengerParcelTrackingState {
  if (order.status === "completed" || order.status === "delivered") return "delivered";
  switch (parcelStatus) {
    case "assigned": return "assigned";
    case "picked_up": return "picked_up";
    case "in_transit": return "in_transit";
    case "delivered": return "delivered";
    case "cancelled": return "cancelled";
    case "failed": return "failed";
    case "expired": return "expired";
    case "pending":
    case "batched":
      return "searching";
    default:
      break;
  }
  switch (order.status) {
    case "assigned": return "assigned";
    case "in_transit": return "in_transit";
    case "cancelled": return "cancelled";
    case "failed": return "failed";
    case "expired": return "expired";
    default: return "searching";
  }
}

const detailInclude = {
  order: {
    include: {
      parcels: true,
      canonical_dispatch: { select: { status: true } },
      route_version: routeSummarySelect,
      trips: { select: { id: true, status: true }, orderBy: { created_at: "desc" as const }, take: 1 }
    }
  }
} satisfies Prisma.PassengerParcelDetailInclude;

type DetailWithOrder = Prisma.PassengerParcelDetailGetPayload<{ include: typeof detailInclude }>;

type CancellableShape = {
  order: {
    status: string;
    canonical_entry_version?: string | null;
    canonical_dispatch?: { status: string } | null;
    parcels: Array<{ status: string }>;
  };
};

/**
 * A route-based (legacy) parcel can be cancelled until a driver accepts it:
 * an offer still waiting for the driver is withdrawn. A canonical parcel can
 * be cancelled while no driver has been offered or assigned it.
 */
function isLegacyParcel(detail: CancellableShape) {
  return !detail.order.canonical_entry_version && !detail.order.canonical_dispatch;
}

function isCancellable(detail: CancellableShape) {
  const parcel = detail.order.parcels[0];
  if (isLegacyParcel(detail)) {
    return ["submitted", "matched"].includes(detail.order.status) && parcel?.status === "pending";
  }
  const dispatchStatus = detail.order.canonical_dispatch?.status;
  return (
    detail.order.status === "submitted" &&
    parcel?.status === "pending" &&
    (dispatchStatus === undefined || dispatchStatus === "pending" || dispatchStatus === "unavailable")
  );
}

/** The sender's own view. Receiver data appears here and nowhere else. */
export function serializePassengerParcel(detail: DetailWithOrder) {
  const parcel = detail.order.parcels[0];
  const tracking = passengerParcelTrackingState(detail.order, parcel?.status);
  const purged = detail.receiver_purged_at !== null;
  return {
    id: detail.order_id,
    tracking_state: tracking,
    route_version_id: detail.order.route_version_id,
    ...routeFields(detail.order.route_version),
    pickup_stop_id: detail.order.pickup_stop_id,
    dropoff_stop_id: parcel?.destination_stop_id ?? null,
    pickup_label: detail.order.pickup_label,
    dropoff_label: parcel?.destination_label ?? null,
    pickup_details: detail.order.pickup_details ?? null,
    dropoff_details: parcel?.dropoff_details ?? null,
    size: detail.size,
    // The size fare frozen at creation; null when the route had no fare.
    fare: parcelFareResponse(parcel as Record<string, unknown> | undefined),
    note: purged ? null : detail.note,
    receiver_name: purged ? null : detail.receiver_name,
    receiver_phone_masked: purged || !detail.receiver_phone ? null : maskPhone(detail.receiver_phone),
    receiver_details_removed: purged,
    requested_departure_from: detail.order.requested_departure_from,
    requested_departure_until: detail.order.requested_departure_until,
    // The trip carrying the parcel once a driver accepted it (GET /trips/:id).
    trip_id: detail.order.trips?.[0]?.id ?? null,
    created_at: detail.created_at,
    can_cancel: isCancellable(detail)
  };
}

export function createPassengerParcelService(
  db: PrismaClient = prisma,
  demand: CanonicalDemandService = canonicalDemandService,
  hooks: PassengerParcelHooks = {}
) {
  async function lockRow(tx: Prisma.TransactionClient, table: "users" | "merchant_orders" | "canonical_demand_dispatches", id: string) {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`,
      id
    );
    return rows.length === 1;
  }

  async function load(senderId: string, orderId: string, client: Prisma.TransactionClient | PrismaClient = db) {
    return client.passengerParcelDetail.findFirst({
      where: { order_id: orderId, sender_id: senderId },
      include: detailInclude
    });
  }

  /** Serialises this passenger's creations so the limits cannot be raced past by parallel requests. */
  async function enforceLimits(tx: Prisma.TransactionClient, senderId: string) {
    await lockRow(tx, "users", senderId);
    const open = await tx.passengerParcelDetail.count({
      where: { sender_id: senderId, order: { status: { in: [...OPEN_ORDER_STATUSES] } } }
    });
    if (open >= PASSENGER_PARCEL_LIMITS.maximumOpen) throw new HttpError(409, "passenger_parcel_limit_reached");
    const recent = await tx.passengerParcelDetail.count({
      where: { sender_id: senderId, created_at: { gte: new Date(Date.now() - 86_400_000) } }
    });
    if (recent >= PASSENGER_PARCEL_LIMITS.maximumPerDay) throw new HttpError(429, "passenger_parcel_daily_limit_reached");
  }

  /**
   * Cancels a route-based parcel the order row is already locked for. An
   * offer still waiting for its driver is withdrawn and the capacity it held
   * is given back, the same steps a merchant cancellation takes.
   */
  async function cancelRouteParcel(tx: Prisma.TransactionClient, senderId: string, orderId: string, current: DetailWithOrder) {
    if (!isCancellable(current)) throw new HttpError(409, "parcel_cannot_be_cancelled");
    const offers = await tx.match.findMany({
      where: { merchant_order_id: orderId, operational_mode: "legacy", status: { in: ["proposed", "sent_to_driver"] } },
      select: { id: true, driver_route_id: true, legacy_capacity_held: true }
    });
    const parcelUnits = await tx.parcel.count({
      where: { order_id: orderId, status: { notIn: ["cancelled", "failed", "expired"] } }
    });
    if (parcelUnits > 0) {
      const heldRoutes = new Set(offers.filter((offer) => offer.legacy_capacity_held).map((offer) => offer.driver_route_id));
      for (const driverRouteId of heldRoutes) {
        await releaseLegacyCapacity(tx, { driverRouteId, seats: 0, parcelUnits });
      }
    }
    if (offers.length > 0) {
      await tx.match.updateMany({
        where: { id: { in: offers.map((offer) => offer.id) } },
        data: { status: "invalidated", legacy_demand_key: null, legacy_capacity_held: false }
      });
    }
    const claimed = await tx.merchantOrder.updateMany({
      where: { id: orderId, status: { in: ["submitted", "matched"] } },
      data: { status: "cancelled" }
    });
    if (claimed.count !== 1) throw new HttpError(409, "parcel_cannot_be_cancelled");
    await tx.parcel.updateMany({ where: { order_id: orderId, status: "pending" }, data: { status: "cancelled" } });
    // The receiver is no longer needed: erase now rather than at expiry.
    await tx.passengerParcelDetail.update({
      where: { order_id: orderId },
      data: { receiver_name: null, receiver_phone: null, note: null, receiver_purged_at: new Date() }
    });
    await auditEvent(tx, {
      userId: senderId,
      action: AuditAction.merchant_order_cancelled,
      entityType: "MerchantOrder",
      entityId: orderId,
      metadata: { action: "passenger_parcel_cancelled", withdrawn_offers: offers.length }
    });
    return (await load(senderId, orderId, tx))!;
  }

  function validate(input: { size: string; forbiddenItemsAcknowledged: boolean; note?: string }) {
    if (!(PASSENGER_PARCEL_LIMITS.allowedSizes as readonly string[]).includes(input.size)) throw new HttpError(400, "parcel_size_not_allowed");
    if (input.forbiddenItemsAcknowledged !== true) throw new HttpError(400, "forbidden_items_acknowledgement_required");
    if (input.note && input.note.length > PASSENGER_PARCEL_LIMITS.noteMaxLength) throw new HttpError(400, "note_too_long");
  }

  return {
    /**
     * Route-based parcel: a legacy order owned by the passenger on the route
     * they picked, with the pickup and drop-off as text. The order creation
     * issues the receiver handover code, exactly as for merchant orders.
     */
    async createForRoute(input: RoutePassengerParcelInput, actor: Actor) {
      validate(input);
      const until = new Date(input.preferredTime.getTime() + PASSENGER_PARCEL_LIMITS.routeDepartureWindowMinutes * 60_000);
      const result = await createLegacyMerchantOrder(
        actor.id,
        {
          service_route_id: input.serviceRouteId,
          pickup_details: input.pickupDetails,
          parcels: [{ dropoff_details: input.dropoffDetails, size: input.size, priority: "normal" }]
        },
        actor.idempotencyKey,
        {
          operation: LEGACY_PARCEL_OPERATION,
          digestExtension: { note: input.note ?? null, receiver_name: input.receiverName, receiver_phone: input.receiverPhone },
          requestedDeparture: { from: input.preferredTime, until },
          replayWhere: { passenger_parcel: { is: { sender_id: actor.id } } },
          auditMetadata: { kind: "passenger_parcel" },
          beforeCreate: async (tx) => {
            if (input.preferredTime <= new Date()) throw new HttpError(400, "preferred_time_in_past");
            await enforceLimits(tx, actor.id);
          },
          afterCreate: async (tx, created) => {
            await tx.passengerParcelDetail.create({
              data: {
                order_id: created.orderId,
                sender_id: actor.id,
                size: input.size,
                note: input.note?.trim() || null,
                receiver_name: input.receiverName,
                receiver_phone: input.receiverPhone,
                forbidden_items_ack_at: new Date(),
                retention_expires_at: new Date(until.getTime() + PASSENGER_PARCEL_LIMITS.receiverRetentionDays * 86_400_000)
              }
            });
          }
        },
        db
      );
      const detail = await load(actor.id, result.order.id);
      // A replay of a key whose original was not a passenger parcel cannot be served.
      if (!detail) throw new HttpError(409, "idempotency_replay_unavailable");
      return { parcel: detail, replayed: result.replayed, handoverCode: result.handoverCode };
    },

    async create(input: PassengerParcelInput, actor: Actor) {
      validate(input);

      const result = await demand.createMerchantOrder(
        {
          routeVersionId: input.routeVersionId,
          pickupStopId: input.pickupStopId,
          requestedDepartureFrom: input.requestedDepartureFrom,
          requestedDepartureUntil: input.requestedDepartureUntil,
          parcels: [{ destinationStopId: input.dropoffStopId, size: input.size, priority: "normal" }]
        },
        actor,
        {
          operation: "passenger_parcel_create",
          digestExtension: {
            note: input.note ?? null,
            receiver_name: input.receiverName,
            receiver_phone: input.receiverPhone
          },
          auditMetadata: { kind: "passenger_parcel" },
          beforeCreate: async (tx) => {
            await enforceLimits(tx, actor.id);
          },
          afterCreate: async (tx, created) => {
            const now = new Date();
            const detail = await tx.passengerParcelDetail.create({
              data: {
                order_id: created.orderId,
                sender_id: actor.id,
                size: input.size,
                note: input.note?.trim() || null,
                receiver_name: input.receiverName,
                receiver_phone: input.receiverPhone,
                forbidden_items_ack_at: now,
                retention_expires_at: new Date(
                  input.requestedDepartureUntil.getTime() + PASSENGER_PARCEL_LIMITS.receiverRetentionDays * 86_400_000
                )
              }
            });
            await hooks.onCreated?.({
              tx,
              senderId: actor.id,
              orderId: created.orderId,
              parcelId: created.parcelIds[0],
              detailId: detail.id,
              routeVersionId: created.routeVersionId,
              receiverName: input.receiverName,
              receiverPhone: input.receiverPhone
            });
          }
        }
      );
      const detail = await load(actor.id, result.resource.id);
      // A replay of a key whose original was not a passenger parcel cannot be served.
      if (!detail) throw new HttpError(409, "idempotency_replay_unavailable");
      return { parcel: detail, replayed: result.replayed };
    },

    async list(senderId: string, limit = 50) {
      return db.passengerParcelDetail.findMany({
        where: { sender_id: senderId },
        include: detailInclude,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: Math.min(Math.max(limit, 1), 100)
      });
    },

    async get(senderId: string, orderId: string) {
      const detail = await load(senderId, orderId);
      if (!detail) throw new HttpError(404, "parcel_not_found");
      return detail;
    },

    /** Cancel while no driver has been offered or assigned the parcel. */
    async cancel(senderId: string, orderId: string) {
      return db.$transaction(async (tx) => {
        const owned = await load(senderId, orderId, tx);
        if (!owned) throw new HttpError(404, "parcel_not_found");
        const dispatch = await tx.canonicalDemandDispatch.findUnique({
          where: { merchant_order_id: orderId },
          select: { id: true }
        });
        // Same lock order as matching: dispatch, then the order and its parcels.
        if (dispatch) await lockRow(tx, "canonical_demand_dispatches", dispatch.id);
        await lockRow(tx, "merchant_orders", orderId);
        const current = await load(senderId, orderId, tx);
        if (!current) throw new HttpError(404, "parcel_not_found");
        if (isLegacyParcel(current)) return cancelRouteParcel(tx, senderId, orderId, current);
        const parcel = current.order.parcels[0];
        const dispatchStatus = current.order.canonical_dispatch?.status;
        const unmatched =
          current.order.status === "submitted" &&
          parcel?.status === "pending" &&
          (dispatchStatus === undefined || dispatchStatus === "pending" || dispatchStatus === "unavailable");
        if (!unmatched) throw new HttpError(409, "parcel_cannot_be_cancelled");

        const claimed = await tx.merchantOrder.updateMany({
          where: { id: orderId, status: "submitted" },
          data: { status: "cancelled" }
        });
        if (claimed.count !== 1) throw new HttpError(409, "parcel_cannot_be_cancelled");
        await tx.parcel.updateMany({ where: { order_id: orderId, status: "pending" }, data: { status: "cancelled" } });
        if (dispatch) {
          await tx.canonicalDemandDispatch.updateMany({
            where: { id: dispatch.id, status: { in: ["pending", "unavailable"] } },
            data: { status: "cancelled", revision: { increment: 1 } }
          });
        }
        // The receiver is no longer needed: erase now rather than at expiry.
        await tx.passengerParcelDetail.update({
          where: { order_id: orderId },
          data: { receiver_name: null, receiver_phone: null, note: null, receiver_purged_at: new Date() }
        });
        await auditEvent(tx, {
          userId: senderId,
          action: AuditAction.merchant_order_cancelled,
          entityType: "MerchantOrder",
          entityId: orderId,
          metadata: { action: "passenger_parcel_cancelled" }
        });
        return (await load(senderId, orderId, tx))!;
      });
    }
  };
}

/**
 * Gives every new parcel a receiver handover code, in the creation transaction. The
 * plain code is not kept anywhere: the sender reads or renews it from the parcel
 * (the "Get a new code" action), so a created parcel is never without a handover.
 */
export async function issueHandoverOnCreated(context: Pick<PassengerParcelCreatedContext, "tx" | "orderId">) {
  await issueHandover(context.tx, context.orderId);
}

export type PassengerParcelService = ReturnType<typeof createPassengerParcelService>;
export const passengerParcelService = createPassengerParcelService(prisma, canonicalDemandService, {
  onCreated: issueHandoverOnCreated
});

/**
 * Erases receiver name, phone and note once the retention date has passed.
 * Idempotent; safe to run from a daily scheduled job.
 */
export async function purgeExpiredPassengerParcelReceivers(db: PrismaClient, options: { now?: Date; batchSize?: number } = {}) {
  const now = options.now ?? new Date();
  const expired = await db.passengerParcelDetail.findMany({
    where: { retention_expires_at: { lt: now }, receiver_purged_at: null },
    select: { id: true },
    take: options.batchSize ?? 500,
    orderBy: { retention_expires_at: "asc" }
  });
  if (expired.length === 0) return { purged: 0 };
  const result = await db.passengerParcelDetail.updateMany({
    where: { id: { in: expired.map((row) => row.id) }, receiver_purged_at: null },
    data: { receiver_name: null, receiver_phone: null, note: null, receiver_purged_at: now }
  });
  return { purged: result.count };
}

/** Admin overview: tracking state only. Receiver data is deliberately not selected. */
export async function listPassengerParcelsForAdmin(db: PrismaClient = prisma, limit = 100) {
  const rows = await db.passengerParcelDetail.findMany({
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      order_id: true,
      size: true,
      created_at: true,
      sender: { select: { id: true, name: true } },
      order: {
        select: {
          status: true,
          pickup_label: true,
          pickup_details: true,
          requested_departure_from: true,
          requested_departure_until: true,
          parcels: { select: { status: true, destination_label: true, dropoff_details: true } },
          canonical_dispatch: { select: { status: true } },
          route_version: routeSummarySelect
        }
      }
    }
  });
  return rows.map((row) => ({
    id: row.order_id,
    sender: row.sender,
    size: row.size,
    ...routeFields(row.order.route_version),
    pickup_label: row.order.pickup_label,
    dropoff_label: row.order.parcels[0]?.destination_label ?? null,
    pickup_details: row.order.pickup_details ?? null,
    dropoff_details: row.order.parcels[0]?.dropoff_details ?? null,
    tracking_state: passengerParcelTrackingState(row.order, row.order.parcels[0]?.status),
    dispatch_status: row.order.canonical_dispatch?.status ?? null,
    requested_departure_from: row.order.requested_departure_from,
    requested_departure_until: row.order.requested_departure_until,
    created_at: row.created_at
  }));
}
