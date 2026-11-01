import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";

export function loadDatabaseEnvironment(envPath) {
  const parsed = parse(readFileSync(envPath));
  const value = process.env.DATABASE_URL ?? parsed.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is missing from the ignored environment file");
  const url = new URL(value);
  if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must use the mysql provider");
  const database = url.pathname.slice(1);
  if (!database) throw new Error("DATABASE_URL must name a database");
  return { url, database };
}

function optionValue(value) {
  return `"${decodeURIComponent(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function createMysqlDefaults(url) {
  const directory = mkdtempSync(join(tmpdir(), "darb-mysql-"));
  const path = join(directory, "client.cnf");
  const port = url.port || "3306";
  const content = [
    "[client]",
    `user=${optionValue(url.username)}`,
    `password=${optionValue(url.password)}`,
    `host=${optionValue(url.hostname)}`,
    `port=${port}`,
    "protocol=tcp",
    "default-character-set=utf8mb4",
    ""
  ].join("\n");
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

export function safeRestoreDatabaseName(name) {
  return /^darb_restore_[a-z0-9_]+$/.test(name) && name.length <= 64;
}

export function databaseUrlFor(url, database) {
  const copy = new URL(url);
  copy.pathname = `/${database}`;
  return copy.toString();
}

export function normalizeMysqlDump(buffer) {
  const lines = buffer.toString("utf8").split(/\r?\n/);
  let customDelimiter = false;
  const normalized = lines.map((line) => {
    if (line.trim() === "DELIMITER ;;") {
      customDelimiter = true;
      return line;
    }
    if (line.trim() === "DELIMITER ;") {
      customDelimiter = false;
      return line;
    }
    if (customDelimiter && /^\s*\);\s+\*\/;;\s*$/.test(line)) {
      return line.replace(/\);\s+\*\/;;/, ") */;;");
    }
    return line;
  });
  return Buffer.from(normalized.join("\n"), "utf8");
}
