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
  min_minor?: number | null;
  max_minor?: number | null;
  currency: string;
  effective_from: Date;
  created_at: Date;
};

export type EffectiveFare = {
  id: string;
  amountMinor: number;
  /** The range a driver may choose within; both null when the default is fixed. */
  minMinor: number | null;
  maxMinor: number | null;
  currency: string;
  effectiveFrom: Date;
};
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
        : {
            id: row.id,
            amountMinor: row.amount_minor,
            minMinor: row.min_minor ?? null,
            maxMinor: row.max_minor ?? null,
            currency: row.currency,
            effectiveFrom: row.effective_from
          };
  }
  return result;
}

export type FareRange = { min_minor: number; max_minor: number } | null;

export type FareView = {
  currency: string;
  estimated: true;
  paid_directly_to_driver: true;
  /** The route's default prices. */
  passenger_seat_minor: number | null;
  parcel_minor: { S: number | null; M: number | null; L: number | null };
  /** What a driver may charge instead of the default; null when it is fixed. */
  driver_price_range: {
    passenger_seat: FareRange;
    parcel: { S: FareRange; M: FareRange; L: FareRange };
  };
};

function rangeView(fare: EffectiveFare | null | undefined): FareRange {
  return fare && fare.minMinor !== null && fare.maxMinor !== null ? { min_minor: fare.minMinor, max_minor: fare.maxMinor } : null;
}

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
    parcel_minor: { S: s?.amountMinor ?? null, M: m?.amountMinor ?? null, L: l?.amountMinor ?? null },
    driver_price_range: {
      passenger_seat: rangeView(passenger),
      parcel: { S: rangeView(s), M: rangeView(m), L: rangeView(l) }
    }
  };
}

// --------------------------------------------------------------------------
// Driver prices
// --------------------------------------------------------------------------

/** The DriverRoute column holding the driver's own price for each item. */
export const DRIVER_PRICE_COLUMNS = {
  passenger_seat: "seat_price_minor",
  parcel_s: "parcel_s_price_minor",
  parcel_m: "parcel_m_price_minor",
  parcel_l: "parcel_l_price_minor"
} as const satisfies Record<FareItem, string>;

export type DriverPriceColumn = (typeof DRIVER_PRICE_COLUMNS)[FareItem];
export type DriverPriceColumns = Record<DriverPriceColumn, number | null>;
/** Prices a driver asks for, per item; an absent item takes the route's default. */
export type DriverPriceInput = Partial<Record<FareItem, number>>;

export function noDriverPrices(): DriverPriceColumns {
  return { seat_price_minor: null, parcel_s_price_minor: null, parcel_m_price_minor: null, parcel_l_price_minor: null };
}

/**
 * Checks each price the driver asked for against the range in force for that
 * item and returns the DriverRoute columns to store. A price for an item with
 * no published fare, or one whose default is fixed, is `422 driver_price_fixed`
 * (asking for exactly the fixed default is allowed); a price outside the range
 * is `422 driver_price_out_of_range`.
 */
export function validateDriverPrices(set: RouteFareSet | undefined, prices: DriverPriceInput | undefined): DriverPriceColumns {
  const columns = noDriverPrices();
  if (!prices) return columns;
  for (const item of FARE_ITEMS) {
    const asked = prices[item];
    if (asked === undefined) continue;
    if (!isValidFareMinor(asked)) throw new HttpError(422, "driver_price_out_of_range");
    const fare = set?.[item] ?? null;
    if (!fare) throw new HttpError(422, "driver_price_fixed");
    if (fare.minMinor === null || fare.maxMinor === null) {
      if (asked !== fare.amountMinor) throw new HttpError(422, "driver_price_fixed");
    } else if (asked < fare.minMinor || asked > fare.maxMinor) {
      throw new HttpError(422, "driver_price_out_of_range");
    }
    columns[DRIVER_PRICE_COLUMNS[item]] = asked;
  }
  return columns;
}

/** A driver route's own prices as the API returns them; a null item takes the route's default. */
export function driverPricesResponse(row: Record<string, unknown> | null | undefined) {
  const value = (column: DriverPriceColumn) => {
    const raw = row?.[column];
    return typeof raw === "number" ? raw : null;
  };
  return {
    currency: FARE_CURRENCY,
    passenger_seat_minor: value("seat_price_minor"),
    parcel_minor: { S: value("parcel_s_price_minor"), M: value("parcel_m_price_minor"), L: value("parcel_l_price_minor") }
  };
}

export type DriverPriceRow = Partial<Record<DriverPriceColumn, number | null>>;

