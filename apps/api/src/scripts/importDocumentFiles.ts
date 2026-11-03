import { isAbsolute } from "node:path";
import { prisma } from "../lib/prisma.js";
import { importLegacyDocumentFiles } from "../services/documentFileImport.js";

// One-time copy of driver and merchant document files from DRIVER_DOCUMENTS_DIR into
// the database. Safe to run again; source files are never deleted. Prints counts only.
const dir = process.env.DRIVER_DOCUMENTS_DIR?.trim() ?? "";
try {
  if (!dir || !isAbsolute(dir)) {
    console.log("DRIVER_DOCUMENTS_DIR is not set to an absolute path; nothing to import.");
  } else {
    const result = await importLegacyDocumentFiles(prisma, dir);
    console.log(
      `Imported ${result.imported} document file(s); skipped ${result.skipped} already in the database; ` +
        `${result.missing} missing on disk; ${result.mismatched} not matching their recorded checksum.`
    );
    if (result.missing > 0 || result.mismatched > 0) process.exitCode = 1;
  }
} catch (error) {
  // Only the error code: messages could name files or rows.
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  console.error(`Document import failed${code ? ` (${code})` : ""}.`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
