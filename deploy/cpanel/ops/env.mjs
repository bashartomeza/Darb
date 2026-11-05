// Server-side environment helpers for the cPanel install (~/darb-app). Values are never printed.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Variables set in cPanel > Setup Node.js App > Environment variables. Passenger gives them to the web
 * app itself; migrations, backups and cron run outside it, so they are read from CloudLinux's selector
 * file (~/.cl.selector/node-selector.json) here. Only the darb-app entry is used.
 */
export function cpanelAppVariables(file = join(homedir(), ".cl.selector", "node-selector.json")) {
  if (!existsSync(file)) return {};
  let found = {};
  const walk = (node, inDarb) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const here = inDarb || key === "darb-app";
      if (here && value && typeof value === "object" && !Array.isArray(value)) {
        const strings = Object.entries(value).filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === "string");
        if (strings.length && strings.some(([k]) => k.startsWith("DB_") || k === "SMTP_PASSWORD")) found = { ...found, ...Object.fromEntries(strings) };
      }
      walk(value, here);
    }
  };
  try { walk(JSON.parse(readFileSync(file, "utf8")), false); } catch { return {}; }
  return found;
}

/** Loads cPanel variables, then ~/darb-app/.env, into process.env without overriding values already set. */
export function loadServerEnv(file = join(appRoot, ".env")) {
  for (const [key, value] of Object.entries(cpanelAppVariables())) if (process.env[key] === undefined) process.env[key] = value;
  if (!existsSync(file)) throw new Error(`Missing ${file}: run ops/setup.sh first.`);
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined || (process.env[match[1]] === "" && value !== "")) process.env[match[1]] = value;
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
