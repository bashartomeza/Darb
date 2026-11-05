// Server-side environment helpers for the cPanel install (~/darb-app). Values are never printed.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Loads ~/darb-app/.env into process.env without overriding values already set. */
export function loadServerEnv(file = join(appRoot, ".env")) {
  if (!existsSync(file)) throw new Error(`Missing ${file}: run ops/setup.sh first.`);
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

/** mysql://user:password@host:port/name from the DB_* parts, each part URL-encoded. */
export function databaseUrlFromEnv(env = process.env) {
  const missing = ["DB_USER", "DB_PASSWORD", "DB_NAME"].filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")} in .env`);
  const host = env.DB_HOST || "localhost";
  const port = env.DB_PORT || "3306";
  return `mysql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/${encodeURIComponent(env.DB_NAME)}`;
}
