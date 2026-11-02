import type { AdminBuildConfig } from "../admin.config";

export { AdminConfigurationError, createAdminBuildConfig } from "../admin.config";
export type { AdminBuildConfig } from "../admin.config";

export function getAdminBuildConfig(): AdminBuildConfig {
  return __DARB_ADMIN_CONFIG__;
}

export function demoUiEnabled(config: AdminBuildConfig, demoBuild: boolean) {
  return demoBuild && config.demoFeaturesEnabled;
}

export function routeManagementUiEnabled(config: AdminBuildConfig) {
  return config.routeManagementEnabled;
}
