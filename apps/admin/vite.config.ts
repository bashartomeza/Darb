import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { createAdminBuildConfig } from "./admin.config";

export default defineConfig(({ mode }) => {
  const environment =
    mode === "test"
      ? {
          VITE_APP_ENV: "test",
          VITE_API_BASE_URL: "http://localhost:3000",
          VITE_ENABLE_DEMO_FEATURES: "false",
          VITE_ROUTE_MANAGEMENT_ENABLED: "false"
        }
      : loadEnv(mode, process.cwd(), "");
  const appConfig = createAdminBuildConfig(environment);

  return {
    plugins: [react()],
    define: {
      __DARB_ADMIN_CONFIG__: JSON.stringify(appConfig),
      __DARB_DEMO_BUILD__: JSON.stringify(appConfig.demoFeaturesEnabled)
    },
    server: {
      port: 5173
    },
    test: {
      environment: "node"
    }
  };
});
