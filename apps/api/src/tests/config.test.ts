import { describe, expect, it } from "vitest";
import { ConfigurationError, createConfig } from "../config.js";

const safeJwt = "a-safe-jwt-secret-with-more-than-thirty-two-characters";
const safeRefreshPepper = "a-safe-refresh-pepper-with-more-than-thirty-two-characters";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    APP_ENV: "production",
    DATABASE_URL: "mysql://database-user:database-password@db.internal:3306/masari",
    JWT_SECRET: safeJwt,
    REFRESH_TOKEN_PEPPER: safeRefreshPepper,
    CORS_ORIGINS: "https://admin.masari.example",
    APP_RELEASE: "m6b1a-test",
    TRUST_PROXY: "none",
    ...overrides
  };
}

describe("fail-closed application configuration", () => {
  it.each(["staging", "production"])("blocks %s Google signup until approved delivery providers are integrated", (appEnv) => {
    expect(() => createConfig(environment({ APP_ENV: appEnv, GOOGLE_PASSENGER_SIGNUP_MODE: "open",
      GOOGLE_MOBILE_SERVER_CLIENT_ID: "mobile-client", AUTH_ACTION_TOKEN_PEPPER: "separate-auth-action-secret-with-over-thirty-two-characters" })))
      .toThrow(/google_signup_prerequisite_missing/);
  });
  it("requires a nonempty allowlist before enabling allowlist signup", () => {
    expect(() => createConfig(environment({ APP_ENV: "local", GOOGLE_PASSENGER_SIGNUP_MODE: "allowlist",
      GOOGLE_MOBILE_SERVER_CLIENT_ID: "mobile-client", AUTH_ACTION_TOKEN_PEPPER: "separate-auth-action-secret-with-over-thirty-two-characters" })))
      .toThrow(/requires nonempty HMAC allowlist/);
  });
  it("defaults Google signup disabled and separates mobile/admin audiences", () => {
    expect(createConfig(environment()).googleAuth.passengerSignupMode).toBe("disabled");
    expect(() => createConfig(environment({ GOOGLE_MOBILE_SERVER_CLIENT_ID: "same-client", GOOGLE_ADMIN_WEB_CLIENT_ID: "same-client" }))).toThrow(/audiences must be distinct/);
    expect(() => createConfig(environment({ GOOGLE_PASSENGER_SIGNUP_MODE: "open" }))).toThrow(/requires mobile audiences/);
    expect(() => createConfig(environment({ GOOGLE_PASSENGER_ALLOWLIST_HMACS: "email@example.com" }))).toThrow(/HMAC digests/);
  });
  it("keeps xAI optional but validates configured credentials", () => {
    expect(createConfig(environment()).assistant).toEqual({
      provider: "groq",
      apiKey: undefined,
      model: "openai/gpt-oss-20b",
      timeoutMs: 15_000
    });
    expect(createConfig(environment({ XAI_API_KEY: "" })).assistant.apiKey).toBeUndefined();
    expect(() => createConfig(environment({ XAI_API_KEY: "replace-with-xai-api-key-value" }))).toThrow(
      /XAI_API_KEY uses a known placeholder/
    );
    expect(() => createConfig(environment({ GEMINI_API_KEY: "replace-with-gemini-api-key" }))).toThrow(
      /GEMINI_API_KEY uses a known placeholder/
    );
    expect(() => createConfig(environment({ GROQ_API_KEY: "replace-with-groq-api-key" }))).toThrow(
      /GROQ_API_KEY uses a known placeholder/
    );
  });

  it("rejects staging without DATABASE_URL", () => {
    expect(() => createConfig(environment({ APP_ENV: "staging", DATABASE_URL: undefined }))).toThrow(ConfigurationError);
  });

  it("rejects production without JWT_SECRET", () => {
    expect(() => createConfig(environment({ JWT_SECRET: undefined }))).toThrow(ConfigurationError);
  });

  it("rejects a placeholder JWT secret", () => {
    expect(() => createConfig(environment({ JWT_SECRET: "replace-with-a-long-random-secret-value" }))).toThrow(
      /known placeholder/
    );
  });

  it("rejects wildcard CORS in production", () => {
    expect(() => createConfig(environment({ CORS_ORIGINS: "*" }))).toThrow(/wildcard/);
  });

  it("rejects localhost CORS in production", () => {
    expect(() => createConfig(environment({ CORS_ORIGINS: "http://localhost:5173" }))).toThrow(/non-local/);
  });

  it("rejects demo features in staging and production", () => {
    expect(() => createConfig(environment({ ENABLE_DEMO_FEATURES: "true" }))).toThrow(/cannot be enabled/);
    expect(() => createConfig(environment({ APP_ENV: "staging", ENABLE_DEMO_FEATURES: "true" }))).toThrow(
      /cannot be enabled/
    );
  });

  it("keeps route management independent and canonical matching gates fail-closed", () => {
    expect(createConfig(environment())).toEqual(
      expect.objectContaining({
        routeManagementEnabled: false,
        multiRouteEntryEnabled: false,
        multiRouteMatchingEnabled: false,
        canonicalTripCreationEnabled: false
      })
    );
    expect(createConfig(environment({ ROUTE_MANAGEMENT_ENABLED: "true" })).routeManagementEnabled).toBe(true);
    expect(createConfig(environment({ APP_ENV: "local", MULTI_ROUTE_ENTRY_ENABLED: "true" })).multiRouteEntryEnabled).toBe(true);
    expect(() => createConfig(environment({ MULTI_ROUTE_ENTRY_ENABLED: "true" }))).toThrow(/forbidden in staging and production/);
    expect(() => createConfig(environment({ APP_ENV: "staging", MULTI_ROUTE_ENTRY_ENABLED: "true" }))).toThrow(/forbidden/);
    expect(() => createConfig(environment({ APP_ENV: "local", MULTI_ROUTE_MATCHING_ENABLED: "true" }))).toThrow(/requires MULTI_ROUTE_ENTRY_ENABLED/);
    expect(() => createConfig(environment({ MULTI_ROUTE_MATCHING_ENABLED: "true" }))).toThrow(/forbidden in staging and production/);
    const localMatching = createConfig(environment({
      APP_ENV: "local",
      MULTI_ROUTE_ENTRY_ENABLED: "true",
      MULTI_ROUTE_MATCHING_ENABLED: "true",
      CANONICAL_TRIP_CREATION_ENABLED: "true"
    }));
    expect(localMatching).toEqual(expect.objectContaining({
      multiRouteEntryEnabled: true,
      multiRouteMatchingEnabled: true,
      canonicalTripCreationEnabled: true
    }));
    expect(() => createConfig(environment({
      APP_ENV: "local",
      MULTI_ROUTE_ENTRY_ENABLED: "true",
      CANONICAL_TRIP_CREATION_ENABLED: "true"
    }))).toThrow(/requires MULTI_ROUTE_MATCHING_ENABLED/);
    expect(() => createConfig(environment({
      MULTI_ROUTE_ENTRY_ENABLED: "true",
      MULTI_ROUTE_MATCHING_ENABLED: "true",
      CANONICAL_TRIP_CREATION_ENABLED: "true"
    }))).toThrow(/forbidden in staging and production/);
    expect(() => createConfig(environment({ ROUTE_MANAGEMENT_ENABLED: "yes" }))).toThrow(/true or false/);
  });

  it("keeps route providers disabled by default and validates explicit provider selection", () => {
    expect(createConfig(environment()).routeMaps).toEqual(expect.objectContaining({ enabled: false, provider: "disabled", secret: undefined }));
    expect(() => createConfig(environment({ ROUTE_MAPS_ENABLED: "true", ROUTE_PROVIDER: "mapbox", ROUTE_PROVIDER_SECRET: "server-secret" }))).toThrow(/requires ROUTE_MANAGEMENT_ENABLED/);
    expect(() => createConfig(environment({ ROUTE_MANAGEMENT_ENABLED: "true", ROUTE_MAPS_ENABLED: "true", ROUTE_PROVIDER: "mapbox" }))).toThrow(/ROUTE_PROVIDER_SECRET/);
    expect(() => createConfig(environment({ ROUTE_PROVIDER: "mapbox" }))).toThrow(/must be disabled/);
    expect(() => createConfig(environment({ ROUTE_MANAGEMENT_ENABLED: "true", ROUTE_MAPS_ENABLED: "true", ROUTE_PROVIDER: "fake" }))).toThrow(/forbidden/);
    const local = createConfig(environment({ APP_ENV: "local", ROUTE_MANAGEMENT_ENABLED: "true", ROUTE_MAPS_ENABLED: "true", ROUTE_PROVIDER: "fake" }));
    expect(local.routeMaps).toEqual(expect.objectContaining({ enabled: true, provider: "fake", secret: undefined }));
  });

  it("rejects unknown, malformed, and inconsistent route-provider configuration without echoing secrets", () => {
    expect(() => createConfig(environment({ ROUTE_PROVIDER: "unknown" }))).toThrow(/ROUTE_PROVIDER/);
    expect(() => createConfig(environment({ ROUTE_MAPS_ENABLED: "yes" }))).toThrow(/true or false/);
    expect(() => createConfig(environment({ ROUTE_PROVIDER_REQUEST_TIMEOUT_MS: "999", ROUTE_PROVIDER_CONNECT_TIMEOUT_MS: "1000" }))).toThrow(/at least the connect timeout/);
    expect(() => createConfig(environment({ APP_ENV: "local", ROUTE_MANAGEMENT_ENABLED: "true", ROUTE_MAPS_ENABLED: "true", ROUTE_PROVIDER: "mapbox", ROUTE_PROVIDER_SECRET: "replace-with-provider-secret" }))).toThrow(/known placeholder/);
    expect(() => createConfig(environment({ APP_ENV: "local", ROUTE_MANAGEMENT_ENABLED: "true", ROUTE_MAPS_ENABLED: "true", ROUTE_PROVIDER: "mapbox", ROUTE_PROVIDER_SECRET: "        " }))).toThrow(/ROUTE_PROVIDER_SECRET/);
    expect(() => createConfig(environment({ APP_ENV: "local", ROUTE_MANAGEMENT_ENABLED: "true", ROUTE_MAPS_ENABLED: "true", ROUTE_PROVIDER: "mapbox", ROUTE_PROVIDER_SECRET: "changeme-provider-key" }))).toThrow(/known placeholder/);
    expect(() => createConfig(environment({ ROUTE_PROVIDER_MAX_RETRIES: "2" }))).toThrow(/ROUTE_PROVIDER_MAX_RETRIES/);
    expect(() => createConfig(environment({ ROUTE_PROVIDER_CACHE_TTL_SECONDS: "1" }))).toThrow(/cache rights are approved/);
    const secret = "provider-secret-that-must-not-leak";
    expect(() => createConfig(environment({ ROUTE_MANAGEMENT_ENABLED: "true", ROUTE_MAPS_ENABLED: "true", ROUTE_PROVIDER: "mapbox", ROUTE_PROVIDER_SECRET: secret, ROUTE_PROVIDER_REQUEST_TIMEOUT_MS: "500", ROUTE_PROVIDER_CONNECT_TIMEOUT_MS: "1000" }))).toThrowError(expect.not.objectContaining({ message: expect.stringContaining(secret) }));
  });

  it("accepts only exact lowercase M7C1 gate booleans", () => {
    for (const value of ["TRUE", "1", " true", "true ", "malformed"]) {
      expect(() => createConfig(environment({ APP_ENV: "local", MULTI_ROUTE_ENTRY_ENABLED: value }))).toThrow(
        /MULTI_ROUTE_ENTRY_ENABLED must be true or false/
      );
      expect(() => createConfig(environment({ APP_ENV: "local", MULTI_ROUTE_MATCHING_ENABLED: value }))).toThrow(
        /MULTI_ROUTE_MATCHING_ENABLED must be true or false/
      );
      expect(() => createConfig(environment({ APP_ENV: "local", CANONICAL_TRIP_CREATION_ENABLED: value }))).toThrow(
        /CANONICAL_TRIP_CREATION_ENABLED must be true or false/
      );
    }
  });

  it("requires an explicit safe trust-proxy topology in production-like environments", () => {
    expect(() => createConfig(environment({ TRUST_PROXY: undefined }))).toThrow(/TRUST_PROXY must be explicit/);
    expect(() => createConfig(environment({ TRUST_PROXY: "true" }))).toThrow(/trusted proxy hop count/);
    expect(createConfig(environment({ TRUST_PROXY: "none" })).trustProxy).toBe(false);
    expect(createConfig(environment({ TRUST_PROXY: "1" })).trustProxy).toBe(1);
  });

  it("rejects operational settings that would make production unsafe", () => {
    expect(() => createConfig(environment({ RATE_LIMIT_GLOBAL_MAX: "1" }))).toThrow(/too low/);
    expect(() => createConfig(environment({ RATE_LIMIT_LOGIN_MAX: "1" }))).toThrow(/too low/);
    expect(() => createConfig(environment({ RATE_LIMIT_GLOBAL_MAX: "1001" }))).toThrow(/too high/);
    expect(() => createConfig(environment({ RATE_LIMIT_LOGIN_MAX: "51" }))).toThrow(/too high/);
    expect(() => createConfig(environment({ RATE_LIMIT_LOGIN_WINDOW_MS: "1000" }))).toThrow(/at least 60000ms/);
    expect(() => createConfig(environment({ READINESS_TIMEOUT_MS: "10" }))).toThrow(/too low/);
  });

  it("enforces production access and refresh lifetime boundaries", () => {
    expect(() => createConfig(environment({ ACCESS_TOKEN_TTL_SECONDS: "299" }))).toThrow(/between 300 and 1800/);
    expect(() => createConfig(environment({ ACCESS_TOKEN_TTL_SECONDS: "1801" }))).toThrow(/between 300 and 1800/);
    expect(() => createConfig(environment({ REFRESH_TOKEN_TTL_DAYS: "91" }))).toThrow(/between 1 and 90/);
    expect(createConfig(environment({ ACCESS_TOKEN_TTL_SECONDS: "300", REFRESH_TOKEN_TTL_DAYS: "90" }))).toEqual(
      expect.objectContaining({ accessTokenTtlSeconds: 300, refreshTokenTtlDays: 90 })
    );
  });

  it("requires a non-placeholder refresh-token pepper in production-like environments", () => {
    expect(() => createConfig(environment({ REFRESH_TOKEN_PEPPER: undefined }))).toThrow(/REFRESH_TOKEN_PEPPER is required/);
    expect(() => createConfig(environment({ REFRESH_TOKEN_PEPPER: "replace-with-a-long-random-refresh-pepper" }))).toThrow(
      /known placeholder/
    );
  });

  it("rejects the exact documented template placeholders for both production secrets", () => {
    expect(() => createConfig(environment({ JWT_SECRET: "<at-least-32-random-characters>" }))).toThrow(/JWT_SECRET/);
    expect(() =>
      createConfig(environment({ REFRESH_TOKEN_PEPPER: "<at-least-32-random-characters-separate-from-jwt>" }))
    ).toThrow(/REFRESH_TOKEN_PEPPER uses a known placeholder/);
  });

  it("never includes submitted secret values in validation errors", () => {
    const secret = "sensitive-value-that-must-never-appear";
    try {
      createConfig(environment({ JWT_SECRET: secret, CORS_ORIGINS: "http://localhost:5173" }));
      throw new Error("expected configuration to fail");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain("database-password");
    }
  });

  it("requires every demo-only credential when demo features are enabled", () => {
    expect(() =>
      createConfig(
        environment({
          APP_ENV: "demo",
          CORS_ORIGINS: "http://localhost:5173",
          APP_RELEASE: undefined
        })
      )
    ).toThrow(/demo configuration/);

    const parsed = createConfig({
      ...environment({ APP_ENV: "demo", CORS_ORIGINS: "http://localhost:5173", APP_RELEASE: undefined }),
      DEMO_RESET_KEY: "test-reset-key",
      DEMO_PASSENGER_PASSWORD: "passenger-test-secret",
      DEMO_DRIVER_PASSWORD: "driver-test-secret",
      DEMO_MERCHANT_PASSWORD: "merchant-test-secret",
      DEMO_ADMIN_PASSWORD: "admin-test-secret"
    });
    expect(parsed.demoFeaturesEnabled).toBe(true);
  });

  it("parses only exact reset database allow-list entries", () => {
    const parsed = createConfig({
      ...process.env,
      APP_ENV: "demo",
      ENABLE_DEMO_FEATURES: "true",
      DEMO_RESET_ALLOWED_DATABASES: "masari_demo,masari_demo_ci"
    });
    expect(parsed.demoResetAllowedDatabases).toEqual(["masari_demo", "masari_demo_ci"]);
    expect(() => createConfig({
      ...process.env,
      APP_ENV: "demo",
      ENABLE_DEMO_FEATURES: "true",
      DEMO_RESET_ALLOWED_DATABASES: "masari_*_ci"
    })).toThrow(/exact comma-separated database names/);
    expect(() => createConfig({
      ...process.env,
      APP_ENV: "demo",
      ENABLE_DEMO_FEATURES: "true",
      DEMO_RESET_ALLOWED_DATABASES: "masari_demo,masari_demo"
    })).toThrow(/must not contain duplicate/);
  });
});

