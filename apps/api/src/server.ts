// Load .env before anything reads process.env (config.js parses it on import).
// A no-op when the file is absent, so real deployment env vars still win.
import "dotenv/config";

import { createApp } from "./app.js";
import { config } from "./config.js";
import { startCanonicalDispatchWorker } from "./lib/canonicalDispatchWorker.js";
import { startLegacyDispatchWorker } from "./lib/legacyDispatchWorker.js";
import { startPushWorker } from "./lib/pushWorker.js";
import { createOperationalLogger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { ensurePredefinedRoutes } from "./services/operatingRoutes.js";
import { createSmtpEmailDelivery } from "./services/smtpEmailDelivery.js";

const logger = createOperationalLogger(config);
// Staging/production email sign-up, verification and reset need an approved delivery (EMAIL_DELIVERY=smtp).
// Without it EmailAuthService answers 503 email_auth_unavailable. Credentials are never logged.
const smtp = config.email.smtp;
const emailDelivery = smtp ? createSmtpEmailDelivery({
  host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, password: smtp.password,
  fromAddress: smtp.fromAddress, fromName: smtp.fromName
}) : undefined;
logger.info({ event: "email_delivery_configured", delivery: config.email.delivery }, "Email delivery configured");
const app = createApp(config, { logger, emailDelivery });
const canonicalDispatchWorker = startCanonicalDispatchWorker(config, logger);
const legacyDispatchWorker = startLegacyDispatchWorker(logger);
// Off unless PUSH_NOTIFICATIONS_ENABLED=true with Firebase credentials (docs/notifications/push-setup.md).
const pushWorker = startPushWorker(config, logger);
let shuttingDown = false;

const server = app.listen(config.port, () => {
  logger.info({ event: "api_started", port: config.port }, "Darb API started");
  void ensureOperatingRoutesAtStartup();
});

/**
 * Creates the predefined city routes that are missing. A database that is not
 * reachable yet, or has no admin to attribute the rows to, only logs: the API
 * keeps serving, and the first admin to open the route list completes the set.
 */
async function ensureOperatingRoutesAtStartup() {
  try {
    const result = await ensurePredefinedRoutes(prisma);
    logger.info(
      {
        event: "predefined_routes_checked",
        created_stops: result.createdStops,
        created_routes: result.createdRoutes,
        skipped: result.skipped ?? null
      },
      "Predefined operating routes checked"
    );
  } catch (error) {
    logger.error(
      { event: "predefined_routes_failed", error_type: error instanceof Error ? error.name : "UnknownError" },
      "Predefined operating routes could not be checked"
    );
  }
}

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  canonicalDispatchWorker?.stop();
  legacyDispatchWorker.stop();
  pushWorker?.stop();
  logger.info({ event: "shutdown_started", signal }, "Darb API shutdown started");

  const forcedExit = setTimeout(() => {
    logger.error({ event: "shutdown_timeout" }, "Darb API shutdown timed out");
    logger.flush();
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  server.close(async (serverError) => {
    try {
      if (serverError) throw serverError;
      await prisma.$disconnect();
      logger.info({ event: "shutdown_completed" }, "Darb API shutdown completed");
    } catch (error) {
      logger.error(
        { event: "shutdown_failed", error_type: error instanceof Error ? error.name : "UnknownError" },
        "Darb API shutdown failed"
      );
      process.exitCode = 1;
    } finally {
      clearTimeout(forcedExit);
      logger.flush();
    }
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
