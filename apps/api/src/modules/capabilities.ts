import { Router } from "express";
import type { AppConfig } from "../config.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { evaluateDemoResetSafety } from "../lib/demoResetSafety.js";
import type { CheckpointDirectoryService } from "../services/checkpointDirectory.js";

export function createCapabilitiesRouter(appConfig: AppConfig, directory?: CheckpointDirectoryService) {
  const router = Router();

  router.get("/capabilities", requireAuth, (req, res) => {
    const canonicalEntryAvailable =
      appConfig.routeManagementEnabled && appConfig.multiRouteEntryEnabled;
    const canonicalMatchingAvailable =
      canonicalEntryAvailable &&
      appConfig.multiRouteMatchingEnabled &&
      appConfig.canonicalTripCreationEnabled;
    const canonicalSharedTripPresentationAvailable =
      canonicalMatchingAvailable &&
      appConfig.canonicalSharedTripsEnabled &&
      appConfig.canonicalSharedTripMobileEnabled;
    res.json({
      canonical_route_catalog_available: appConfig.routeManagementEnabled,
      canonical_multi_route_entry_available: canonicalEntryAvailable,
      canonical_matching_available: canonicalMatchingAvailable,
      canonical_trip_creation_available: canonicalMatchingAvailable,
      driver_canonical_offers_available: canonicalMatchingAvailable,
      canonical_assignment_status_available: canonicalEntryAvailable,
      canonical_shared_trip_presentation_available: canonicalSharedTripPresentationAvailable,
      canonical_shared_driver_offers_available: canonicalSharedTripPresentationAvailable,
      canonical_shared_assignment_status_available: canonicalSharedTripPresentationAvailable,
      // Coordinates and geometry reach clients only through the canonical
      // catalog, so the map gate is the catalog gate plus the maps flag.
      maps_available: appConfig.mapsEnabled && appConfig.routeManagementEnabled,
      checkpoints_available: appConfig.checkpointsEnabled,
      // Existing Flutter versions reject unknown fields. New directory clients
      // explicitly opt into this extension; legacy responses stay byte-shaped.
      ...(req.query.include === "checkpoint-directory" ? {
        checkpoint_directory_available: appConfig.checkpointDirectoryEnabled && directory?.available() === true
      } : {}),
      ...(req.query.include === "limited-checkpoint-directory" ? {
        limited_checkpoint_directory_available: appConfig.limitedCheckpointDirectoryEnabled && ["passenger", "driver"].includes((req as AuthenticatedRequest).user?.role ?? "")
      } : {}),
      live_tracking_available: false,
      demo_reset_available: evaluateDemoResetSafety(appConfig).allowed
    });
  });

  return router;
}
