import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createMysqlDefaults, databaseUrlFor, loadDatabaseEnvironment, safeRestoreDatabaseName } from "./lib/mysql-tools.mjs";
import { executable } from "./lib/process.mjs";

const options = new Map();
const flags = new Set();
for (let index = 2; index < process.argv.length; index++) {
  const item = process.argv[index];
  if (item === "--") continue;
  if (item.includes("=") && item.startsWith("--")) {
    const [key, ...value] = item.split("=");
    options.set(key, value.join("="));
    continue;
  }
  if (["--confirm-isolated", "--cleanup", "--migrate"].includes(item)) flags.add(item);
  else options.set(item, process.argv[++index]);
}
const dumpPath = options.get("--dump") ? resolve(options.get("--dump")) : null;
const destination = options.get("--database");
const root = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
let defaults;
let created = false;
const started = Date.now();
function mysql(args, settings = {}) {
  const result = spawnSync("mysql", [`--defaults-extra-file=${defaults.path}`, ...args], {
    encoding: settings.input ? "buffer" : "utf8",
    input: settings.input,
    maxBuffer: 1024 * 1024 * 512
  });
  if (result.error || result.status !== 0) throw new Error("MySQL operation failed; sensitive output was withheld");
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}
try {
  if (!dumpPath || !destination || !flags.has("--confirm-isolated")) {
    throw new Error("Use --dump <file> --database darb_restore_<name> --confirm-isolated");
  }
  if (!existsSync(dumpPath)) throw new Error("The requested dump file does not exist");
  if (!safeRestoreDatabaseName(destination)) throw new Error("Restore database must match darb_restore_[a-z0-9_]+");
  const { url, database: source } = loadDatabaseEnvironment(resolve(root, process.env.DARB_ENV_FILE ?? "apps/api/.env"));
  if (destination === source) throw new Error("Refusing to restore into the configured source database");
  defaults = createMysqlDefaults(url);
  const existingTables = Number(mysql(["--batch", "--skip-column-names", "-e",
    `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${destination}'`]));
  if (existingTables > 0) throw new Error("Refusing to restore into a non-empty destination database");

  const sidecar = `${dumpPath}.sha256`;
  if (!existsSync(sidecar)) throw new Error("Backup checksum sidecar is required");
  const expected = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(dumpPath)).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(expected) || expected.toLowerCase() !== actual) throw new Error("Backup checksum verification failed");

  mysql(["--execute", `CREATE DATABASE IF NOT EXISTS \`${destination}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`]);
  created = true;
  mysql(["--database", destination], { input: readFileSync(dumpPath) });

  const npmFile = process.platform === "win32" && process.env.npm_execpath ? process.execPath : executable("npm");
  const migrationEnvironment = { ...process.env, DATABASE_URL: databaseUrlFor(url, destination) };
  const runNpmScript = (script) => {
    const npmArgs = process.platform === "win32" && process.env.npm_execpath
      ? [process.env.npm_execpath, "run", script]
      : ["run", script];
    return spawnSync(npmFile, npmArgs, {
      cwd: root,
      env: migrationEnvironment,
      encoding: "utf8",
      shell: process.platform === "win32" && /\.cmd$/i.test(npmFile)
    });
  };
  if (flags.has("--migrate") && runNpmScript("db:migrate").status !== 0) {
    throw new Error("Prisma migration deploy failed on the isolated restored database");
  }
  if (runNpmScript("db:migrate:status").status !== 0) {
    throw new Error("Prisma migration status is not current on the restored database");
  }
  const expectedTables = [
    "users",
    "auth_sessions",
    "refresh_tokens",
    "driver_routes",
    "passenger_requests",
    "merchant_orders",
    "matches",
    "trips",
    "location_events",
    "_prisma_migrations"
  ];
  const tableCount = Number(mysql(["--batch", "--skip-column-names", "--database", destination, "-e",
    `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (${expectedTables.map((name) => `'${name}'`).join(",")})`]));
  if (tableCount !== expectedTables.length) throw new Error("Restored database does not have the expected Darb table identity");
  const check = mysql(["--batch", "--skip-column-names", "--database", destination, "-e", "SELECT 1"]);
  if (check !== "1") throw new Error("Restored database connectivity verification failed");
  console.log(`Restore verification passed for isolated database ${destination}.`);
  console.log(`Verified dump: ${basename(dumpPath)}; elapsed_ms=${Date.now() - started}.`);
} catch (error) {
  console.error(`Restore verification failed safely: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  if (flags.has("--cleanup") && created && defaults && safeRestoreDatabaseName(destination)) {
    try {
      mysql(["--execute", `DROP DATABASE \`${destination}\``]);
      console.log(`Removed isolated restore database ${destination}.`);
    } catch {
      console.error("Isolated restore cleanup failed; manual cleanup is required.");
      process.exitCode = 1;
    }
  }
  defaults?.cleanup();
}
