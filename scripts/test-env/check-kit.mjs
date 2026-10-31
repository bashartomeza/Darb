// Shared helpers for the demo checks (run-checks.mjs and new-feature-checks.mjs): settings from
// apps/api/.env pointed at the disposable masari_demo database, an HTTP helper, the check
// recorder and the reset helper.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const root = resolve(import.meta.dirname, "../..");
export const env = Object.fromEntries(
  readFileSync(resolve(root, "apps/api/.env"), "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
export const databaseUrl = env.DATABASE_URL.replace(/\/[A-Za-z0-9_]+(\?|$)/, "/masari_demo$1");
Object.assign(process.env, env, { DATABASE_URL: databaseUrl, DEMO_RESET_ALLOWED_DATABASES: "masari_demo", APP_ENV: "demo" });

export const base = "http://localhost:3000/api/v1";
export const stateDir = resolve(root, ".staging-data/test-env");
export const otpFile = resolve(stateDir, "otp.txt");
export const results = [];

export async function http(path, { method = "GET", token, body, headers = {}, raw, expect } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.authorization = token.startsWith("Onboarding ") ? token : `Bearer ${token}`;
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  const response = await fetch(base + path, init);
  const buffer = Buffer.from(await response.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buffer.toString()); } catch { /* not json */ }
  if (expect !== undefined && ![].concat(expect).includes(response.status)) {
    throw new Error(`${method} ${path} -> ${response.status} (wanted ${[].concat(expect).join("/")}) ${buffer.toString().slice(0, 140)}`);
  }
  return { status: response.status, json, buffer, headers: response.headers };
}

export async function check(id, name, fn) {
  try {
    await fn();
    results.push({ id, name, ok: true });
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    results.push({ id, name, ok: false, why: String(error.message ?? error).slice(0, 300) });
    console.log(`FAIL ${id} ${name}\n     ${String(error.message ?? error).slice(0, 300)}`);
  }
}
export const must = (condition, message) => { if (!condition) throw new Error(message); };

export function runNpm(script) {
  const result = spawnSync("npm", ["run", script], { cwd: root, env: process.env, shell: true, encoding: "utf8", timeout: 240_000 });
  const out = (result.stdout ?? "") + (result.stderr ?? "");
  return { ok: result.status === 0 && /"ok":\s*true/.test(out), out };
}

export function powershellReset() {
  const result = spawnSync("pwsh", ["-NoProfile", "-File", "scripts/test-env/reset-data.ps1"], { cwd: root, encoding: "utf8", timeout: 240_000 });
  if (result.status !== 0) throw new Error("reset-data failed: " + (result.stdout + result.stderr).slice(-300));
}


export function latestOtp(phone) {
  const lines = readFileSync(otpFile, "utf8").trim().split("\n").filter((l) => l.includes(phone));
  return lines.at(-1)?.split(" ").at(-1);
}
export function latestEmailCode(email, purpose) {
  const lines = readFileSync(resolve(stateDir, "email-codes.txt"), "utf8").trim().split("\n").filter((l) => l.includes(` ${email} ${purpose} `));
  return lines.at(-1)?.split(" ").at(-1);
}
