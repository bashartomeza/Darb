import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";

/**
 * Display-only route fares.
 *
 * Payments are not processed in the app, so a fare is an estimate that the
 * passenger or merchant pays the driver directly. Amounts are integer minor
 * units (agorot) so no floating point ever touches money. Fares belong to the
 * canonical route (ServiceRoute), not to a route version, so a re-published
 * version keeps its tariff; history is append-only and versioned by
 * `effective_from`, the same way route versions are.
 */
export const FARE_CURRENCY = "ILS";
/** 100,000.00 ILS: well above any plausible tariff, well inside INT. */
export const MAX_FARE_MINOR = 10_000_000;
export const FARE_ITEMS = ["passenger_seat", "parcel_s", "parcel_m", "parcel_l"] as const;
export type FareItem = (typeof FARE_ITEMS)[number];
export type ParcelSize = "S" | "M" | "L";
/** A new tariff may start now or later; small backdating absorbs clock skew only. */
export const FARE_BACKDATE_TOLERANCE_MS = 5 * 60_000;
/** Far-future tariffs are almost always a typo (year 2206 instead of 2026). */
export const FARE_MAX_SCHEDULE_DAYS = 366;
export const FARE_HISTORY_LIMIT = 200;

export function parcelFareItem(size: string): FareItem {
  const item = `parcel_${size.toLowerCase()}`;
  if (!(FARE_ITEMS as readonly string[]).includes(item) || item === "passenger_seat") {
    throw new HttpError(400, "invalid_parcel_size");
  }
  return item as FareItem;
}

export function isValidFareMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_FARE_MINOR;
}

/** Seat fare for a party: integer multiplication only, so there is nothing to round. */
export function seatFareTotal(unitMinor: number, passengerCount: number): number {
  if (!isValidFareMinor(unitMinor) || !Number.isInteger(passengerCount) || passengerCount < 1) {
    throw new HttpError(400, "invalid_fare_input");
  }
  const total = unitMinor * passengerCount;
  if (!Number.isSafeInteger(total) || total > 2_147_483_647) throw new HttpError(400, "invalid_fare_input");
  return total;
}

/** Locale-neutral decimal string, e.g. 1250 -> "12.50". Clients localise digits. */
export function formatMinor(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError("minor units must be a non-negative integer");
  const whole = Math.trunc(minor / 100);
  const cents = String(minor % 100).padStart(2, "0");
  return `${whole}.${cents}`;
}

type FareRow = {
  id: string;
  service_route_id: string;
  item: string;
  amount_minor: number | null;
  currency: string;
  effective_from: Date;
  created_at: Date;
};

export type EffectiveFare = { id: string; amountMinor: number; currency: string; effectiveFrom: Date };
export type RouteFareSet = Record<FareItem, EffectiveFare | null>;

function emptySet(): RouteFareSet {
  return { passenger_seat: null, parcel_s: null, parcel_m: null, parcel_l: null };
}

