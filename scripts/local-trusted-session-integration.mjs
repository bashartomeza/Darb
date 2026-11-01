import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import {
  createMysqlDefaults,
  databaseUrlFor,
  loadDatabaseEnvironment
} from "./lib/mysql-tools.mjs";
import { run } from "./lib/process.mjs";

const database = "darb_m6c1a_ci";
const root = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const envPath = resolve(root, process.env.DARB_ENV_FILE ?? "apps/api/.env");
const flags = new Set(process.argv.slice(2));
let defaults;
let databaseCreated = false;

function mysql(args) {
  const result = spawnSync("mysql", [`--defaults-extra-file=${defaults.path}`, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new Error("MySQL integration setup failed; sensitive output was withheld");
  return result.stdout.trim();
}

function expectCount(sql, expected, message) {
  const actual = Number(mysql(["--batch", "--skip-column-names", "--database", database, "-e", sql]));
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

try {
  if (!flags.has("--confirm-disposable")) {
    throw new Error("Use --confirm-disposable for the dedicated darb_m6c1a_ci database");
  }
  const parsedEnvironment = parse(readFileSync(envPath));
  const { url, database: configuredDatabase } = loadDatabaseEnvironment(envPath);
  if (configuredDatabase === database) throw new Error("Integration database must not be the configured development database");
  defaults = createMysqlDefaults(url);
  const tableCount = Number(
    mysql([
      "--batch",
      "--skip-column-names",
      "-e",
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${database}'`
    ]) || "0"
  );
  if (tableCount !== 0) throw new Error("Dedicated integration database is not empty; no changes were made");
  mysql(["--execute", `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`]);
  databaseCreated = true;

  const apiOrigin = "http://127.0.0.1:3101";
  const environment = {
    ...process.env,
    ...parsedEnvironment,
    APP_ENV: "demo",
    ENABLE_DEMO_FEATURES: "true",
    APP_RELEASE: "m6c1a-local-integration",
    DATABASE_URL: databaseUrlFor(url, database),
    DEMO_RESET_ALLOWED_DATABASES: database,
    ACCESS_TOKEN_TTL_SECONDS: "3600",
    REFRESH_TOKEN_TTL_DAYS: "30",
    CORS_ORIGINS: "http://localhost:5173",
    TRUST_PROXY: "none",
    LOG_LEVEL: "silent",
    PORT: "3101",
    API_BASE_URL: apiOrigin,
    DEMO_API_BASE_URL: apiOrigin,
    INVITATIONS_ENABLED: "true",
    PUBLIC_ONBOARDING_ENABLED: "false",
    OTP_PROVIDER: "fake",
    SUPPORTED_PHONE_REGIONS: "PS",
    INVITATION_CODE_PEPPER: "local-integration-invitation-pepper-at-least-thirty-two-characters",
    PHONE_DIGEST_PEPPER: "local-integration-phone-pepper-at-least-thirty-two-characters",
    OTP_CODE_PEPPER: "local-integration-otp-pepper-at-least-thirty-two-characters",
    ONBOARDING_SESSION_PEPPER: "local-integration-session-pepper-at-least-thirty-two-characters",
    IDEMPOTENCY_KEY_PEPPER: "local-integration-idempotency-pepper-at-least-thirty-two-characters",
    ABUSE_KEY_PEPPER: "local-integration-abuse-pepper-at-least-thirty-two-characters"
  };
  for (const command of ["db:migrate", "db:migrate", "db:migrate:status", "build:api", "test:integration:mysql"]) {
    run("npm", ["run", command], { cwd: root, env: environment });
  }
  expectCount(
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('auth_sessions','refresh_tokens') AND table_collation LIKE 'utf8mb4%'",
    2,
    "Trusted-session tables or character set are incorrect"
  );
  expectCount(
    "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND constraint_name IN ('auth_sessions_user_id_fkey','refresh_tokens_session_id_fkey','refresh_tokens_replaced_by_id_fkey') AND delete_rule IN ('CASCADE','SET NULL')",
    3,
    "Trusted-session foreign keys are incorrect"
  );
  expectCount(
    "SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() AND index_name IN ('auth_sessions_user_id_revoked_at_expires_at_idx','auth_sessions_expires_at_idx','refresh_tokens_token_hash_key','refresh_tokens_replaced_by_id_key','refresh_tokens_session_id_revoked_at_expires_at_idx','refresh_tokens_session_id_used_at_revoked_at_idx','refresh_tokens_expires_at_idx')",
    7,
    "Trusted-session indexes are incorrect"
  );
  expectCount(
    "SELECT COUNT(*) FROM users WHERE account_status='active' AND security_version=1",
    5,
    "Reset users did not retain deterministic active account defaults"
  );
  expectCount("SELECT COUNT(*) FROM auth_sessions", 0, "Demo reset left orphan sessions");
  expectCount("SELECT COUNT(*) FROM refresh_tokens", 0, "Demo reset left orphan refresh tokens");
  run("node", ["scripts/production-session-integration.mjs"], {
    cwd: root,
    env: { ...environment, INVITATIONS_ENABLED: "false", OTP_PROVIDER: "disabled" }
  });
  console.log(`Trusted-session integration passed on disposable database ${database}.`);
} catch (error) {
  console.error(`Trusted-session integration failed safely: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  if (flags.has("--cleanup") && databaseCreated && defaults) {
    try {
      mysql(["--execute", `DROP DATABASE \`${database}\``]);
      console.log(`Removed disposable integration database ${database}.`);
    } catch {
      console.error("Disposable integration cleanup failed; manual cleanup is required.");
      process.exitCode = 1;
    }
  }
  defaults?.cleanup();
}
