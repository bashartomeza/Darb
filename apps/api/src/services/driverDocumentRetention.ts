import type { PrismaClient } from "../generated/prisma/client.js";
import { AccountStatus, AuditAction, DriverVerificationStatus } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import type { DocumentStorage } from "./driverDocumentStorage.js";

/**
 * Deletes uploaded documents once their application was decided and the
 * retention window has passed. Pending applications are never touched.
 * Safe to run repeatedly (for example from a daily scheduled job).
 */
export async function purgeDecidedDriverDocuments(
  db: PrismaClient,
  storage: DocumentStorage,
  options: { retentionDays: number; now?: Date; batchSize?: number }
) {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000);
  const documents = await db.driverVerificationDocument.findMany({
    where: {
      // Renewal uploads (documents_expired / pending) are never purged before a decision.
      verification: {
        status: { in: [DriverVerificationStatus.approved, DriverVerificationStatus.rejected] },
        reviewed_at: { lt: cutoff }
      }
    },
    take: options.batchSize ?? 500,
    orderBy: { created_at: "asc" }
  });
  let purged = 0;
  for (const document of documents) {
    await storage.remove(document.storage_key);
    await db.$transaction(async (tx) => {
      await tx.driverVerificationDocument.delete({ where: { id: document.id } });
      await auditEvent(tx, {
        action: AuditAction.driver_verification,
        entityType: "DriverVerification",
        entityId: document.verification_id,
        metadata: { action: "driver_document_purged", kind: document.kind, retention_days: options.retentionDays }
      });
    });
    purged += 1;
  }

  // Shop-owner applications: same rule, measured from the account decision.
  const merchantDocuments = await db.merchantApplicationDocument.findMany({
    where: { user: { account_status: { not: AccountStatus.pending }, status_updated_at: { lt: cutoff } } },
    take: options.batchSize ?? 500,
    orderBy: { created_at: "asc" }
  });
  for (const document of merchantDocuments) {
    await storage.remove(document.storage_key);
    await db.$transaction(async (tx) => {
      await tx.merchantApplicationDocument.delete({ where: { id: document.id } });
      await auditEvent(tx, {
        action: AuditAction.account_status_changed,
        entityType: "User",
        entityId: document.user_id,
        metadata: { action: "merchant_document_purged", kind: document.kind, retention_days: options.retentionDays }
      });
    });
    purged += 1;
  }
  return { purged };
}
