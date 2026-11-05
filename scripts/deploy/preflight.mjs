#!/usr/bin/env node
// Read-only deployment preflight for the Darb API environment.
// Usage: node scripts/deploy/preflight.mjs [--env-file <path>] [--target production|staging]
// Validates the environment against the rules in apps/api/src/config.ts and
// docs/deployment/DEPLOY_RUNBOOK.md. Prints PASS/FAIL/WARN per item and never
// prints a variable's value. Exit code 1 when any item FAILs.
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_MARKERS = ["development-jwt-secret", "change-me", "changeme", "replace-with", "placeholder", "example", "your-"];
const PEPPERS = [
  "INVITATION_CODE_PEPPER",
  "PHONE_DIGEST_PEPPER",
  "OTP_CODE_PEPPER",
  "ONBOARDING_SESSION_PEPPER",
  "IDEMPOTENCY_KEY_PEPPER",
  "ABUSE_KEY_PEPPER"
];
// Flags config.ts rejects (or the runbook forbids) when set to true in staging/production.
const FORBIDDEN_TRUE = [
  "ENABLE_DEMO_FEATURES",
  "MULTI_ROUTE_ENTRY_ENABLED",
  "MULTI_ROUTE_MATCHING_ENABLED",
  "CANONICAL_TRIP_CREATION_ENABLED",
  "CANONICAL_SHARED_TRIPS_ENABLED",
  "CANONICAL_SHARED_TRIP_MOBILE_ENABLED",
  "ONBOARDING_TEST_LEGAL_FIXTURES_ENABLED"
];

export function parseEnvFile(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    env[match[1]] = value;
  }
  return env;
}

function isPlaceholder(value) {
  const v = value.trim().toLowerCase();
  return (v.startsWith("<") && v.endsWith(">")) || PLACEHOLDER_MARKERS.some((m) => v.includes(m));
}

// null = unset, false = invalid, true = valid and in range.
function intIn(value, min, max) {
  if (value === undefined || value === "") return null;
  if (!/^\d+$/.test(value)) return false;
  const n = Number(value);
  return n >= min && n <= max;
}

const MAP_PROVIDERS = ["disabled", "osrm", "openrouteservice", "graphhopper", "mapbox"];

