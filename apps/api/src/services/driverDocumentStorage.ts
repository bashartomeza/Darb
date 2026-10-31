import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

export const DOCUMENT_KINDS = ["driver_licence", "vehicle_registration", "national_id", "insurance", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const MERCHANT_DOCUMENT_KINDS = ["commercial_register", "national_id", "shop_photo", "other"] as const;
/** Kinds an applicant must have uploaded before an application can be sent for review. */
export const DRIVER_REQUIRED_DOCUMENT_KINDS = ["driver_licence", "vehicle_registration", "national_id"] as const;
export const MERCHANT_REQUIRED_DOCUMENT_KINDS = ["commercial_register", "national_id", "shop_photo"] as const;

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
/** Per-revision cap, so one application cannot fill the disk. */
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

export function createDocumentStorage(dir: string) {
  const pathFor = (key: string) => {
    if (!KEY_PATTERN.test(key)) throw new Error("invalid_storage_key");
    return join(dir, key);
  };
  return {
    /** Writes the bytes under a random key and returns the key and digest. Never overwrites. */
    async save(bytes: Buffer) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const key = randomBytes(24).toString("hex");
      const handle = await open(pathFor(key), "wx", 0o600);
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      return { key, sha256: createHash("sha256").update(bytes).digest("hex") };
    },
    read: async (key: string) => readFile(pathFor(key)),
    /** Missing files are fine: removal is idempotent. */
    remove: async (key: string) => rm(pathFor(key), { force: true })
  };
}

export type DocumentStorage = ReturnType<typeof createDocumentStorage>;
