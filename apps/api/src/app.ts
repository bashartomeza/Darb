import express from "express";
import type { Logger } from "pino";
import { createAuthRouter } from "./modules/auth.js";
import type { EmailDelivery } from "./services/emailAuth.js";
import { EmailPhoneVerificationProvider, type PhoneVerificationProvider } from "./services/identityProfile.js";
import type { GoogleVerifier } from "./lib/googleIdentity.js";
import { createDemoRouter } from "./modules/demoReset.js";
import { passengerRouter } from "./modules/passenger.js";
import { createDriverRouter } from "./modules/driver.js";
import { merchantRouter } from "./modules/merchant.js";
import { merchantBulkRouter } from "./modules/merchantBulk.js";
import { parcelHandoverRouter } from "./modules/parcelHandover.js";
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
import { createDriverDocumentsRouter } from "./modules/driverDocuments.js";
import { EmailOtpProvider, type OtpProvider } from "./lib/otp.js";
import {
  createAdminRouteManagementRouter,
  createRouteCatalogRouter,
} from "./modules/routeManagement.js";
import type { RouteManagementService } from "./services/routeManagement.js";
import { createDriverAvailabilityRouter } from "./modules/driverAvailability.js";
import type { DriverAvailabilityService } from "./services/driverAvailability.js";
import { createCanonicalDemandRouter } from "./modules/canonicalDemand.js";
import { createAdminRouteFaresRouter } from "./modules/adminRouteFares.js";
import type { CanonicalDemandService } from "./services/canonicalDemand.js";
import { createCapabilitiesRouter } from "./modules/capabilities.js";
import { createCheckpointRouter } from "./modules/checkpoints.js";
import type { CheckpointService } from "./services/checkpoints.js";
import { CheckpointDirectoryService } from "./services/checkpointDirectory.js";
import { LimitedCheckpointDirectoryService } from "./services/limitedCheckpointDirectory.js";
import { MysqlPartnerBudget } from "./services/limitedCheckpointBudget.js";
import { prisma } from "./lib/prisma.js";
import { createLimitedCheckpointDirectoryRouter } from "./modules/limitedCheckpointDirectory.js";
import { createCheckpointDirectoryRouter } from "./modules/checkpointDirectory.js";
import { createCanonicalMatchingRouter } from "./modules/canonicalMatching.js";
import { createCanonicalSharedMatchingRouter } from "./modules/canonicalSharedMatching.js";
import type { CanonicalMatchingService } from "./services/canonicalMatching.js";
import type { CanonicalSharedMatchingService } from "./services/canonicalSharedMatching.js";
import type { LegacyDriverOnlineStateService } from "./services/legacyDriverOnlineState.js";
import { createRouteProvider } from "./maps/liveProviders.js";
import { createRoutePreviewService, type RoutePreviewService } from "./maps/previewService.js";
import { createRoutePreviewRouter } from "./modules/routePreview.js";
import { createPassengerAssistantRouter } from "./modules/passengerAssistant.js";
import type { PassengerAssistantService } from "./services/passengerAssistant.js";
import { createAdminConsentRouter } from "./modules/adminConsents.js";
import type { ConsentReleaseService } from "./services/consentReleases.js";
import { adminTripsRouter } from "./modules/adminTrips.js";
import { adminPassengerParcelsRouter, createPassengerParcelRouter } from "./modules/passengerParcels.js";
import type { PassengerParcelService } from "./services/passengerParcels.js";
import { notificationsRouter } from "./modules/notifications.js";
import { reportsRouter } from "./modules/reports.js";
import { adminSuccessMetricsRouter } from "./modules/adminSuccessMetrics.js";
import { incidentsRouter } from "./modules/incidents.js";
import { adminAiRequestsRouter } from "./modules/adminAiRequests.js";
import { createAdminMatchingMonitoringRouter } from "./modules/adminMatchingMonitoring.js";
import type { MonitoringService } from "./services/adminMatchingMonitoring/contracts.js";
import { requireCompleteProfile } from "./middleware/profileState.js";

export const HTTP_JSON_LIMIT = "64kb";
export const CONSENT_RELEASE_JSON_LIMIT = "256kb";
export const HTTP_FORM_LIMIT = "16kb";

type AppDependencies = {
  phoneVerificationProvider?: PhoneVerificationProvider;
  googleVerifier?: GoogleVerifier;
  emailDelivery?: EmailDelivery;
  logger?: Logger;
  readinessCheck?: ReadinessCheck;
  otpProvider?: OtpProvider;
  routeManagementService?: RouteManagementService;
  driverAvailabilityService?: DriverAvailabilityService;
  canonicalDemandService?: CanonicalDemandService;
  passengerParcelService?: PassengerParcelService;
  canonicalMatchingService?: CanonicalMatchingService;
  canonicalSharedMatchingService?: CanonicalSharedMatchingService;
  checkpointService?: CheckpointService;
  checkpointDirectoryService?: CheckpointDirectoryService;
  limitedCheckpointDirectoryService?: LimitedCheckpointDirectoryService;
  legacyDriverOnlineStateService?: LegacyDriverOnlineStateService;
  routePreviewService?: RoutePreviewService;
  passengerAssistantService?: PassengerAssistantService;
  consentReleaseService?: ConsentReleaseService;
  adminMatchingMonitoringService?: MonitoringService;
};

