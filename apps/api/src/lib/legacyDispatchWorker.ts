import type { Logger } from "pino";
import { expireLegacyDispatches } from "../services/legacyDispatch.js";

export const LEGACY_DISPATCH_DEFAULT_INTERVAL_MS = 30_000;

export type LegacyDispatchWorker = { stop: () => void };

export function startLegacyDispatchWorker(
  logger: Logger,
  options: { intervalMs?: number } = {},
): LegacyDispatchWorker {
  const intervalMs = options.intervalMs ?? Number(process.env.LEGACY_DISPATCH_INTERVAL_MS ?? LEGACY_DISPATCH_DEFAULT_INTERVAL_MS);
  let running = false;
  let stopped = false;

  const pass = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await expireLegacyDispatches();
      if (result.matchesExpired || result.requestsExpired || result.ordersExpired) {
        logger.info(
          { event: "legacy_dispatch_expiry_pass", ...result },
          "Legacy dispatch expiry pass completed",
        );
      }
    } catch (error) {
      logger.error(
        {
          event: "legacy_dispatch_expiry_failed",
          error_type: error instanceof Error ? error.name : "UnknownError",
          error_message: error instanceof Error ? error.message : undefined,
        },
        "Legacy dispatch expiry pass failed",
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void pass(), intervalMs);
  timer.unref();
  void pass();

  logger.info(
    { event: "legacy_dispatch_worker_started", interval_ms: intervalMs },
    "Legacy dispatch worker started",
  );

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
