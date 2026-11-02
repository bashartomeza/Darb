import express from "express";
import type { Logger } from "pino";
import { authRouter } from "./modules/auth.js";
import { demoRouter } from "./modules/demoReset.js";
import { passengerRouter } from "./modules/passenger.js";
import { createDriverRouter } from "./modules/driver.js";
import { merchantRouter } from "./modules/merchant.js";
import { adminRouter } from "./modules/admin.js";
import { matchingRouter } from "./modules/matching.js";
import { batchingRouter } from "./modules/batching.js";
import { comparisonRouter } from "./modules/comparison.js";
import { trackingSimulationRouter, tripsRouter } from "./modules/trips.js";
import { createCors } from "./middleware/cors.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { config, type AppConfig } from "./config.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { createOperationalLogger } from "./lib/logger.js";
import { operationalLogMiddleware } from "./middleware/operationalLog.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import {
  createGlobalRateLimiter,
  createLoginRateLimiter,
} from "./middleware/rateLimit.js";
import { createHealthRouter } from "./modules/health.js";
import type { ReadinessCheck } from "./lib/readiness.js";
import { createAdminInvitationRouter } from "./modules/adminInvitations.js";
import { createPublicOnboardingRouter } from "./modules/publicOnboarding.js";
import type { OtpProvider } from "./lib/otp.js";
import {
  createAdminRouteManagementRouter,
  createRouteCatalogRouter,
} from "./modules/routeManagement.js";
import type { RouteManagementService } from "./services/routeManagement.js";
import { createDriverAvailabilityRouter } from "./modules/driverAvailability.js";
import type { DriverAvailabilityService } from "./services/driverAvailability.js";
import { createCanonicalDemandRouter } from "./modules/canonicalDemand.js";
import type { CanonicalDemandService } from "./services/canonicalDemand.js";
import { createCapabilitiesRouter } from "./modules/capabilities.js";
import { createCanonicalMatchingRouter } from "./modules/canonicalMatching.js";
import { createCanonicalSharedMatchingRouter } from "./modules/canonicalSharedMatching.js";
import type { CanonicalMatchingService } from "./services/canonicalMatching.js";
import type { CanonicalSharedMatchingService } from "./services/canonicalSharedMatching.js";
import type { LegacyDriverOnlineStateService } from "./services/legacyDriverOnlineState.js";
import { createRouteProvider } from "./maps/liveProviders.js";
import { createRoutePreviewService, type RoutePreviewService } from "./maps/previewService.js";
import { createRoutePreviewRouter } from "./modules/routePreview.js";
import { createPassengerAssistantRouter } from "./modules/passengerAssistant.js";
import { createAiServicesClientFromEnv, type AiServicesClient } from "./services/aiServicesClient.js";

export const HTTP_JSON_LIMIT = "64kb";
export const HTTP_FORM_LIMIT = "16kb";

type AppDependencies = {
  logger?: Logger;
  readinessCheck?: ReadinessCheck;
  otpProvider?: OtpProvider;
  routeManagementService?: RouteManagementService;
  driverAvailabilityService?: DriverAvailabilityService;
  canonicalDemandService?: CanonicalDemandService;
  canonicalMatchingService?: CanonicalMatchingService;
  canonicalSharedMatchingService?: CanonicalSharedMatchingService;
  legacyDriverOnlineStateService?: LegacyDriverOnlineStateService;
  routePreviewService?: RoutePreviewService;
  aiServicesClient?: AiServicesClient | null;
};

export function createApp(
  appConfig: AppConfig = config,
  dependencies: AppDependencies = {},
) {
  const app = express();
  const logger = dependencies.logger ?? createOperationalLogger(appConfig);

  app.disable("x-powered-by");
  app.set("trust proxy", appConfig.trustProxy);
  app.use(requestIdMiddleware);
  app.use(operationalLogMiddleware(logger));
  app.use(securityHeaders(appConfig));
  app.use(createCors(appConfig));
  app.use(express.json({ limit: HTTP_JSON_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: HTTP_FORM_LIMIT }));

  app.use(
    "/api/v1",
    createHealthRouter(appConfig, dependencies.readinessCheck),
  );
  app.use("/api/v1", createGlobalRateLimiter(appConfig));
  app.use("/api/v1/auth/login", createLoginRateLimiter(appConfig));
  app.use(
    "/api/v1",
    createPublicOnboardingRouter(appConfig, dependencies.otpProvider),
  );

  app.use("/api/v1", authRouter);
  app.use("/api/v1", createCapabilitiesRouter(appConfig));
  if (appConfig.demoFeaturesEnabled) app.use("/api/v1", demoRouter);
  app.use(
    "/api/v1",
    createCanonicalDemandRouter(appConfig, dependencies.canonicalDemandService),
  );
  app.use(
    "/api/v1",
    createCanonicalMatchingRouter(
      appConfig,
      dependencies.canonicalMatchingService,
    ),
  );
  app.use(
    "/api/v1",
    createCanonicalSharedMatchingRouter(
      appConfig,
      dependencies.canonicalSharedMatchingService,
    ),
  );
  app.use("/api/v1", passengerRouter);
  app.use(
    "/api/v1",
    createPassengerAssistantRouter(
      appConfig,
      undefined,
      undefined,
      dependencies.aiServicesClient === undefined ? createAiServicesClientFromEnv() : dependencies.aiServicesClient,
    ),
  );
  app.use(
    "/api/v1",
    createDriverAvailabilityRouter(
      appConfig,
      dependencies.driverAvailabilityService,
    ),
  );
  app.use(
    "/api/v1",
    createDriverRouter(dependencies.legacyDriverOnlineStateService),
  );
  app.use("/api/v1", batchingRouter);
  app.use("/api/v1", merchantRouter);
  app.use("/api/v1", matchingRouter);
  app.use("/api/v1", tripsRouter);
  app.use(
    "/api/v1",
    createRouteCatalogRouter(appConfig, dependencies.routeManagementService),
  );
  if (appConfig.demoFeaturesEnabled) {
    app.use("/api/v1", trackingSimulationRouter);
    app.use("/api/v1", comparisonRouter);
  }
  if (appConfig.invitationsEnabled)
    app.use("/api/v1", createAdminInvitationRouter(appConfig));
  else app.use("/api/v1/admin/invitations", notFoundHandler);
  app.use(
    "/api/v1",
    createAdminRouteManagementRouter(
      appConfig,
      dependencies.routeManagementService,
    ),
  );
  const routePreviewService = dependencies.routePreviewService ?? createRoutePreviewService({
    provider: createRouteProvider(appConfig),
    cacheTtlMs: appConfig.routeMaps.cacheTtlSeconds * 1_000
  });
  app.use("/api/v1", createRoutePreviewRouter(appConfig, routePreviewService));
  app.use("/api/v1", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