describe("SMTP email delivery configuration", () => {
  const pepper = "separate-auth-action-secret-with-over-thirty-two-characters";
  const smtp = {
    EMAIL_DELIVERY: "smtp", SMTP_HOST: "smtp.mail.example", SMTP_PORT: "587", SMTP_SECURE: "starttls",
    SMTP_USER: "mailer", SMTP_PASSWORD: "a-real-smtp-password", EMAIL_FROM_ADDRESS: "no-reply@masari.example",
    EMAIL_FROM_NAME: "Masari", AUTH_ACTION_TOKEN_PEPPER: pepper
  };

  it("defaults to disabled with no smtp settings", () => {
    expect(createConfig(environment()).email).toEqual({ delivery: "disabled" });
    expect(createConfig(environment({ EMAIL_DELIVERY: "" })).email.delivery).toBe("disabled");
  });
  it.each(["staging", "production"])("accepts a complete smtp configuration in %s", (appEnv) => {
    const config = createConfig(environment({ APP_ENV: appEnv, ...smtp }));
    expect(config.email.smtp).toEqual({ host: "smtp.mail.example", port: 587, secure: "starttls", user: "mailer",
      password: "a-real-smtp-password", fromAddress: "no-reply@masari.example", fromName: "Masari" });
  });
  it("defaults the port from the secure mode and the sender name", () => {
    const tlsConfig = createConfig(environment({ ...smtp, SMTP_PORT: "", SMTP_SECURE: "tls", EMAIL_FROM_NAME: "" }));
    expect(tlsConfig.email.smtp).toMatchObject({ port: 465, secure: "tls", fromName: "Masari" });
    expect(createConfig(environment({ ...smtp, SMTP_PORT: "" })).email.smtp?.port).toBe(587);
  });
  it.each(["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM_ADDRESS", "AUTH_ACTION_TOKEN_PEPPER"])("requires %s together with the rest in production", (name) => {
    expect(() => createConfig(environment({ ...smtp, [name]: undefined }))).toThrow(new RegExp(name));
  });
  it("rejects invalid values and never echoes secrets in the error", () => {
    expect(() => createConfig(environment({ ...smtp, SMTP_SECURE: "plain" }))).toThrow();
    expect(() => createConfig(environment({ ...smtp, SMTP_PORT: "70000" }))).toThrow();
    expect(() => createConfig(environment({ ...smtp, EMAIL_FROM_ADDRESS: "not-an-address" }))).toThrow(/EMAIL_FROM_ADDRESS/);
    expect(() => createConfig(environment({ ...smtp, SMTP_HOST: "smtp://host" }))).toThrow(/SMTP_HOST/);
    expect(() => createConfig(environment({ ...smtp, SMTP_HOST: "localhost" }))).toThrow(/loopback/);
    expect(() => createConfig(environment({ ...smtp, EMAIL_FROM_NAME: "Masari\r\nBcc: x@y.example" }))).toThrow(/EMAIL_FROM_NAME/);
    try { createConfig(environment({ ...smtp, SMTP_PASSWORD: "<replace-with-smtp-password>" })); expect.unreachable(); }
    catch (error) { expect(error).toBeInstanceOf(ConfigurationError); expect(String((error as Error).message)).not.toContain("replace-with-smtp-password"); expect(String((error as Error).message)).toMatch(/SMTP_PASSWORD/); }
  });
  it("ignores smtp settings when delivery is disabled and allows credential-less relays outside production", () => {
    expect(createConfig(environment({ ...smtp, EMAIL_DELIVERY: "disabled", SMTP_PASSWORD: undefined })).email).toEqual({ delivery: "disabled" });
    const local = createConfig(environment({ APP_ENV: "local", EMAIL_DELIVERY: "smtp", SMTP_HOST: "localhost", EMAIL_FROM_ADDRESS: "dev@masari.example" }));
    expect(local.email.smtp).toMatchObject({ host: "localhost", user: undefined, password: undefined });
    expect(() => createConfig(environment({ APP_ENV: "local", EMAIL_DELIVERY: "smtp", SMTP_HOST: "localhost", EMAIL_FROM_ADDRESS: "dev@masari.example", SMTP_USER: "u" }))).toThrow(/together/);
  });
});
