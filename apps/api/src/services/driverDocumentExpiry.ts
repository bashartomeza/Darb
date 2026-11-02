import type { PrismaClient } from "../generated/prisma/client.js";
import { AccountStatus, AuditAction, DriverVerificationStatus } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { notify, notifyOnce } from "./notifications.js";

export const EXPIRY_KINDS = ["licence", "vehicle_registration", "insurance", "contract"] as const;
export type ExpiryKind = (typeof EXPIRY_KINDS)[number];

/** Days before the last valid day at which the driver is reminded (nearest first). */
export const EXPIRY_NOTICE_DAYS = [7, 30] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export const EXPIRY_COLUMN: Record<ExpiryKind, "licence_expires_at" | "vehicle_registration_expires_at" | "insurance_expires_at" | "contract_ends_at"> = {
  licence: "licence_expires_at",
  vehicle_registration: "vehicle_registration_expires_at",
  insurance: "insurance_expires_at",
  contract: "contract_ends_at"
};

export type ExpiryDates = Partial<Record<ExpiryKind, Date | null>>;

export function utcMidnight(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Whole calendar days (UTC) from today to the document's last valid day.
 * 0 means it is still valid today and expires at the end of the day; -1 means
 * it expired yesterday. A document is therefore valid through its whole date.
 */
export function daysUntilExpiry(expiresOn: Date, now: Date) {
  return Math.round((utcMidnight(expiresOn) - utcMidnight(now)) / DAY_MS);
}

export function isExpired(expiresOn: Date, now: Date) {
  return daysUntilExpiry(expiresOn, now) < 0;
}

/** The reminder tier that applies today, or null when none does yet. */
export function noticeThreshold(daysLeft: number): (typeof EXPIRY_NOTICE_DAYS)[number] | null {
  if (daysLeft < 0) return null;
  for (const threshold of EXPIRY_NOTICE_DAYS) if (daysLeft <= threshold) return threshold;
  return null;
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

type ExpiryRow = {
  licence_expires_at: Date | null;
  vehicle_registration_expires_at: Date | null;
  insurance_expires_at: Date | null;
  contract_ends_at: Date | null;
};

export function expiryDatesOf(row: ExpiryRow): Record<ExpiryKind, Date | null> {
  return {
    licence: row.licence_expires_at ?? null,
    vehicle_registration: row.vehicle_registration_expires_at ?? null,
    insurance: row.insurance_expires_at ?? null,
    contract: row.contract_ends_at ?? null
  };
}

export type ExpiryCheckResult = { restricted: number; reminded: number; checked: number };

/**
 * Daily job. Reminds approved drivers 30 and 7 days before a document runs out,
 * and restricts them (`documents_expired`, profile unverified) the day after.
 * Idempotent: reminders are de-duplicated per document, date and tier, and the
 * restriction only applies to a verification that is still `approved`.
 * Trips a driver already accepted are not touched.
 */
export async function runDriverDocumentExpiryCheck(
  db: PrismaClient,
  options: { now?: Date; batchSize?: number } = {}
): Promise<ExpiryCheckResult> {
  const now = options.now ?? new Date();
  const result: ExpiryCheckResult = { restricted: 0, reminded: 0, checked: 0 };
  // Anything with a date on or before today + 30 days is interesting; the date
  // columns are plain dates so compare against the UTC midnight 30 days ahead.
  const horizon = new Date(utcMidnight(now) + EXPIRY_NOTICE_DAYS[EXPIRY_NOTICE_DAYS.length - 1] * DAY_MS);
  const batchSize = options.batchSize ?? 500;
  let cursor = "";
  for (;;) {
  const candidates = await db.driverVerification.findMany({
    where: {
      id: { gt: cursor },
      status: DriverVerificationStatus.approved,
      user: { role: "driver", account_status: AccountStatus.active },
      OR: EXPIRY_KINDS.map((kind) => ({ [EXPIRY_COLUMN[kind]]: { lte: horizon } }))
    },
    take: batchSize,
    orderBy: { id: "asc" }
  });
  if (candidates.length === 0) break;
  cursor = candidates[candidates.length - 1].id;

  for (const verification of candidates) {
    result.checked += 1;
    const dates = expiryDatesOf(verification);
    const expired = EXPIRY_KINDS.filter((kind) => dates[kind] && isExpired(dates[kind]!, now));
    if (expired.length > 0) {
      const changed = await db.$transaction(async (tx) => {
        const moved = await tx.driverVerification.updateMany({
          where: { id: verification.id, status: DriverVerificationStatus.approved, revision: verification.revision },
          data: {
            status: DriverVerificationStatus.documents_expired,
            documents_expired_at: now,
            renewal_submitted_at: null,
            revision: { increment: 1 }
          }
        });
        if (moved.count !== 1) return false;
        await tx.driverProfile.updateMany({ where: { user_id: verification.user_id }, data: { verified: false } });
        await tx.driverVerificationDecision.create({
          data: {
            verification_id: verification.id,
            revision: verification.revision,
            decision: "documents_expired",
            reason: expired.join(", ")
          }
        });
        await auditEvent(tx, {
          action: AuditAction.driver_verification,
          entityType: "DriverVerification",
          entityId: verification.id,
          metadata: {
            action: "driver_documents_expired",
            target_user_id: verification.user_id,
            expired,
            previous_revision: verification.revision
          }
        });
        await notify(tx, {
          userId: verification.user_id,
          type: "driver_documents_expired",
          entityType: "DriverVerification",
          entityId: verification.id,
          dedupeKey: `driver_documents_expired:${verification.id}:${verification.revision}`,
          params: { kinds: expired }
        });
        return true;
      });
      if (changed) result.restricted += 1;
      continue;
    }

    for (const kind of EXPIRY_KINDS) {
      const date = dates[kind];
      if (!date) continue;
      const daysLeft = daysUntilExpiry(date, now);
      const threshold = noticeThreshold(daysLeft);
      if (threshold === null) continue;
      const created = await notifyOnce(db, {
        userId: verification.user_id,
        type: "driver_documents_expiring",
        entityType: "DriverVerification",
        entityId: verification.id,
        dedupeKey: `driver_documents_expiring:${verification.id}:${kind}:${isoDate(date)}:${threshold}`,
        params: { kind, expires_on: isoDate(date), days_left: daysLeft, threshold }
      });
      if (created) result.reminded += 1;
    }
  }
  if (candidates.length < batchSize) break;
  }
  return result;
}
