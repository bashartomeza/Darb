import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import {
  DRIVER_REQUIRED_DOCUMENT_KINDS,
  MERCHANT_REQUIRED_DOCUMENT_KINDS
} from "../services/driverDocumentStorage.js";

type Db = PrismaClient | Prisma.TransactionClient;

export function requiredDocumentKinds(role: string): readonly string[] {
  if (role === "driver") return DRIVER_REQUIRED_DOCUMENT_KINDS;
  if (role === "merchant") return MERCHANT_REQUIRED_DOCUMENT_KINDS;
  return [];
}

/** Kinds the applicant has uploaded for the application under review. */
export async function uploadedDocumentKinds(db: Db, userId: string, role: string): Promise<Set<string>> {
  if (role === "driver") {
    const verification = await db.driverVerification.findUnique({ where: { user_id: userId } });
    if (!verification) return new Set();
    const rows = await db.driverVerificationDocument.findMany({
      where: { verification_id: verification.id, revision: verification.revision },
      select: { kind: true }
    });
    return new Set(rows.map((row) => row.kind));
  }
  if (role === "merchant") {
    const rows = await db.merchantApplicationDocument.findMany({ where: { user_id: userId }, select: { kind: true } });
    return new Set(rows.map((row) => row.kind));
  }
  return new Set();
}

export async function missingDocumentKinds(db: Db, userId: string, role: string): Promise<string[]> {
  const uploaded = await uploadedDocumentKinds(db, userId, role);
  return requiredDocumentKinds(role).filter((kind) => !uploaded.has(kind));
}
