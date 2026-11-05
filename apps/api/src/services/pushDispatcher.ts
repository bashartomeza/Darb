import type { PrismaClient } from "../generated/prisma/client.js";
import type { PushSender } from "./fcmClient.js";
import { pushText } from "./pushText.js";

/** A notification older than this is no longer news: it stays in the inbox but is not pushed. */
export const PUSH_MAX_AGE_MS = 10 * 60_000;
const BATCH_SIZE = 50;
/** One account rarely has more phones than this; the cap bounds a pass. */
const MAX_DEVICES_PER_USER = 10;

export type PushPassResult = { claimed: number; sent: number; revoked: number; failed: number; skipped: number };

type PassLogger = {
  info: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
};

type DispatcherOptions = {
  db: PrismaClient;
  sender: PushSender;
  logger?: PassLogger;
  now?: () => Date;
  /** Delay between a notification being written and the pass that pushes it. */
  kickDelayMs?: number;
};

type PendingNotification = {
  id: string;
  user_id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  params: unknown;
};

/** FCM data payload: what the app needs to open the right screen. Strings only. */
export function pushData(notification: PendingNotification): Record<string, string> {
  return {
    notification_id: notification.id,
    type: notification.type,
    ...(notification.entity_type ? { entity_type: notification.entity_type } : {}),
    ...(notification.entity_id ? { entity_id: notification.entity_id } : {})
  };
}

/**
 * Pushes recently written inbox notifications to the recipients' registered
 * phones. Works from committed rows: each pass claims unpushed rows one by one
 * (an atomic update, so several API instances never push the same row twice),
 * then sends to each of the recipient's live devices. Everything is best effort:
 * a failure is counted and logged without tokens, never thrown to a request.
 */
export class PushDispatcher {
  private readonly now: () => Date;
  private readonly kickDelayMs: number;
  private running = false;
  private again = false;
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly options: DispatcherOptions) {
    this.now = options.now ?? (() => new Date());
    this.kickDelayMs = options.kickDelayMs ?? 250;
  }

  /** Schedules a pass soon. Cheap and safe to call from anywhere, any number of times. */
  kick = () => {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runPass();
    }, this.kickDelayMs);
    this.timer.unref?.();
  };

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async runPass(): Promise<PushPassResult> {
    const result: PushPassResult = { claimed: 0, sent: 0, revoked: 0, failed: 0, skipped: 0 };
    if (this.running || this.stopped) {
      this.again = true;
      return result;
    }
    this.running = true;
    let full = false;
    try {
      full = await this.pass(result);
    } catch (error) {
      this.options.logger?.error(
        { event: "push_pass_failed", error_type: error instanceof Error ? error.name : "UnknownError" },
        "Push notification pass failed"
      );
    } finally {
      this.running = false;
    }
    if (result.claimed > 0) {
      this.options.logger?.info({ event: "push_pass", ...result }, "Push notification pass completed");
    }
    if ((full || this.again) && !this.stopped) {
      this.again = false;
      this.kick();
    }
    return result;
  }

  private async pass(result: PushPassResult): Promise<boolean> {
    const { db } = this.options;
    const now = this.now();
    const rows: PendingNotification[] = await db.notification.findMany({
      where: { push_attempted_at: null, created_at: { gte: new Date(now.getTime() - PUSH_MAX_AGE_MS) } },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
      select: { id: true, user_id: true, type: true, entity_type: true, entity_id: true, params: true }
    });
    for (const row of rows) {
      const claim = await db.notification.updateMany({
        where: { id: row.id, push_attempted_at: null },
        data: { push_attempted_at: now }
      });
      if (claim.count !== 1) continue; // Another instance has it.
      result.claimed += 1;
      try {
        await this.deliver(row, now, result);
      } catch {
        result.failed += 1;
      }
    }
    return rows.length === BATCH_SIZE;
  }

  private async deliver(row: PendingNotification, now: Date, result: PushPassResult) {
    const { db, sender } = this.options;
    const preference = await db.notificationPreference.findUnique({
      where: { user_id: row.user_id },
      select: { push_enabled: true }
    });
    if (preference && !preference.push_enabled) {
      result.skipped += 1;
      return;
    }
    // Only phones whose sign-in is still live, for an account that is still active.
    const devices = await db.pushDevice.findMany({
      where: {
        user_id: row.user_id,
        revoked_at: null,
        user: { account_status: "active" },
        session: { revoked_at: null, expires_at: { gt: now } }
      },
      orderBy: { last_seen_at: "desc" },
      take: MAX_DEVICES_PER_USER,
      select: { id: true, token: true, locale: true }
    });
    if (devices.length === 0) {
      result.skipped += 1;
      return;
    }
    const data = pushData(row);
    for (const device of devices) {
      const text = pushText(row.type, row.params, device.locale);
      const outcome = await sender.send({ token: device.token, title: text.title, body: text.body, data });
      if (outcome.kind === "sent") {
        result.sent += 1;
      } else if (outcome.kind === "invalid_token") {
        // Matched on the token too: if the row was re-registered meanwhile, leave it.
        await db.pushDevice.updateMany({
          where: { id: device.id, token: device.token, revoked_at: null },
          data: { revoked_at: now, revoke_reason: `fcm_${outcome.reason}`.slice(0, 60) }
        });
        result.revoked += 1;
      } else {
        result.failed += 1;
      }
    }
  }
}