/**
 * The price one driver charges for one item: their own when they set one,
 * otherwise the route's default in force. `fareId` names the tariff row in
 * force for the item (whose default or range applies), for the history.
 */
export function driverFareFor(set: RouteFareSet | undefined, driverRoute: DriverPriceRow | null | undefined, item: FareItem) {
  const fare = set?.[item] ?? null;
  const own = driverRoute?.[DRIVER_PRICE_COLUMNS[item]];
  if (typeof own === "number" && isValidFareMinor(own)) {
    return { fareId: fare?.id ?? null, unitMinor: own, currency: fare?.currency ?? FARE_CURRENCY, source: "driver" as const };
  }
  if (!fare) return null;
  return { fareId: fare.id, unitMinor: fare.amountMinor, currency: fare.currency, source: "route_default" as const };
}

/** One driver's prices for display (offers, search results): their own, else the default. */
export function driverFareView(set: RouteFareSet | undefined, driverRoute: DriverPriceRow | null | undefined) {
  const price = (item: FareItem) => driverFareFor(set, driverRoute, item)?.unitMinor ?? null;
  const seat = price("passenger_seat");
  const parcel = { S: price("parcel_s"), M: price("parcel_m"), L: price("parcel_l") };
  if (seat === null && parcel.S === null && parcel.M === null && parcel.L === null) return null;
  return {
    currency: FARE_CURRENCY,
    estimated: true as const,
    paid_directly_to_driver: true as const,
    passenger_seat_minor: seat,
    parcel_minor: parcel
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
  /**
   * The range a driver may choose within. Omitted or null: the default is
   * fixed. A withdrawn fare has no range.
   */
  range?: { minMinor: number; maxMinor: number } | null;
};

function validateRange(entry: FareChangeEntry) {
  const range = entry.range ?? null;
  if (range === null) return;
  if (entry.amountMinor === null) throw new HttpError(400, "invalid_fare_range");
  if (!isValidFareMinor(range.minMinor) || !isValidFareMinor(range.maxMinor)) throw new HttpError(400, "invalid_fare_range");
  if (range.minMinor > entry.amountMinor || entry.amountMinor > range.maxMinor) throw new HttpError(400, "invalid_fare_range");
}

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

    /**
     * The DriverRoute price columns for the prices a driver asked for, checked
     * against the range in force on [routeId] at [at]. No prices: all null
     * (the route's defaults), without reading the tariff.
     */
    async driverPriceColumns(client: Database, routeId: string, prices: DriverPriceInput | undefined, at: Date = new Date()) {
      if (!prices || Object.keys(prices).length === 0) return noDriverPrices();
      return validateDriverPrices((await effectiveFor(client, [routeId], at)).get(routeId), prices);
    },

    /** Seat fare frozen on a request booked with one driver's offer: that driver's price. */
    async passengerSnapshotForDriver(
      client: Database,
      routeId: string,
      driverRoute: DriverPriceRow,
      passengerCount: number,
      at: Date
    ): Promise<PassengerFareSnapshot> {
      const set = (await effectiveFor(client, [routeId], at)).get(routeId);
      const fare = driverFareFor(set, driverRoute, "passenger_seat");
      if (!fare) return { fare_id: null, fare_unit_minor: null, fare_total_minor: null, fare_currency: null };
      return {
        fare_id: fare.fareId,
        fare_unit_minor: fare.unitMinor,
        fare_total_minor: seatFareTotal(fare.unitMinor, passengerCount),
        fare_currency: fare.currency
      };
    },

    /**
     * Sets the saved fare of the demand a driver is offered or takes to that
     * driver's price: their own for the item, else the route's default in
     * force now. Runs inside the caller's match/accept transaction so the
     * fare and the match commit together. A request or parcel on another
     * route, or one with no price at all, keeps what it has. Each change is
     * written to the audit trail with the price before and after.
     */
    async applyDriverFare(
      tx: Prisma.TransactionClient,
      input: {
        driverRouteId: string;
        passengerRequestId?: string | null;
        merchantOrderIds?: string[];
        matchId: string;
        stage: "offered" | "accepted";
        actorId: string;
        at?: Date;
      }
    ) {
      const route = await tx.driverRoute.findUnique({
        where: { id: input.driverRouteId },
        select: {
          seat_price_minor: true,
          parcel_s_price_minor: true,
          parcel_m_price_minor: true,
          parcel_l_price_minor: true,
          route_version: { select: { service_route_id: true } }
        }
      });
      const serviceRouteId = route?.route_version?.service_route_id ?? null;
      // A driver route from before routes existed has no tariff to price from.
      if (!route || !serviceRouteId) return { passengerChanged: false, parcelsChanged: 0 };
      const set = (await effectiveFor(tx, [serviceRouteId], input.at ?? new Date())).get(serviceRouteId);
      const audit = (entityType: string, entityId: string, changes: unknown[]) =>
        auditEvent(tx, {
          userId: input.actorId,
          action: AuditAction.match_decision,
          entityType,
          entityId,
          metadata: {
            event: "fare_set_to_driver_price",
            stage: input.stage,
            match_id: input.matchId,
            driver_route_id: input.driverRouteId,
            changes
          } as Prisma.InputJsonValue
        });

      let passengerChanged = false;
      if (input.passengerRequestId) {
        const request = await tx.passengerRequest.findUnique({
          where: { id: input.passengerRequestId },
          select: {
            id: true,
            passenger_count: true,
            fare_id: true,
            fare_unit_minor: true,
            fare_total_minor: true,
            fare_currency: true,
            route_version: { select: { service_route_id: true } }
          }
        });
        const fare = driverFareFor(set, route, "passenger_seat");
        if (request && fare && request.route_version?.service_route_id === serviceRouteId) {
          const next = {
            fare_id: fare.fareId,
            fare_unit_minor: fare.unitMinor,
            fare_total_minor: seatFareTotal(fare.unitMinor, request.passenger_count),
            fare_currency: fare.currency
          };
          if (
            request.fare_id !== next.fare_id ||
            request.fare_unit_minor !== next.fare_unit_minor ||
            request.fare_total_minor !== next.fare_total_minor ||
            request.fare_currency !== next.fare_currency
          ) {
            await tx.passengerRequest.update({ where: { id: request.id }, data: next });
            await audit("PassengerRequest", request.id, [
              {
                source: fare.source,
                before: { fare_id: request.fare_id, unit_minor: request.fare_unit_minor, total_minor: request.fare_total_minor },
                after: { fare_id: next.fare_id, unit_minor: next.fare_unit_minor, total_minor: next.fare_total_minor }
              }
            ]);
            passengerChanged = true;
          }
        }
      }

      let parcelsChanged = 0;
      const orderIds = [...new Set(input.merchantOrderIds ?? [])];
      if (orderIds.length > 0) {
        const parcels = await tx.parcel.findMany({
          where: { order_id: { in: orderIds }, status: { notIn: ["cancelled", "failed", "expired"] } },
          select: {
            id: true,
            order_id: true,
            size: true,
            fare_id: true,
            fare_minor: true,
            fare_currency: true,
            route_version: { select: { service_route_id: true } }
          },
          orderBy: { id: "asc" }
        });
        const byOrder = new Map<string, unknown[]>();
        for (const parcel of parcels) {
          if (parcel.route_version?.service_route_id !== serviceRouteId) continue;
          const item = (FARE_ITEMS as readonly string[]).includes(`parcel_${parcel.size.toLowerCase()}`)
            ? (`parcel_${parcel.size.toLowerCase()}` as FareItem)
            : null;
          const fare = item ? driverFareFor(set, route, item) : null;
          if (!fare) continue;
          if (parcel.fare_id === fare.fareId && parcel.fare_minor === fare.unitMinor && parcel.fare_currency === fare.currency) continue;
          await tx.parcel.update({
            where: { id: parcel.id },
            data: { fare_id: fare.fareId, fare_minor: fare.unitMinor, fare_currency: fare.currency }
          });
          parcelsChanged += 1;
          const changes = byOrder.get(parcel.order_id) ?? [];
          changes.push({
            parcel_id: parcel.id,
            size: parcel.size,
            source: fare.source,
            before: { fare_id: parcel.fare_id, minor: parcel.fare_minor },
            after: { fare_id: fare.fareId, minor: fare.unitMinor }
          });
          byOrder.set(parcel.order_id, changes);
        }
        for (const [orderId, changes] of byOrder) await audit("MerchantOrder", orderId, changes);
      }
      return { passengerChanged, parcelsChanged };
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
        validateRange(entry);
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
          const before = latest[entry.item];
          const minMinor = entry.range?.minMinor ?? null;
          const maxMinor = entry.range?.maxMinor ?? null;
          if (
            (before?.amountMinor ?? null) === entry.amountMinor &&
            (before?.minMinor ?? null) === minMinor &&
            (before?.maxMinor ?? null) === maxMinor
          ) {
            continue;
          }
          created.push(
            await tx.routeFare.create({
              data: {
                service_route_id: routeId,
                item: entry.item,
                amount_minor: entry.amountMinor,
                min_minor: minMinor,
                max_minor: maxMinor,
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
              amount_minor: row.amount_minor,
              min_minor: row.min_minor ?? null,
              max_minor: row.max_minor ?? null
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
