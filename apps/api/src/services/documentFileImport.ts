import { readFile } from "node:fs/promises";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { documentDigest, legacyDocumentPath } from "./driverDocumentStorage.js";

type ImportDb = Pick<PrismaClient, "driverVerificationDocument" | "merchantApplicationDocument" | "documentFile">;

type LegacyRow = { id: string; mime_type: string; size_bytes: number; sha256: string; storage_key: string; file: { id: string } | null };

export type DocumentImportCounts = {
  /** Copied from disk into `document_files` by this run. */
  imported: number;
  /** Already in the database (an earlier run, or uploaded after the change). */
  skipped: number;
  /** No readable file on disk for the row. */
  missing: number;
  /** The file on disk does not match the digest or size recorded at upload; left out. */
  mismatched: number;
};

const SELECT = {
  id: true,
  mime_type: true,
  size_bytes: true,
  sha256: true,
  storage_key: true,
  file: { select: { id: true } }
} as const;

/**
 * One-time move of document files uploaded before the bytes were stored in MySQL:
 * copies each file from `dir` (the old DRIVER_DOCUMENTS_DIR) into `document_files`
 * after checking it against the digest and size recorded at upload. Idempotent:
 * documents that already have their bytes in the database are skipped. Never
 * deletes or changes anything on disk.
 */
export async function importLegacyDocumentFiles(db: ImportDb, dir: string, options: { batchSize?: number } = {}) {
  const batchSize = options.batchSize ?? 100;
  const counts: DocumentImportCounts = { imported: 0, skipped: 0, missing: 0, mismatched: 0 };

  async function importRow(row: LegacyRow, owner: { driver_document_id: string } | { merchant_document_id: string }) {
    if (row.file) {
      counts.skipped += 1;
      return;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(legacyDocumentPath(dir, row.storage_key));
    } catch {
      counts.missing += 1;
      return;
    }
    if (bytes.length !== row.size_bytes || documentDigest(bytes) !== row.sha256) {
      counts.mismatched += 1;
      return;
    }
    try {
      await db.documentFile.create({
        data: { ...owner, content_type: row.mime_type, size_bytes: bytes.length, sha256: row.sha256, bytes: new Uint8Array(bytes) }
      });
      counts.imported += 1;
    } catch (error) {
      // Another run imported it in the meantime.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        counts.skipped += 1;
        return;
      }
      throw error;
    }
  }

  let after = "";
  for (;;) {
    const rows: LegacyRow[] = await db.driverVerificationDocument.findMany({
      where: { id: { gt: after } },
      select: SELECT,
      orderBy: { id: "asc" },
      take: batchSize
    });
    for (const row of rows) await importRow(row, { driver_document_id: row.id });
    if (rows.length < batchSize) break;
    after = rows[rows.length - 1].id;
  }

  after = "";
  for (;;) {
    const rows: LegacyRow[] = await db.merchantApplicationDocument.findMany({
      where: { id: { gt: after } },
      select: SELECT,
      orderBy: { id: "asc" },
      take: batchSize
    });
    for (const row of rows) await importRow(row, { merchant_document_id: row.id });
    if (rows.length < batchSize) break;
    after = rows[rows.length - 1].id;
  }

  return counts;
}