function newerFirst(a: FareRow, b: FareRow) {
  return (
    b.effective_from.getTime() - a.effective_from.getTime() ||
    b.created_at.getTime() - a.created_at.getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/**
 * Pure resolution: per item, the newest row whose effective_from is not after
 * `at`. A withdrawal row (null amount) hides every older fare for that item.
 */
export function resolveEffectiveFares(rows: FareRow[], at: Date): Map<string, RouteFareSet> {
  const result = new Map<string, RouteFareSet>();
  const decided = new Set<string>();
  for (const row of [...rows].sort(newerFirst)) {
    if (row.effective_from.getTime() > at.getTime()) continue;
    if (!(FARE_ITEMS as readonly string[]).includes(row.item)) continue;
    const item = row.item as FareItem;
    const set = result.get(row.service_route_id) ?? emptySet();
    result.set(row.service_route_id, set);
    const key = `${row.service_route_id}:${item}`;
    if (decided.has(key)) continue;
    decided.add(key);
    set[item] =
      row.amount_minor === null
        ? null
        : { id: row.id, amountMinor: row.amount_minor, currency: row.currency, effectiveFrom: row.effective_from };
  }
  return result;
}

export type FareView = {
  currency: string;
  estimated: true;
  paid_directly_to_driver: true;
  passenger_seat_minor: number | null;
  parcel_minor: { S: number | null; M: number | null; L: number | null };
};

/** Public/driver-facing tariff for one route. Null when nothing is published. */
export function serializeFareSet(set: RouteFareSet | undefined): FareView | null {
  if (!set) return null;
  const passenger = set.passenger_seat;
  const s = set.parcel_s;
  const m = set.parcel_m;
  const l = set.parcel_l;
  if (!passenger && !s && !m && !l) return null;
  return {
    currency: FARE_CURRENCY,
    estimated: true,
    paid_directly_to_driver: true,
    passenger_seat_minor: passenger?.amountMinor ?? null,
    parcel_minor: { S: s?.amountMinor ?? null, M: m?.amountMinor ?? null, L: l?.amountMinor ?? null }
  };
}

export type SnapshotFare = { fare_id: string; unit_minor: number; currency: string };

export type PassengerFareSnapshot = {
  fare_id: string | null;
  fare_unit_minor: number | null;
  fare_total_minor: number | null;
  fare_currency: string | null;
};

export type ParcelFareSnapshot = {
  fare_id: string | null;
  fare_minor: number | null;
  fare_currency: string | null;
};

type Database = PrismaClient | Prisma.TransactionClient;

export type FareChangeEntry = {
  item: FareItem;
  /** Integer agorot, or null to withdraw the fare for this item. */
  amountMinor: number | null;
};

export function createRouteFareService(db: PrismaClient = prisma) {
  async function effectiveFor(client: Database, routeIds: string[], at: Date) {
    const ids = [...new Set(routeIds)];
    if (ids.length === 0) return new Map<string, RouteFareSet>();
    const rows = await client.routeFare.findMany({
      where: { service_route_id: { in: ids }, effective_from: { lte: at } },
      orderBy: [{ effective_from: "desc" }, { created_at: "desc" }, { id: "desc" }]
    });
    return resolveEffectiveFares(rows as FareRow[], at);
  }

  return {
    effectiveFor,

    /** Tariffs for many routes at once (catalog, departures, offers). */
    async fareViewsForRoutes(routeIds: string[], at: Date = new Date(), client: Database = db) {
      const sets = await effectiveFor(client, routeIds, at);
      return new Map([...sets].map(([routeId, set]) => [routeId, serializeFareSet(set)] as const));
    },

    /** Fare for one passenger booking, frozen into the request row. */
    async passengerSnapshot(client: Database, routeId: string, passengerCount: number, at: Date): Promise<PassengerFareSnapshot> {
      const set = (await effectiveFor(client, [routeId], at)).get(routeId);
      const fare = set?.passenger_seat ?? null;
      if (!fare) return { fare_id: null, fare_unit_minor: null, fare_total_minor: null, fare_currency: null };
      return {
        fare_id: fare.id,
        fare_unit_minor: fare.amountMinor,
        fare_total_minor: seatFareTotal(fare.amountMinor, passengerCount),
        fare_currency: fare.currency
      };
    },

    /** Fare per parcel size, frozen into each parcel row. */
    async parcelSnapshots(client: Database, routeId: string, sizes: string[], at: Date): Promise<ParcelFareSnapshot[]> {
      const set = (await effectiveFor(client, [routeId], at)).get(routeId);
      return sizes.map((size) => {
        const fare = set?.[parcelFareItem(size)] ?? null;
        return fare
          ? { fare_id: fare.id, fare_minor: fare.amountMinor, fare_currency: fare.currency }
          : { fare_id: null, fare_minor: null, fare_currency: null };
      });
    },

    async history(routeId: string, now: Date = new Date()) {
      const route = await db.serviceRoute.findUnique({ where: { id: routeId }, select: { id: true } });
      if (!route) throw new HttpError(404, "route_not_found");
      const rows = await db.routeFare.findMany({
        where: { service_route_id: routeId },
        orderBy: [{ effective_from: "desc" }, { created_at: "desc" }, { id: "desc" }],
        take: FARE_HISTORY_LIMIT,
        include: { created_by: { select: { id: true, name: true } } }
      });
      const current = (await effectiveFor(db, [routeId], now)).get(routeId);
      return { rows, current: serializeFareSet(current), currentSet: current ?? emptySet() };
    },

    /**
     * Append one history row per changed item. Items whose requested amount
     * equals the fare already in force (or already scheduled last) are skipped
     * so a no-op save does not pollute the audit history.
     */
    async setFares(
      routeId: string,
      entries: FareChangeEntry[],
      options: { effectiveFrom?: Date; reason: string },
      actor: { id: string; requestId?: string },
      now: Date = new Date()
    ) {
      const seen = new Set<string>();
      for (const entry of entries) {
        if (seen.has(entry.item)) throw new HttpError(400, "duplicate_fare_item");
        seen.add(entry.item);
        if (entry.amountMinor !== null && !isValidFareMinor(entry.amountMinor)) throw new HttpError(400, "invalid_fare_amount");
      }
      if (entries.length === 0) throw new HttpError(400, "no_fare_changes");
      const effectiveFrom = options.effectiveFrom ?? now;
      if (effectiveFrom.getTime() < now.getTime() - FARE_BACKDATE_TOLERANCE_MS) {
        throw new HttpError(400, "fare_effective_from_in_past");
      }
      if (effectiveFrom.getTime() > now.getTime() + FARE_MAX_SCHEDULE_DAYS * 86_400_000) {
        throw new HttpError(400, "fare_effective_from_too_far");
      }
      return db.$transaction(async (tx) => {
        // Same lock the canonical request path takes, so a fare change and a
        // booking are strictly ordered and the snapshot is unambiguous.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM service_routes WHERE id = ${routeId} FOR UPDATE
        `;
        if (locked.length !== 1) throw new HttpError(404, "route_not_found");
        // "Latest" here means in force at the new effective date, which is what
        // a no-op comparison must use for scheduled changes too.
        const latest = (await effectiveFor(tx, [routeId], effectiveFrom)).get(routeId) ?? emptySet();
        const created = [];
        for (const entry of entries) {
          const before = latest[entry.item]?.amountMinor ?? null;
          if (before === entry.amountMinor) continue;
          created.push(
            await tx.routeFare.create({
              data: {
                service_route_id: routeId,
                item: entry.item,
                amount_minor: entry.amountMinor,
                currency: FARE_CURRENCY,
                effective_from: effectiveFrom,
                reason: options.reason,
                created_by_user_id: actor.id
              }
            })
          );
        }
        if (created.length === 0) throw new HttpError(409, "fare_unchanged");
        await auditEvent(tx, {
          userId: actor.id,
          action: AuditAction.admin_action,
          entityType: "ServiceRoute",
          entityId: routeId,
          metadata: {
            event: "route_fares_changed",
            effective_from: effectiveFrom.toISOString(),
            reason: options.reason,
            changes: created.map((row) => ({
              fare_id: row.id,
              item: row.item,
              amount_minor: row.amount_minor
            })),
            request_id: actor.requestId ?? null
          }
        });
        return created;
      });
    }
  };
}

export type RouteFareService = ReturnType<typeof createRouteFareService>;
export const routeFareService = createRouteFareService();

/** Response shape for a booking's frozen fare. */
export function snapshotResponse(snapshot: {
  unit_minor?: number | null;
  total_minor: number | null;
  currency: string | null;
}) {
  if (snapshot.total_minor === null || snapshot.currency === null) return null;
  return {
    currency: snapshot.currency,
    unit_minor: snapshot.unit_minor ?? null,
    total_minor: snapshot.total_minor,
    estimated: true as const,
    paid_directly_to_driver: true as const
  };
}

export function passengerFareResponse(row: Record<string, unknown> | null | undefined) {
  if (!row) return null;
  return snapshotResponse({
    unit_minor: (row.fare_unit_minor as number | null | undefined) ?? null,
    total_minor: (row.fare_total_minor as number | null | undefined) ?? null,
    currency: (row.fare_currency as string | null | undefined) ?? null
  });
}

export function parcelFareResponse(row: Record<string, unknown> | null | undefined) {
  if (!row) return null;
  const minor = (row.fare_minor as number | null | undefined) ?? null;
  return snapshotResponse({ unit_minor: minor, total_minor: minor, currency: (row.fare_currency as string | null | undefined) ?? null });
}

/** Order total, only when every parcel has a frozen fare (otherwise a partial sum would mislead). */
export function orderFareResponse(parcels: Array<Record<string, unknown>> | undefined) {
  if (!parcels || parcels.length === 0) return null;
  let total = 0;
  let currency: string | null = null;
  for (const parcel of parcels) {
    const minor = parcel.fare_minor;
    const cur = parcel.fare_currency;
    if (typeof minor !== "number" || typeof cur !== "string") return null;
    if (currency !== null && currency !== cur) return null;
    currency = cur;
    total += minor;
  }
  return snapshotResponse({ total_minor: total, currency });
}
