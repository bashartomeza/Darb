import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { LOCKED_CORRIDOR_KEY, LOCKED_CORRIDOR_LABEL } from "./demoReset.js";
import { LOCKED_ROUTE } from "./driver.js";

/**
 * The places the legacy (single-corridor) flows accept, read-only.
 *
 * Legacy matching and batching only ever consider driver routes on the locked
 * corridor, so the apps must offer exactly that corridor's places instead of
 * shipping their own copies. The driver route endpoints are the server's lock;
 * the stops are the published version of the corridor's service route.
 */
export const legacyCorridorRouter = Router();

legacyCorridorRouter.get(
  "/legacy-corridor",
  requireAuth,
  requireRole("passenger", "driver", "merchant", "admin"),
  async (_req, res, next) => {
    try {
      const route = await prisma.serviceRoute.findUnique({
        where: { route_key: LOCKED_CORRIDOR_KEY },
        select: {
          status: true,
          current_version: {
            select: {
              id: true,
              status: true,
              name_ar: true,
              name_en: true,
              stops: {
                orderBy: { sequence: "asc" },
                select: {
                  sequence: true,
                  passenger_pickup: true,
                  passenger_dropoff: true,
                  parcel_pickup: true,
                  parcel_dropoff: true,
                  stop: {
                    select: {
                      id: true,
                      stop_key: true,
                      name_ar: true,
                      name_en: true,
                      latitude: true,
                      longitude: true,
                      status: true
                    }
                  }
                }
              }
            }
          }
        }
      });
      // Only a live, published version offers places; a paused or retired
      // corridor offers none rather than stale ones.
      const version =
        route?.status === "active" && route.current_version?.status === "published" ? route.current_version : null;
      res.json({
        corridor: {
          key: LOCKED_CORRIDOR_KEY,
          route_version_id: version?.id ?? null,
          name_ar: version?.name_ar ?? null,
          name_en: version?.name_en ?? LOCKED_CORRIDOR_LABEL,
          driver_route: {
            origin_label: LOCKED_ROUTE.origin_label,
            origin_lat: LOCKED_ROUTE.origin_lat,
            origin_lng: LOCKED_ROUTE.origin_lng,
            destination_label: LOCKED_ROUTE.destination_label,
            destination_lat: LOCKED_ROUTE.destination_lat,
            destination_lng: LOCKED_ROUTE.destination_lng
          },
          stops: (version?.stops ?? [])
            .filter((membership) => membership.stop.status === "active")
            .map((membership) => ({
              id: membership.stop.id,
              stop_key: membership.stop.stop_key,
              name_ar: membership.stop.name_ar,
              name_en: membership.stop.name_en,
              latitude: Number(membership.stop.latitude),
              longitude: Number(membership.stop.longitude),
              sequence: membership.sequence,
              passenger_pickup: membership.passenger_pickup,
              passenger_dropoff: membership.passenger_dropoff,
              parcel_pickup: membership.parcel_pickup,
              parcel_dropoff: membership.parcel_dropoff
            }))
        }
      });
    } catch (error) {
      next(error);
    }
  }
);
