import { describe, expect, it } from "vitest";
import { AdminConfigurationError, createAdminBuildConfig, demoUiEnabled, routeManagementUiEnabled } from "./config";
import { translations } from "./i18n/translations";

describe("admin build isolation", () => {
  it("enables demo UI only for an explicit demo build", () => {
    const config = createAdminBuildConfig({
      VITE_APP_ENV: "demo",
      VITE_API_BASE_URL: "http://localhost:3000",
      VITE_ENABLE_DEMO_FEATURES: "true",
      VITE_DEMO_ADMIN_PHONE: "+970590000005",
      VITE_DEMO_ADMIN_PASSWORD: "admin-test-secret",
      VITE_DEMO_RESET_KEY: "test-reset-key"
    });
    expect(demoUiEnabled(config, true)).toBe(true);
    expect(demoUiEnabled(config, false)).toBe(false);
  });

  it("keeps staging and production free of demo configuration", () => {
    for (const appEnv of ["staging", "production"]) {
      const config = createAdminBuildConfig({
        VITE_APP_ENV: appEnv,
        VITE_API_BASE_URL: "https://api.darb.example",
        VITE_ENABLE_DEMO_FEATURES: "false"
      });
      expect(config.demoFeaturesEnabled).toBe(false);
      expect(config.demo).toBeUndefined();
      expect(demoUiEnabled(config, true)).toBe(false);
    }
  });

  it("strips demo controls from non-demo bundles", () => {
    for (const locale of [translations.ar, translations.en]) {
      expect(locale.demoControl).toBe("");
      expect(locale.runFullDemo).toBe("");
      expect(locale.resetKey).toBe("");
      expect(locale.resetDemo).toBe("");
    }
  });

  it("rejects missing or insecure production API URLs", () => {
    expect(() =>
      createAdminBuildConfig({ VITE_APP_ENV: "production", VITE_ENABLE_DEMO_FEATURES: "false" })
    ).toThrow(AdminConfigurationError);
    expect(() =>
      createAdminBuildConfig({
        VITE_APP_ENV: "production",
        VITE_API_BASE_URL: "http://api.darb.example",
        VITE_ENABLE_DEMO_FEATURES: "false"
      })
    ).toThrow(/HTTPS/);
  });

  it("rejects demo features in staging and production", () => {
    expect(() =>
      createAdminBuildConfig({
        VITE_APP_ENV: "staging",
        VITE_API_BASE_URL: "https://staging-api.darb.example",
        VITE_ENABLE_DEMO_FEATURES: "true"
      })
    ).toThrow(/cannot be enabled/);
  });

  it("keeps route management navigation explicitly feature-gated", () => {
    const disabled = createAdminBuildConfig({
      VITE_APP_ENV: "production",
      VITE_API_BASE_URL: "https://api.darb.example",
      VITE_ROUTE_MANAGEMENT_ENABLED: "false"
    });
    const enabled = createAdminBuildConfig({
      VITE_APP_ENV: "production",
      VITE_API_BASE_URL: "https://api.darb.example",
      VITE_ROUTE_MANAGEMENT_ENABLED: "true"
    });
    expect(routeManagementUiEnabled(disabled)).toBe(false);
    expect(routeManagementUiEnabled(enabled)).toBe(true);
    expect(() => createAdminBuildConfig({
      VITE_APP_ENV: "local",
      VITE_API_BASE_URL: "http://localhost:3000",
      VITE_ROUTE_MANAGEMENT_ENABLED: "yes"
    })).toThrow(/true or false/);
  });
});
