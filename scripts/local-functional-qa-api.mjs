import assert from "node:assert/strict";

// Guard before importing application configuration, Prisma, or workers.
let target;
try { target = new URL(process.env.DATABASE_URL ?? ""); }
catch { throw new Error("qa_loopback_disposable_target_required"); }
assert(process.env.APP_ENV === "demo" && target.protocol === "mysql:" && target.hostname === "127.0.0.1"
  && Number(target.port) > 0 && target.port !== "3306"
  && /^masari_functional_[a-z_]+_[0-9a-f]{10}_ci$/.test(target.pathname.slice(1))
  && process.env.DEMO_RESET_ALLOWED_DATABASES === target.pathname.slice(1), "qa_loopback_disposable_target_required");
const { createApp } = await import("../apps/api/dist/app.js");
const { config } = await import("../apps/api/dist/config.js");
const { prisma } = await import("../apps/api/dist/lib/prisma.js");
const { createOperationalLogger } = await import("../apps/api/dist/lib/logger.js");
const { startLegacyDispatchWorker } = await import("../apps/api/dist/lib/legacyDispatchWorker.js");
const { startCanonicalDispatchWorker } = await import("../apps/api/dist/lib/canonicalDispatchWorker.js");
const logger = createOperationalLogger(config);
const app = createApp(config, { logger });
const legacy = startLegacyDispatchWorker(logger);
const canonical = startCanonicalDispatchWorker(config, logger);
const server = app.listen(config.port, "127.0.0.1");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  legacy.stop(); canonical?.stop();
  await new Promise((ok) => server.close(ok));
  await prisma.$disconnect();
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
