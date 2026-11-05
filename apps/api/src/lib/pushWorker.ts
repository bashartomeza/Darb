import type { Logger } from "pino";
import type { AppConfig } from "../config.js";
import { FcmClient, type PushSender } from "../services/fcmClient.js";
import { PushDispatcher } from "../services/pushDispatcher.js";
import { prisma } from "./prisma.js";
import { setPushDispatchHandler } from "./pushSignal.js";

export const PUSH_SWEEP_DEFAULT_INTERVAL_MS = 15_000;

export type PushWorker = { stop: () => void; dispatcher: PushDispatcher };

/**
 * Starts the push sender when PUSH_NOTIFICATIONS_ENABLED=true; otherwise returns
 * undefined and nothing is ever sent. New notifications trigger a pass within a
 * fraction of a second; the periodic sweep picks up rows whose transaction
 * committed after that pass ran.
 */
export function startPushWorker(
  appConfig: Pick<AppConfig, "push">,
  logger: Logger,
  options: { intervalMs?: number; sender?: PushSender } = {}
): PushWorker | undefined {
  const push = appConfig.push;
  if (!push.enabled) {
    logger.info({ event: "push_notifications_disabled" }, "Push notifications are disabled");
    return undefined;
  }
  const sender = options.sender ?? new FcmClient({ projectId: push.projectId, serviceAccount: push.serviceAccount });
  const dispatcher = new PushDispatcher({ db: prisma, sender, logger });
  setPushDispatchHandler(dispatcher.kick);

  const intervalMs = options.intervalMs ?? PUSH_SWEEP_DEFAULT_INTERVAL_MS;
  const timer = setInterval(() => void dispatcher.runPass(), intervalMs);
  timer.unref();
  void dispatcher.runPass();

  // The project id is not a secret; the key and tokens are never logged.
  logger.info({ event: "push_notifications_started", project_id: push.projectId, interval_ms: intervalMs }, "Push notifications started");

  return {
    dispatcher,
    stop: () => {
      clearInterval(timer);
      setPushDispatchHandler(undefined);
      dispatcher.stop();
    }
  };
}
