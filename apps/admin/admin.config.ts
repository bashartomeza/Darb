export const ADMIN_APP_ENVIRONMENTS = ["local", "test", "demo", "staging", "production"] as const;
export type AdminAppEnvironment = (typeof ADMIN_APP_ENVIRONMENTS)[number];

export type AdminBuildConfig = {
  appEnv: AdminAppEnvironment;
  apiBaseUrl: string;
  demoFeaturesEnabled: boolean;
  routeManagementEnabled: boolean;
  demo?: {
    adminPhone: string;
    adminPassword: string;
    resetKey: string;
  };
};

export class AdminConfigurationError extends Error {
  constructor(problems: string[]) {
    super(`Invalid Darb admin configuration: ${problems.join("; ")}`);
    this.name = "AdminConfigurationError";
  }
}

function booleanValue(name: string, value: string | undefined) {
  if (value === "true") return true;
  if (value === "false" || value === undefined || value === "") return false;
  throw new AdminConfigurationError([`${name} must be true or false`]);
}

export function createAdminBuildConfig(environment: Record<string, string | undefined>): AdminBuildConfig {
  const appEnv = environment.VITE_APP_ENV;
  const problems: string[] = [];
  if (!ADMIN_APP_ENVIRONMENTS.includes(appEnv as AdminAppEnvironment)) {
    problems.push("VITE_APP_ENV is missing or invalid");
  }

  const demoFeaturesEnabled = booleanValue("VITE_ENABLE_DEMO_FEATURES", environment.VITE_ENABLE_DEMO_FEATURES);
  const routeManagementEnabled = booleanValue(
    "VITE_ROUTE_MANAGEMENT_ENABLED",
    environment.VITE_ROUTE_MANAGEMENT_ENABLED
  );
  const productionLike = appEnv === "staging" || appEnv === "production";
  if (productionLike && demoFeaturesEnabled) {
    problems.push("VITE_ENABLE_DEMO_FEATURES cannot be enabled in staging or production");
  }

  const apiBaseUrl = environment.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
  if (!apiBaseUrl) problems.push("VITE_API_BASE_URL is required");
  if (productionLike && !apiBaseUrl.startsWith("https://")) {
    problems.push("VITE_API_BASE_URL must use HTTPS in staging and production");
  }

  const demo = {
    adminPhone: environment.VITE_DEMO_ADMIN_PHONE ?? "",
    adminPassword: environment.VITE_DEMO_ADMIN_PASSWORD ?? "",
    resetKey: environment.VITE_DEMO_RESET_KEY ?? ""
  };
  if (demoFeaturesEnabled) {
    for (const [name, value] of Object.entries(demo)) {
      if (!value) problems.push(`demo configuration ${name} is required when demo features are enabled`);
    }
  }

  if (problems.length > 0) throw new AdminConfigurationError(problems);
  return {
    appEnv: appEnv as AdminAppEnvironment,
    apiBaseUrl,
    demoFeaturesEnabled,
    routeManagementEnabled,
    demo: demoFeaturesEnabled ? demo : undefined
  };
}
