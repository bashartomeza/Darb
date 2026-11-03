import { createHash, randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

export const DOCUMENT_KINDS = ["driver_licence", "vehicle_registration", "vehicle_photo", "national_id", "insurance", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const MERCHANT_DOCUMENT_KINDS = ["commercial_register", "national_id", "shop_photo", "other"] as const;
/** Kinds an applicant must have uploaded before an application can be sent for review. */
export const DRIVER_REQUIRED_DOCUMENT_KINDS = ["driver_licence", "vehicle_registration", "vehicle_photo", "national_id"] as const;
export const MERCHANT_REQUIRED_DOCUMENT_KINDS = ["commercial_register", "national_id", "shop_photo"] as const;

/** Must stay below the MEDIUMBLOB limit (16 MiB) of `document_files.bytes`. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
/** Per-revision cap, so one application cannot fill the database. */
export const MAX_DOCUMENTS_PER_REVISION = 6;

export type DocumentMime = "image/jpeg" | "image/png" | "application/pdf";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The declared Content-Type is not trusted: the first bytes decide what the file is. */
export function sniffDocumentMime(bytes: Buffer): DocumentMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

const KEY_PATTERN = /^[a-f0-9]{48}$/;

export function documentDigest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Path of a document uploaded before the bytes moved into the database. The key
 * is checked so it can never name a file outside the directory.
 */
export function legacyDocumentPath(dir: string, key: string) {
  if (!KEY_PATTERN.test(key)) throw new Error("invalid_storage_key");
  return join(dir, key);
}

/** Which document row a file belongs to: exactly one owner, never both. */
export type DocumentOwner = { driverDocumentId: string } | { merchantDocumentId: string };

function ownerWhere(owner: DocumentOwner) {
  return "driverDocumentId" in owner ? { driver_document_id: owner.driverDocumentId } : { merchant_document_id: owner.merchantDocumentId };
}

/** Raised when the stored bytes no longer match the digest recorded at upload. */
export class DocumentIntegrityError extends Error {
  constructor() {
    super("document_integrity_mismatch");
  }
}

type FileReader = Pick<PrismaClient, "documentFile">;
type FileWriter = Pick<Prisma.TransactionClient, "documentFile">;

/**
 * Document bytes live in MySQL (`document_files`), one row per document, deleted
 * together with it. `legacyDir` (the old DRIVER_DOCUMENTS_DIR) is optional and only
 * read for documents uploaded before this change that were not imported yet
 * (`npm run documents:import`); nothing new is ever written to disk.
 */
export function createDocumentStorage(db: FileReader, options: { legacyDir?: string } = {}) {
  const { legacyDir } = options;
  return {
    /** A fresh random key and the digest for a new upload. Nothing is written yet. */
    prepare(bytes: Buffer) {
      return { key: randomBytes(24).toString("hex"), sha256: documentDigest(bytes) };
    },
    /**
     * Writes the bytes inside the transaction that creates the document row, so
     * neither can exist without the other.
     */
    async save(tx: FileWriter, owner: DocumentOwner, file: { bytes: Buffer; contentType: string; sha256: string }) {
      await tx.documentFile.create({
        data: {
          ...ownerWhere(owner),
          content_type: file.contentType,
          size_bytes: file.bytes.length,
          sha256: file.sha256,
          bytes: new Uint8Array(file.bytes)
        }
      });
    },
    /**
     * The document's bytes, from the database or, for an older upload not yet
     * imported, from the legacy directory. Either way they must match the digest
     * recorded at upload.
     */
    async read(owner: DocumentOwner, document: { storage_key: string; sha256: string }) {
      const row = await db.documentFile.findUnique({ where: ownerWhere(owner), select: { bytes: true } });
      let bytes: Buffer;
      if (row) {
        bytes = Buffer.from(row.bytes);
      } else {
        if (!legacyDir) throw new Error("document_file_missing");
        bytes = await readFile(legacyDocumentPath(legacyDir, document.storage_key));
      }
      if (documentDigest(bytes) !== document.sha256) throw new DocumentIntegrityError();
      return bytes;
    },
    /**
     * The database bytes go with the document row (ON DELETE CASCADE). This only
     * clears a leftover disk copy of an older upload; missing files are fine.
     */
    async removeLegacyCopy(key: string) {
      if (!legacyDir) return;
      await rm(legacyDocumentPath(legacyDir, key), { force: true });
    }
  };
}

export type DocumentStorage = ReturnType<typeof createDocumentStorage>;
