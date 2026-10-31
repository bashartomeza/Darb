import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { PartnerBudget, PartnerLease } from "./limitedCheckpointDirectory.js";

// This reserved namespace holds a key until its attempt is durably settled.
// Crashes or failed cooldown writes leave it fail-closed, never a short retry.
const HELD_UNTIL = new Date("9999-12-31T00:00:00.000Z");
export class MysqlPartnerBudget implements PartnerBudget {
  private readonly digest: string;
  constructor(private readonly db: PrismaClient, key: string) {
    this.digest = createHash("sha256").update(key).digest("hex");
  }
  private async locked<T>(action: (now: Date, row: { id: string; count: number; expires_at: Date }, update: (until: Date) => Promise<void>) => Promise<T>): Promise<T> {
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`INSERT INTO abuse_counters
        (id,bucket_type,subject_digest,digest_version,window_start,window_seconds,count,expires_at,created_at,updated_at)
        VALUES (${randomUUID()},'checkpoint_partner_budget',${this.digest},1,'1970-01-01 00:00:00',1,0,'1970-01-01 00:00:00',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE id=id`;
      const rows = await tx.$queryRaw<{ id: string; count: number; expires_at: Date }[]>`SELECT id, count, expires_at FROM abuse_counters
        WHERE bucket_type='checkpoint_partner_budget' AND subject_digest=${this.digest} AND digest_version=1
        AND window_start='1970-01-01 00:00:00' AND window_seconds=1 FOR UPDATE`;
      // Separate statement AFTER lock acquisition; never a pre-wait timestamp.
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT UTC_TIMESTAMP(3) AS now`;
      if (!rows[0] || !clock || !Number.isSafeInteger(rows[0].count) || rows[0].count < 0 || rows[0].count >= 2147483646) throw Error("budget_unavailable");
      return action(clock.now, rows[0], async until => {
        await tx.$executeRaw`UPDATE abuse_counters SET expires_at=${until}, count=count+1, updated_at=UTC_TIMESTAMP(3)
          WHERE bucket_type='checkpoint_partner_budget' AND subject_digest=${this.digest} AND digest_version=1
          AND window_start='1970-01-01 00:00:00' AND window_seconds=1`;
      });
    }, { maxWait: 1000, timeout: 2000 });
  }
  reserve(timeoutMs: number): Promise<{ retryAfterSeconds: number; lease?: PartnerLease }> {
    return this.locked(async (now, row, update) => {
      if (row.expires_at > now) return { retryAfterSeconds: Math.ceil((row.expires_at.getTime() - now.getTime()) / 1000) };
      const lease = { id: `${row.id}:${row.count + 1}`, notBefore: new Date(now.getTime() + timeoutMs + 2100) };
      await update(HELD_UNTIL);
      return { retryAfterSeconds: 0, lease };
    });
  }
  settle(lease: PartnerLease, cooldownSeconds?: number): Promise<void> {
    return this.locked(async (now, row, update) => {
      if (`${row.id}:${row.count}` !== lease.id || row.expires_at.getTime() !== HELD_UNTIL.getTime()) throw Error("budget_lease_changed");
      const cooldown = cooldownSeconds === Infinity ? HELD_UNTIL.getTime() : cooldownSeconds === undefined ? 0 : now.getTime() + cooldownSeconds * 1000;
      await update(new Date(Math.max(lease.notBefore.getTime(), cooldown)));
    });
  }
}