export function createApp(
  appConfig: AppConfig = config,
  dependencies: AppDependencies = {},
) {
  const app = express();
  const logger = dependencies.logger ?? createOperationalLogger(appConfig);
  // OTP_PROVIDER=email: Masari sends no SMS, so both phone-code flows (onboarding attempts and the phone step after
  // email sign-up) deliver their code through the approved SMTP email delivery.
  if (appConfig.otpProvider === "email" && dependencies.emailDelivery) {
    dependencies = {
      ...dependencies,
      otpProvider: dependencies.otpProvider ?? new EmailOtpProvider(dependencies.emailDelivery),
      phoneVerificationProvider: dependencies.phoneVerificationProvider ?? new EmailPhoneVerificationProvider(dependencies.emailDelivery)
    };
  }

  app.disable("x-powered-by");
  app.set("trust proxy", appConfig.trustProxy);
  app.use(requestIdMiddleware);
  app.use(operationalLogMiddleware(logger));
  app.use(securityHeaders(appConfig));
  app.use(createCors(appConfig));
  app.use("/api/v1/admin/consent-releases", express.json({ limit: CONSENT_RELEASE_JSON_LIMIT }));
  app.use(express.json({ limit: HTTP_JSON_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: HTTP_FORM_LIMIT }));

  app.use(
    "/api/v1",
    createHealthRouter(appConfig, dependencies.readinessCheck),
  );
  app.use("/api/v1", createGlobalRateLimiter(appConfig));
  app.use(
    ["/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/google", "/api/v1/auth/mobile", "/api/v1/auth/admin", "/api/v1/auth/email", "/api/v1/auth/password"],
    createLoginRateLimiter(appConfig),
  );
  app.use(
    "/api/v1",
    createPublicOnboardingRouter(appConfig, dependencies.otpProvider),
  );
  app.use("/api/v1", createDriverDocumentsRouter(appConfig));

  // This mount is intentionally before every product router below. It makes
  // complete-profile enforcement the default for future authenticated product
  // surfaces, while profile-completion-safe paths are explicitly exempted.
  app.use("/api/v1", requireCompleteProfile);

  app.use("/api/v1", createAuthRouter(appConfig, dependencies));
  const directory = appConfig.checkpointDirectoryEnabled && appConfig.checkpointDirectoryFile
    ? dependencies.checkpointDirectoryService ?? new CheckpointDirectoryService(appConfig.checkpointDirectoryFile)
    : undefined;
  const limitedDirectory = appConfig.limitedCheckpointDirectoryEnabled && appConfig.limitedCheckpointDirectory
    ? dependencies.limitedCheckpointDirectoryService ?? new LimitedCheckpointDirectoryService(
      appConfig.limitedCheckpointDirectory, new MysqlPartnerBudget(prisma, appConfig.limitedCheckpointDirectory.apiKey))
    : undefined;
  app.use("/api/v1", createCapabilitiesRouter(appConfig, directory));
  app.use("/api/v1", createLimitedCheckpointDirectoryRouter(appConfig, limitedDirectory));
  app.use("/api/v1", createCheckpointDirectoryRouter(appConfig, directory));
  app.use(
    "/api/v1",
    createCheckpointRouter(appConfig, dependencies.checkpointService),
  );
  if (appConfig.demoFeaturesEnabled) app.use("/api/v1", createDemoRouter(appConfig));
  app.use(
    "/api/v1",
    createCanonicalDemandRouter(appConfig, dependencies.canonicalDemandService),
  );
  app.use(
    "/api/v1",
    createPassengerParcelRouter(appConfig, dependencies.passengerParcelService),
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
  app.use("/api/v1", notificationsRouter);
  app.use("/api/v1", reportsRouter);
  app.use("/api/v1", adminSuccessMetricsRouter);
  app.use("/api/v1", incidentsRouter);
  app.use("/api/v1", adminAiRequestsRouter);
  app.use("/api/v1", passengerRouter);
  app.use(
    "/api/v1",
    createPassengerAssistantRouter(appConfig, dependencies.passengerAssistantService),
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
  app.use("/api/v1", merchantBulkRouter);
  app.use("/api/v1", merchantRouter);
  app.use("/api/v1", parcelHandoverRouter);
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
  app.use("/api/v1", createAdminRouteFaresRouter(appConfig));
  const routePreviewService = dependencies.routePreviewService ?? createRoutePreviewService({
    provider: createRouteProvider(appConfig),
    cacheTtlMs: appConfig.routeMaps.cacheTtlSeconds * 1_000
  });
  app.use("/api/v1", createRoutePreviewRouter(appConfig, routePreviewService));
  app.use("/api/v1", createAdminConsentRouter(dependencies.consentReleaseService));
  app.use("/api/v1", adminTripsRouter);
  app.use("/api/v1", adminPassengerParcelsRouter);
  app.use(
    "/api/v1",
    createAdminMatchingMonitoringRouter(dependencies.adminMatchingMonitoringService),
  );
  app.use("/api/v1", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
