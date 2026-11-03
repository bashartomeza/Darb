import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../generated/prisma/client.js";
import { importLegacyDocumentFiles } from "../services/documentFileImport.js";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("old licence")]);
const PDF = Buffer.from("%PDF-1.7 old register");

type Row = { id: string; mime_type: string; size_bytes: number; sha256: string; storage_key: string; file: { id: string } | null };

function legacyRow(id: string, key: string, bytes: Buffer, mime = "image/jpeg"): Row {
  return { id, mime_type: mime, size_bytes: bytes.length, sha256: sha256(bytes), storage_key: key, file: null };
}

/** In-memory stand-in for the two document tables and document_files. */
function fakeDb(driverRows: Row[], merchantRows: Row[]) {
  const files: Record<string, unknown>[] = [];
  const page = (rows: Row[]) =>
    vi.fn(async ({ where, take }: { where: { id: { gt: string } }; take: number }) =>
      rows
        .filter((row) => row.id > where.id.gt)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, take)
        .map((row) => ({ ...row }))
    );
  const db = {
    files,
    driverVerificationDocument: { findMany: page(driverRows) },
    merchantApplicationDocument: { findMany: page(merchantRows) },
    documentFile: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        files.push(data);
        const owner = (data.driver_document_id ? driverRows : merchantRows).find(
          (row) => row.id === (data.driver_document_id ?? data.merchant_document_id)
        )!;
        owner.file = { id: `file_${files.length}` };
        return data;
      })
    }
  };
  return db;
}

describe("importing document files from the old directory", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "darb-import-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("copies verified files into the database, skips imported rows on a second run and keeps the source files", async () => {
    const driverKey = "a".repeat(48);
    const merchantKey = "b".repeat(48);
    await writeFile(join(dir, driverKey), JPEG);
    await writeFile(join(dir, merchantKey), PDF);
    const already = { ...legacyRow("d0", "c".repeat(48), JPEG), file: { id: "file_existing" } };
    const db = fakeDb([already, legacyRow("d1", driverKey, JPEG)], [legacyRow("m1", merchantKey, PDF, "application/pdf")]);

    const first = await importLegacyDocumentFiles(db as never, dir, { batchSize: 1 });

    expect(first).toEqual({ imported: 2, skipped: 1, missing: 0, mismatched: 0 });
    expect(db.files).toHaveLength(2);
    expect(db.files[0]).toMatchObject({ driver_document_id: "d1", content_type: "image/jpeg", size_bytes: JPEG.length, sha256: sha256(JPEG) });
    expect(Buffer.from(db.files[0].bytes as Uint8Array)).toEqual(JPEG);
    expect(db.files[1]).toMatchObject({ merchant_document_id: "m1", content_type: "application/pdf", sha256: sha256(PDF) });
    expect(Buffer.from(db.files[1].bytes as Uint8Array)).toEqual(PDF);

    const second = await importLegacyDocumentFiles(db as never, dir);
    expect(second).toEqual({ imported: 0, skipped: 3, missing: 0, mismatched: 0 });
    expect(db.documentFile.create).toHaveBeenCalledTimes(2);

    // Never deletes or changes the source files.
    expect((await readdir(dir)).sort()).toEqual([driverKey, merchantKey]);
    expect(await readFile(join(dir, driverKey))).toEqual(JPEG);
  });

  it("refuses files whose checksum or size does not match and counts missing ones", async () => {
    const tampered = "a".repeat(48);
    const truncated = "b".repeat(48);
    await writeFile(join(dir, tampered), Buffer.from("%PDF-1.7 something else"));
    await writeFile(join(dir, truncated), JPEG.subarray(0, 5));
    const db = fakeDb(
      [legacyRow("d1", tampered, PDF, "application/pdf"), legacyRow("d2", "e".repeat(48), JPEG), legacyRow("d3", "../escape", JPEG)],
      [legacyRow("m1", truncated, JPEG)]
    );

    const result = await importLegacyDocumentFiles(db as never, dir);

    expect(result).toEqual({ imported: 0, skipped: 0, missing: 2, mismatched: 2 });
    expect(db.documentFile.create).not.toHaveBeenCalled();
  });

  it("treats a row imported concurrently as skipped", async () => {
    const key = "a".repeat(48);
    await writeFile(join(dir, key), JPEG);
    const db = fakeDb([legacyRow("d1", key, JPEG)], []);
    db.documentFile.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" })
    );

    expect(await importLegacyDocumentFiles(db as never, dir)).toEqual({ imported: 0, skipped: 1, missing: 0, mismatched: 0 });
  });
});
