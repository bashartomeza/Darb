export const DEMO_RESET_DATABASE_NOT_ALLOWED = "demo_reset_database_not_allowed";

const allowedResetEnvironments = new Set(["local", "test", "demo"]);
const permanentlyProtectedDatabases = new Set(["darb"]);

export type DemoResetSafetyConfig = {
  appEnv: string;
  databaseUrl: string;
  demoFeaturesEnabled: boolean;
  demoResetAllowedDatabases: readonly string[];
};

export type DemoResetSafety = {
  allowed: boolean;
  reason: "allowed" | "features_disabled" | "environment_not_allowed" | "invalid_database_url" | "protected_database" | "database_not_allowlisted";
};

export class DemoResetDatabaseNotAllowedError extends Error {
  readonly code = DEMO_RESET_DATABASE_NOT_ALLOWED;

  constructor() {
    super(DEMO_RESET_DATABASE_NOT_ALLOWED);
    this.name = "DemoResetDatabaseNotAllowedError";
  }
}

export function databaseNameFromUrl(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "mysql:") return null;
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (!name || name.includes("/") || !/^[A-Za-z0-9_]+$/.test(name)) return null;
    return name;
  } catch {
    return null;
  }
}

export function evaluateDemoResetSafety(config: DemoResetSafetyConfig): DemoResetSafety {
  if (!config.demoFeaturesEnabled) return { allowed: false, reason: "features_disabled" };
  if (!allowedResetEnvironments.has(config.appEnv)) return { allowed: false, reason: "environment_not_allowed" };

  const databaseName = databaseNameFromUrl(config.databaseUrl);
  if (!databaseName) return { allowed: false, reason: "invalid_database_url" };
  if (permanentlyProtectedDatabases.has(databaseName.toLowerCase())) {
    return { allowed: false, reason: "protected_database" };
  }
  if (!config.demoResetAllowedDatabases.includes(databaseName)) {
    return { allowed: false, reason: "database_not_allowlisted" };
  }
  return { allowed: true, reason: "allowed" };
}

export function assertDemoResetDatabaseSafe(config: DemoResetSafetyConfig) {
  if (!evaluateDemoResetSafety(config).allowed) throw new DemoResetDatabaseNotAllowedError();
}
