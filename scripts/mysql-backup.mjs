import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createMysqlDefaults,
  loadDatabaseEnvironment,
  normalizeMysqlDump
} from "./lib/mysql-tools.mjs";

const root = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const envPath = resolve(root, process.env.DARB_ENV_FILE ?? "apps/api/.env");
const outputDirectory = resolve(root, process.env.DARB_BACKUP_DIR ?? "backups/mysql");
let defaults;
let dumpPath;
try {
  const { url, database } = loadDatabaseEnvironment(envPath);
  defaults = createMysqlDefaults(url);
  mkdirSync(outputDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  dumpPath = resolve(outputDirectory, `darb-${timestamp}.sql`);
  const result = spawnSync("mysqldump", [
    `--defaults-extra-file=${defaults.path}`,
    "--single-transaction", "--quick", "--routines", "--triggers", "--events",
    "--no-tablespaces", "--set-gtid-purged=OFF", "--hex-blob", "--default-character-set=utf8mb4",
    database
  ], { encoding: "buffer", maxBuffer: 1024 * 1024 * 512 });
  if (result.error || result.status !== 0) throw new Error("mysqldump failed; credentials and command output were withheld");
  writeFileSync(dumpPath, normalizeMysqlDump(result.stdout), { flag: "wx" });
  const checksum = createHash("sha256").update(readFileSync(dumpPath)).digest("hex");
  writeFileSync(`${dumpPath}.sha256`, `${checksum}  ${basename(dumpPath)}\n`, { flag: "wx" });
  console.log(`Backup created: ${dumpPath}`);
  console.log(`Checksum created: ${dumpPath}.sha256`);
} catch (error) {
  if (dumpPath) rmSync(dumpPath, { force: true });
  console.error(`Backup failed safely: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  defaults?.cleanup();
}