// Free public servers that forbid production or heavy traffic.
export function isPublicDemoHost(urlText) {
  try {
    const host = new URL(urlText.replace(/[{}]/g, "")).hostname.toLowerCase();
    return ["openstreetmap.org", "project-osrm.org"].some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// Road routing and map tiles. The API proxy (MAPS_ROUTING_*) holds provider keys; ROUTING_BASE_URL,
// TILE_URL_TEMPLATE and TILE_ATTRIBUTION are build-time --dart-define values for the mobile app and are
// only checked when present in the environment being inspected. See docs/maps/PRODUCTION_PROVIDERS.md.
function checkMapProviders(env, add, results) {
  const val = (name) => (env[name] ?? "").trim();
  const provider = val("MAPS_ROUTING_PROVIDER") || "disabled";
  add("MAPS_ROUTING_PROVIDER", MAP_PROVIDERS.includes(provider), `MAPS_ROUTING_PROVIDER must be one of ${MAP_PROVIDERS.join(", ")}`);
  if (provider === "disabled") {
    results.push({ id: "MAPS_ROUTING_DISABLED", status: "WARN", message: "MAPS_ROUTING_PROVIDER is not set; GET /api/v1/maps/route answers 503 and app maps draw a straight line with a 'route preview unavailable' note" });
  } else if (MAP_PROVIDERS.includes(provider)) {
    const base = val("MAPS_ROUTING_BASE_URL");
    if (provider === "osrm") add("MAPS_ROUTING_BASE_URL", /^https:\/\//.test(base) && !isPublicDemoHost(base), "MAPS_ROUTING_BASE_URL must be an https:// OSRM server (the public demo server is forbidden in production)");
    else if (base !== "") add("MAPS_ROUTING_BASE_URL", /^https:\/\//.test(base) && !isPublicDemoHost(base), "MAPS_ROUTING_BASE_URL, when set, must be https:// and not a public demo server");
    if (provider !== "osrm") add("MAPS_ROUTING_API_KEY", val("MAPS_ROUTING_API_KEY").length >= 8 && !isPlaceholder(val("MAPS_ROUTING_API_KEY")), `MAPS_ROUTING_API_KEY required (not a placeholder) for MAPS_ROUTING_PROVIDER=${provider}`);
    for (const [name, min, max] of [["MAPS_ROUTING_TIMEOUT_MS", 250, 20000], ["MAPS_ROUTING_CACHE_TTL_SECONDS", 0, 86400], ["MAPS_ROUTING_USER_RATE_PER_MINUTE", 1, 600], ["MAPS_ROUTING_GLOBAL_RATE_PER_MINUTE", 1, 6000]]) {
      add(name, intIn(val(name), min, max) !== false, `${name} must be ${min}-${max} when set`);
    }
  }
  for (const name of ["ROUTING_BASE_URL", "TILE_URL_TEMPLATE"]) {
    if (val(name) !== "" && isPublicDemoHost(val(name))) {
      results.push({ id: name, status: "WARN", message: `${name} points at a public demo server (OpenStreetMap tiles / OSRM demo); their usage policies forbid production traffic and the production app refuses them` });
    }
  }
  if (val("TILE_URL_TEMPLATE") === "") {
    results.push({ id: "TILE_URL_TEMPLATE", status: "WARN", message: "TILE_URL_TEMPLATE is not set in this environment; production app builds show no map tiles unless it is passed as --dart-define (check your build command)" });
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ target?: "production" | "staging" }} [options]
 * @returns {{ id: string, status: "PASS" | "FAIL" | "WARN", message: string }[]}
 */
export function runPreflight(env, options = {}) {
  const target = options.target ?? "production";
  const results = [];
  const add = (id, ok, message, level = "FAIL") => results.push({ id, status: ok ? "PASS" : level, message });
  const val = (name) => (env[name] ?? "").trim();
  const bool = (name) => val(name) === "true";

  add("APP_ENV", val("APP_ENV") === target, `APP_ENV must be "${target}"`);
  for (const name of FORBIDDEN_TRUE) {
    add(name, !bool(name), `${name} must not be true in ${target}`);
  }
  add("ROUTE_MANAGEMENT_ENABLED", ["", "true", "false"].includes(val("ROUTE_MANAGEMENT_ENABLED")), "ROUTE_MANAGEMENT_ENABLED must be true or false when set");

  const release = val("APP_RELEASE");
  add("APP_RELEASE", release !== "" && !isPlaceholder(release), "APP_RELEASE must be set to an immutable release id (not a <placeholder>)");

  const db = val("DATABASE_URL");
  add("DATABASE_URL", /^mysql:\/\/[^\s]+@[^\s/]+\/[A-Za-z0-9_]+/.test(db) && !isPlaceholder(db), "DATABASE_URL must be a real mysql URL of the form mysql://<user>:<password>@<host>:<port>/<db>");

  const secrets = {};
  for (const name of ["JWT_SECRET", "REFRESH_TOKEN_PEPPER", "AUTH_ACTION_TOKEN_PEPPER"]) {
    const v = val(name);
    secrets[name] = v;
    add(name, v.length >= 32 && !isPlaceholder(v), `${name} must be set, at least 32 characters, not a placeholder`);
  }
  const core = Object.values(secrets).filter(Boolean);
  add("SECRETS_DISTINCT", new Set(core).size === core.length, "JWT_SECRET, REFRESH_TOKEN_PEPPER and AUTH_ACTION_TOKEN_PEPPER must differ from each other");

  // Self-service registration (PUBLIC_ONBOARDING_ENABLED) needs the onboarding peppers; the invitation-code
  // pepper is only needed while the optional Admin invitation feature is on.
  if (bool("INVITATIONS_ENABLED") || bool("PUBLIC_ONBOARDING_ENABLED")) {
    const invitationsOn = bool("INVITATIONS_ENABLED");
    const peppers = PEPPERS.filter((n) => invitationsOn || n !== "INVITATION_CODE_PEPPER").map((n) => [n, val(n)]);
    for (const [name, v] of peppers) add(name, v.length >= 32 && !isPlaceholder(v), `${name} required (32+ chars) when onboarding or invitations are enabled`);
    const all = [...peppers.map(([, v]) => v), ...core].filter(Boolean);
    add("PEPPERS_DISTINCT", new Set(all).size === all.length, "all onboarding peppers must be distinct from each other and from core secrets");
  } else {
    results.push({ id: "ONBOARDING_PEPPERS", status: "PASS", message: "onboarding and invitations disabled; onboarding peppers not required" });
  }

  const origins = val("CORS_ORIGINS").split(",").map((o) => o.trim()).filter(Boolean);
  const originOk = origins.length > 0 && origins.every((o) => {
    try {
      const u = new URL(o);
      return u.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    } catch {
      return false;
    }
  });
  add("CORS_ORIGINS", originOk, "CORS_ORIGINS must list explicit https:// non-local origins (no wildcard)");
  if (target === "production") {
    add("CORS_ORIGINS_DOMAIN", origins.includes("https://darb.aynur.ps"), "production CORS_ORIGINS is expected to include https://darb.aynur.ps", "WARN");
  }

  add("TRUST_PROXY", /^([0-5]|none)$/.test(val("TRUST_PROXY")), "TRUST_PROXY must be none, 0, or a hop count 1-5 (explicit)");

  add("ACCESS_TOKEN_TTL_SECONDS", intIn(val("ACCESS_TOKEN_TTL_SECONDS"), 300, 1800) !== false, "ACCESS_TOKEN_TTL_SECONDS must be 300-1800 when set (default 900)");
  add("REFRESH_TOKEN_TTL_DAYS", intIn(val("REFRESH_TOKEN_TTL_DAYS"), 1, 90) !== false, "REFRESH_TOKEN_TTL_DAYS must be 1-90 when set (default 30)");
  add("RATE_LIMIT_GLOBAL_MAX", intIn(val("RATE_LIMIT_GLOBAL_MAX"), 50, 1000) !== false, "RATE_LIMIT_GLOBAL_MAX must be 50-1000 when set");
  add("RATE_LIMIT_LOGIN_MAX", intIn(val("RATE_LIMIT_LOGIN_MAX"), 3, 50) !== false, "RATE_LIMIT_LOGIN_MAX must be 3-50 when set");

  if (bool("PUBLIC_ONBOARDING_ENABLED")) add("PUBLIC_ONBOARDING_ENABLED", (val("OTP_PROVIDER") || "disabled") === "email", "PUBLIC_ONBOARDING_ENABLED requires OTP_PROVIDER=email in staging/production");
  const otpProvider = val("OTP_PROVIDER") || "disabled";
  add("OTP_PROVIDER", ["disabled", "email"].includes(otpProvider), "OTP_PROVIDER must be disabled or email (fake is forbidden; Darb sends no SMS, codes go by email)");
  if (otpProvider === "email") add("OTP_PROVIDER_EMAIL", val("EMAIL_DELIVERY") === "smtp", "OTP_PROVIDER=email requires EMAIL_DELIVERY=smtp");
  add("SUPPORTED_PHONE_REGIONS", (val("SUPPORTED_PHONE_REGIONS") || "PS").toUpperCase() === "PS", "SUPPORTED_PHONE_REGIONS must be PS");
  add("GOOGLE_PASSENGER_SIGNUP_MODE", (val("GOOGLE_PASSENGER_SIGNUP_MODE") || "disabled") === "disabled", "Google passenger signup must stay disabled in staging/production (config refuses otherwise)");

  const mapsOn = bool("ROUTE_MAPS_ENABLED");
  const provider = val("ROUTE_PROVIDER") || "disabled";
  add("ROUTE_PROVIDER", provider !== "fake" && (mapsOn || provider === "disabled"), "ROUTE_PROVIDER must be disabled when maps are off, and never fake");
  if (mapsOn) add("ROUTE_PROVIDER_SECRET", val("ROUTE_PROVIDER_SECRET").length >= 8 && !isPlaceholder(val("ROUTE_PROVIDER_SECRET")), "ROUTE_PROVIDER_SECRET required for a live route provider");
  add("ROUTE_PROVIDER_CACHE_TTL_SECONDS", (val("ROUTE_PROVIDER_CACHE_TTL_SECONDS") || "0") === "0", "ROUTE_PROVIDER_CACHE_TTL_SECONDS must be 0");

  checkMapProviders(env, add, results);

  if (bool("DRIVER_DOCUMENTS_ENABLED")) {
    // Document bytes are stored in MySQL. The directory is optional and only read for
    // documents uploaded before that change (npm run documents:import copies them in).
    const dir = val("DRIVER_DOCUMENTS_DIR");
    add("DRIVER_DOCUMENTS_DIR", dir === "" || isAbsolute(dir), "DRIVER_DOCUMENTS_DIR, when set, must be an absolute path");
  } else {
    results.push({ id: "DRIVER_DOCUMENTS", status: "WARN", message: "DRIVER_DOCUMENTS_ENABLED is not true; driver and merchant document uploads will be unavailable" });
  }

  add("PORT", intIn(val("PORT") || "3000", 1, 65535) !== false, "PORT must be a valid port number");

  // Email delivery (SMTP). Without it email sign-up, verification and password reset answer 503.
  const emailDelivery = val("EMAIL_DELIVERY") || "disabled";
  add("EMAIL_DELIVERY", ["disabled", "smtp"].includes(emailDelivery), "EMAIL_DELIVERY must be smtp or disabled");
  if (emailDelivery === "smtp") {
    const host = val("SMTP_HOST");
    add("SMTP_HOST", /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host) && !isPlaceholder(host) && !["localhost", "127.0.0.1"].includes(host.toLowerCase()), "SMTP_HOST must be a real, non-loopback host name when EMAIL_DELIVERY=smtp");
    add("SMTP_PORT", intIn(val("SMTP_PORT"), 1, 65535) !== false, "SMTP_PORT must be 1-65535 when set (default 587, or 465 for tls)");
    add("SMTP_SECURE", ["", "starttls", "tls"].includes(val("SMTP_SECURE")), "SMTP_SECURE must be starttls or tls");
    add("SMTP_USER", val("SMTP_USER") !== "" && !isPlaceholder(val("SMTP_USER")), "SMTP_USER required when EMAIL_DELIVERY=smtp");
    add("SMTP_PASSWORD", val("SMTP_PASSWORD") !== "" && !isPlaceholder(val("SMTP_PASSWORD")), "SMTP_PASSWORD required (not a placeholder) when EMAIL_DELIVERY=smtp");
    const from = val("EMAIL_FROM_ADDRESS");
    add("EMAIL_FROM_ADDRESS", /^[^\s@<>"]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(from) && !isPlaceholder(from), "EMAIL_FROM_ADDRESS must be a real sender address when EMAIL_DELIVERY=smtp");
  } else {
    results.push({ id: "EMAIL_DELIVERY_DISABLED", status: "WARN", message: "EMAIL_DELIVERY is not smtp; email sign-up, verification and password reset will answer 503" });
  }
  return results;
}

function parseArgs(argv) {
  const args = { envFile: undefined, target: "production" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--env-file") args.envFile = argv[++i];
    else if (argv[i] === "--target") args.target = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!["production", "staging"].includes(args.target)) throw new Error("--target must be production or staging");
  return args;
}

export function main(argv, processEnv = process.env, write = (line) => process.stdout.write(`${line}\n`)) {
  const args = parseArgs(argv);
  const env = args.envFile ? parseEnvFile(readFileSync(args.envFile, "utf8")) : processEnv;
  const results = runPreflight(env, { target: args.target });
  for (const r of results) write(`${r.status.padEnd(4)}  ${r.id}  ${r.message}`);
  const failed = results.filter((r) => r.status === "FAIL").length;
  const warned = results.filter((r) => r.status === "WARN").length;
  write(`\n${results.length - failed - warned} passed, ${failed} failed, ${warned} warnings (${args.envFile ? "env file" : "process env"}, target ${args.target})`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`preflight error: ${error.message}\n`);
    process.exitCode = 2;
  }
}
