import { isAbsolute } from "node:path";
import { z } from "zod";

export const APP_ENVIRONMENTS = ["local", "test", "demo", "staging", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
export const ROUTE_PROVIDERS = ["disabled", "fake", "mapbox", "google", "here", "stadia"] as const;
export type RouteProviderId = (typeof ROUTE_PROVIDERS)[number];

const MINIMUM_JWT_SECRET_LENGTH = 32;
const MINIMUM_REFRESH_PEPPER_LENGTH = 32;
const MINIMUM_ONBOARDING_PEPPER_LENGTH = 32;
const MINIMUM_AUTH_ACTION_PEPPER_LENGTH = 32;
const PRODUCTION_ACCESS_TOKEN_MIN_SECONDS = 300;
const PRODUCTION_ACCESS_TOKEN_MAX_SECONDS = 1_800;
const PRODUCTION_REFRESH_TOKEN_MAX_DAYS = 90;
const unsafeSecretMarkers = ["development-jwt-secret", "change-me", "replace-with", "placeholder"];
const unsafeRouteProviderSecretMarkers = ["changeme", "example", "test-key", "test_secret", "test-secret", "your-"];

function isUnsafeSecret(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    unsafeSecretMarkers.some((marker) => normalized.includes(marker)) ||
    (normalized.startsWith("<") && normalized.endsWith(">"))
  );
}

function isUnsafeRouteProviderSecret(value: string) {
  const normalized = value.trim().toLowerCase();
  return isUnsafeSecret(value) || unsafeRouteProviderSecretMarkers.some((marker) => normalized.includes(marker));
}

const optionalXaiApiKey = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(20).optional()
);
const optionalGeminiApiKey = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(20).optional()
);
const optionalGroqApiKey = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(20).optional()
);

const optionalText = (max: number) => z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().max(max).optional()
);

const rawSchema = z.object({
  APP_ENV: z.enum(APP_ENVIRONMENTS),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(MINIMUM_JWT_SECRET_LENGTH),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).optional(),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).optional(),
  REFRESH_TOKEN_PEPPER: z.string().min(MINIMUM_REFRESH_PEPPER_LENGTH).optional(),
  AUTH_ACTION_TOKEN_PEPPER: z.string().min(MINIMUM_AUTH_ACTION_PEPPER_LENGTH).optional(),
  AUTH_ACTION_TOKEN_KEY_VERSION: z.coerce.number().int().positive().default(1),
  CORS_ORIGINS: z.string().optional(),
  APP_RELEASE: z.string().min(1).optional(),
  ENABLE_DEMO_FEATURES: z.string().optional(),
  ROUTE_MANAGEMENT_ENABLED: z.string().optional(),
  MULTI_ROUTE_ENTRY_ENABLED: z.string().optional(),
  MULTI_ROUTE_MATCHING_ENABLED: z.string().optional(),
  CANONICAL_TRIP_CREATION_ENABLED: z.string().optional(),
  CANONICAL_SHARED_TRIPS_ENABLED: z.string().optional(),
  CANONICAL_SHARED_TRIP_MOBILE_ENABLED: z.string().optional(),
  MAPS_ENABLED: z.string().optional(),
  CHECKPOINTS_ENABLED: z.string().optional(),
  AWEENRAYEH_LIMITED_DIRECTORY_ENABLED: z.string().optional(),
  AWEENRAYEH_PARTNER_API_KEY: z.string().trim().min(20).optional(),
  AWEENRAYEH_PARTNER_TIMEOUT_MS: z.coerce.number().int().min(500).max(15_000).default(6_000),
  CHECKPOINT_DIRECTORY_ENABLED: z.string().optional(),
  CHECKPOINT_DIRECTORY_FILE: z.string().min(1).optional(),
  CHECKPOINTS_URL: z.string().url().optional(),
  CHECKPOINTS_API_KEY: z.string().min(20).optional(),
  CHECKPOINTS_TIMEOUT_MS: z.coerce.number().int().min(500).max(15_000).default(6_000),
  CHECKPOINTS_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3_600).default(60),
  ROUTE_MAPS_ENABLED: z.string().optional(),
  ROUTE_PROVIDER: z.enum(ROUTE_PROVIDERS).default("disabled"),
  ROUTE_PROVIDER_SECRET: z.string().trim().min(8).optional(),
  ROUTE_PROVIDER_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1_000),
  ROUTE_PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(250).max(20_000).default(4_000),
  ROUTE_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(1).default(1),
  ROUTE_PROVIDER_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(0),
  ROUTE_PROVIDER_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(900_000),
  ROUTE_PROVIDER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(20),
  DEMO_RESET_KEY: z.string().min(8).optional(),
  DEMO_RESET_ALLOWED_DATABASES: z.string().optional(),
  DEMO_PASSENGER_PASSWORD: z.string().min(12).optional(),
  DEMO_DRIVER_PASSWORD: z.string().min(12).optional(),
  DEMO_MERCHANT_PASSWORD: z.string().min(12).optional(),
  DEMO_ADMIN_PASSWORD: z.string().min(12).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  TRUST_PROXY: z.string().optional(),
  APPROACH_ALERT_RADIUS_KM: z.coerce.number().min(0.05).max(25).default(1),
  APPROACH_ALERT_ETA_MINUTES: z.coerce.number().min(0).max(120).default(0),
  APPROACH_ALERT_ASSUMED_SPEED_KMH: z.coerce.number().min(5).max(120).default(30),
  READINESS_TIMEOUT_MS: z.coerce.number().int().min(10).max(10_000).default(2_000),
  RATE_LIMIT_GLOBAL_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(900_000),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(1).max(10_000).optional(),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(900_000),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).max(500).optional(),
  EMAIL_CODE_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  EMAIL_CODE_MAX_PER_EMAIL_PER_DAY: z.coerce.number().int().min(1).max(100).default(10),
  INVITATIONS_ENABLED: z.string().optional(),
  PUBLIC_ONBOARDING_ENABLED: z.string().optional(),
  OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED: z.string().optional(),
  OPEN_SIGNUP_MAX_STARTS_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(200),
  DRIVER_DOCUMENTS_ENABLED: z.string().optional(),
  DRIVER_DOCUMENTS_DIR: z.string().min(1).optional(),
  DRIVER_DOCUMENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  OTP_PROVIDER: z.enum(["disabled", "fake", "email"]).default("disabled"),
  EMAIL_DELIVERY: z.preprocess((v) => typeof v === "string" && v.trim() === "" ? undefined : v, z.enum(["disabled", "smtp"]).default("disabled")),
  SMTP_HOST: optionalText(255),
  SMTP_PORT: z.preprocess((v) => typeof v === "string" && v.trim() === "" ? undefined : v, z.coerce.number().int().min(1).max(65_535).optional()),
  SMTP_SECURE: z.preprocess((v) => typeof v === "string" && v.trim() === "" ? undefined : v, z.enum(["starttls", "tls"]).default("starttls")),
  SMTP_USER: optionalText(255),
  SMTP_PASSWORD: z.preprocess((v) => typeof v === "string" && v.trim() === "" ? undefined : v, z.string().max(512).optional()),
  EMAIL_FROM_ADDRESS: optionalText(255),
  EMAIL_FROM_NAME: optionalText(100),
  SUPPORTED_PHONE_REGIONS: z.string().default("PS"),
  GOOGLE_OAUTH_CLIENT_IDS: z.string().optional(),
  GOOGLE_MOBILE_SERVER_CLIENT_ID: z.string().trim().min(1).refine((v) => !v.includes(",")).optional(),
  GOOGLE_ADMIN_WEB_CLIENT_ID: z.string().trim().min(1).refine((v) => !v.includes(",")).optional(),
  GOOGLE_PASSENGER_SIGNUP_MODE: z.enum(["disabled", "allowlist", "open"]).default("disabled"),
  GOOGLE_PASSENGER_ALLOWLIST_HMACS: z.string().optional(),
  XAI_API_KEY: optionalXaiApiKey,
  XAI_MODEL: z.string().trim().min(1).max(100).default("grok-4.6"),
  XAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  ASSISTANT_PROVIDER: z.enum(["xai", "gemini", "groq"]).default("groq"),
  GEMINI_API_KEY: optionalGeminiApiKey,
  GEMINI_MODEL: z.string().trim().min(1).max(100).default("gemini-2.5-flash-lite"),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  GROQ_API_KEY: optionalGroqApiKey,
  GROQ_MODEL: z.string().trim().min(1).max(100).default("openai/gpt-oss-20b"),
  GROQ_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  INVITATION_CODE_PEPPER: z.string().min(MINIMUM_ONBOARDING_PEPPER_LENGTH).optional(),
  INVITATION_CODE_KEY_VERSION: z.coerce.number().int().positive().default(1),
  PHONE_DIGEST_PEPPER: z.string().min(MINIMUM_ONBOARDING_PEPPER_LENGTH).optional(),
  PHONE_DIGEST_KEY_VERSION: z.coerce.number().int().positive().default(1),
  OTP_CODE_PEPPER: z.string().min(MINIMUM_ONBOARDING_PEPPER_LENGTH).optional(),
  OTP_CODE_KEY_VERSION: z.coerce.number().int().positive().default(1),
  ONBOARDING_SESSION_PEPPER: z.string().min(MINIMUM_ONBOARDING_PEPPER_LENGTH).optional(),
  ONBOARDING_SESSION_KEY_VERSION: z.coerce.number().int().positive().default(1),
  IDEMPOTENCY_KEY_PEPPER: z.string().min(MINIMUM_ONBOARDING_PEPPER_LENGTH).optional(),
  IDEMPOTENCY_KEY_VERSION: z.coerce.number().int().positive().default(1),
  IDEMPOTENCY_PAYLOAD_PEPPER: z.string().min(MINIMUM_ONBOARDING_PEPPER_LENGTH).optional(),
  IDEMPOTENCY_PAYLOAD_KEY_VERSION: z.coerce.number().int().positive().default(1),
  ABUSE_KEY_PEPPER: z.string().min(MINIMUM_ONBOARDING_PEPPER_LENGTH).optional(),
  ABUSE_KEY_VERSION: z.coerce.number().int().positive().default(1),
  INVITATION_EXPIRY_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(600).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  OTP_MAX_RESENDS: z.coerce.number().int().min(0).max(10).default(3),
  OTP_MAX_SENDS_PER_PHONE_DAY: z.coerce.number().int().min(1).max(20).default(5),
  ADMIN_INVITATION_MAX_PER_HOUR: z.coerce.number().int().min(1).max(500).default(20),
  ONBOARDING_ATTEMPT_TTL_SECONDS: z.coerce.number().int().min(600).max(3_600).default(1_800),
  ONBOARDING_REGISTRATION_GRANT_TTL_SECONDS: z.coerce.number().int().min(300).max(1_800).default(900),
  ONBOARDING_CONTINUATION_TTL_SECONDS: z.coerce.number().int().min(300).max(3_600).default(1_800),
  ONBOARDING_PENDING_STATUS_TTL_DAYS: z.coerce.number().int().min(1).max(7).default(7),
  ONBOARDING_TEST_LEGAL_FIXTURES_ENABLED: z.string().optional()
});

export type AppConfig = ReturnType<typeof createConfig>;

export class ConfigurationError extends Error {
  constructor(problems: string[]) {
    super(`Invalid Masari configuration: ${problems.join("; ")}`);
    this.name = "ConfigurationError";
  }
}

function parseBoolean(name: string, value: string | undefined) {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ConfigurationError([`${name} must be true or false`]);
}

function safeParseEnvironment(environment: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const result = rawSchema.safeParse(environment);
  if (result.success) return result.data;

  const fields = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "configuration")))];
  throw new ConfigurationError(fields.map((field) => `${field} is missing or invalid`));
}

function parseTrustProxy(value: string | undefined, productionLike: boolean, problems: string[]) {
  if (value === undefined || value === "") {
    if (productionLike) problems.push("TRUST_PROXY must be explicit in staging and production");
    return false as const;
  }
  if (value === "none" || value === "0") return false as const;
  if (/^[1-5]$/.test(value)) return Number(value);
  problems.push("TRUST_PROXY must be none, 0, or a trusted proxy hop count from 1 through 5");
  return false as const;
}

export function createConfig(environment: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const raw = safeParseEnvironment(environment);
  const isLocal = raw.APP_ENV === "local";
  const isTest = raw.APP_ENV === "test";
  const isDemo = raw.APP_ENV === "demo";
  const isStaging = raw.APP_ENV === "staging";
  const isProduction = raw.APP_ENV === "production";
  const productionLike = isStaging || isProduction;
  const explicitlyEnabled = parseBoolean("ENABLE_DEMO_FEATURES", raw.ENABLE_DEMO_FEATURES);
  const demoFeaturesEnabled = isDemo || isTest || (isLocal && explicitlyEnabled);
  const routeManagementEnabled = parseBoolean("ROUTE_MANAGEMENT_ENABLED", raw.ROUTE_MANAGEMENT_ENABLED);
  const multiRouteEntryEnabled = parseBoolean("MULTI_ROUTE_ENTRY_ENABLED", raw.MULTI_ROUTE_ENTRY_ENABLED);
  const multiRouteMatchingEnabled = parseBoolean("MULTI_ROUTE_MATCHING_ENABLED", raw.MULTI_ROUTE_MATCHING_ENABLED);
  const canonicalTripCreationEnabled = parseBoolean(
    "CANONICAL_TRIP_CREATION_ENABLED",
    raw.CANONICAL_TRIP_CREATION_ENABLED
  );
  const canonicalSharedTripsEnabled = parseBoolean(
    "CANONICAL_SHARED_TRIPS_ENABLED",
    raw.CANONICAL_SHARED_TRIPS_ENABLED
  );
  const canonicalSharedTripMobileEnabled = parseBoolean(
    "CANONICAL_SHARED_TRIP_MOBILE_ENABLED",
    raw.CANONICAL_SHARED_TRIP_MOBILE_ENABLED
  );
  const mapsEnabled = parseBoolean("MAPS_ENABLED", raw.MAPS_ENABLED);
  const checkpointsEnabled = parseBoolean("CHECKPOINTS_ENABLED", raw.CHECKPOINTS_ENABLED);
  const checkpointDirectoryEnabled = parseBoolean("CHECKPOINT_DIRECTORY_ENABLED", raw.CHECKPOINT_DIRECTORY_ENABLED);
  const routeMapsEnabled = parseBoolean("ROUTE_MAPS_ENABLED", raw.ROUTE_MAPS_ENABLED);
  const invitationsEnabled = parseBoolean("INVITATIONS_ENABLED", raw.INVITATIONS_ENABLED);
  const driverDocumentsEnabled = parseBoolean("DRIVER_DOCUMENTS_ENABLED", raw.DRIVER_DOCUMENTS_ENABLED);
  const publicOnboardingEnabled = parseBoolean("PUBLIC_ONBOARDING_ENABLED", raw.PUBLIC_ONBOARDING_ENABLED);
  const openSignupEnabled = parseBoolean("OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED", raw.OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED);
  const testLegalFixturesEnabled = parseBoolean(
    "ONBOARDING_TEST_LEGAL_FIXTURES_ENABLED",
    raw.ONBOARDING_TEST_LEGAL_FIXTURES_ENABLED
  );
  const limitedCheckpointDirectoryEnabled = parseBoolean("AWEENRAYEH_LIMITED_DIRECTORY_ENABLED", raw.AWEENRAYEH_LIMITED_DIRECTORY_ENABLED);
  const problems: string[] = [];
  if (limitedCheckpointDirectoryEnabled && (!raw.AWEENRAYEH_PARTNER_API_KEY || isUnsafeRouteProviderSecret(raw.AWEENRAYEH_PARTNER_API_KEY))) {
    problems.push("AWEENRAYEH_PARTNER_API_KEY is required and must be securely configured");
  }
  // Demo reset removes abuse counters; it must never reset a real provider budget.
  if (limitedCheckpointDirectoryEnabled && demoFeaturesEnabled) {
    problems.push("Limited provider directory cannot run with demo reset features");
  }
  if (driverDocumentsEnabled && (!raw.DRIVER_DOCUMENTS_DIR || !isAbsolute(raw.DRIVER_DOCUMENTS_DIR))) {
    problems.push("DRIVER_DOCUMENTS_DIR must be an absolute path when driver documents are enabled");
  }
  if (checkpointDirectoryEnabled && !raw.CHECKPOINT_DIRECTORY_FILE) {
    problems.push("CHECKPOINT_DIRECTORY_FILE is required when the directory is enabled");
  }
  const demoResetAllowedDatabases = (raw.DEMO_RESET_ALLOWED_DATABASES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (demoResetAllowedDatabases.some((name) => !/^[A-Za-z0-9_]+$/.test(name))) {
    problems.push("DEMO_RESET_ALLOWED_DATABASES must contain exact comma-separated database names");
  }
  if (new Set(demoResetAllowedDatabases).size !== demoResetAllowedDatabases.length) {
    problems.push("DEMO_RESET_ALLOWED_DATABASES must not contain duplicate database names");
  }

  if (productionLike && explicitlyEnabled) {
    problems.push("ENABLE_DEMO_FEATURES cannot be enabled in staging or production");
  }
  if (multiRouteEntryEnabled && productionLike) {
    problems.push("MULTI_ROUTE_ENTRY_ENABLED is forbidden in staging and production");
  }
  if (multiRouteMatchingEnabled && productionLike) {
    problems.push("MULTI_ROUTE_MATCHING_ENABLED is forbidden in staging and production");
  }
  if (multiRouteMatchingEnabled && !multiRouteEntryEnabled) {
    problems.push("MULTI_ROUTE_MATCHING_ENABLED requires MULTI_ROUTE_ENTRY_ENABLED");
  }
  if (canonicalTripCreationEnabled && productionLike) {
    problems.push("CANONICAL_TRIP_CREATION_ENABLED is forbidden in staging and production");
  }
  if (canonicalTripCreationEnabled && !multiRouteMatchingEnabled) {
    problems.push("CANONICAL_TRIP_CREATION_ENABLED requires MULTI_ROUTE_MATCHING_ENABLED");
  }
  if (canonicalSharedTripsEnabled && productionLike) {
    problems.push("CANONICAL_SHARED_TRIPS_ENABLED is forbidden in staging and production");
  }
  if (
    canonicalSharedTripsEnabled &&
    (!multiRouteEntryEnabled || !multiRouteMatchingEnabled || !canonicalTripCreationEnabled)
  ) {
    problems.push(
      "CANONICAL_SHARED_TRIPS_ENABLED requires MULTI_ROUTE_ENTRY_ENABLED, MULTI_ROUTE_MATCHING_ENABLED, and CANONICAL_TRIP_CREATION_ENABLED"
    );
  }
  if (canonicalSharedTripMobileEnabled && productionLike) {
    problems.push("CANONICAL_SHARED_TRIP_MOBILE_ENABLED is forbidden in staging and production");
  }
  if (
    canonicalSharedTripMobileEnabled &&
    (!multiRouteEntryEnabled ||
      !multiRouteMatchingEnabled ||
      !canonicalTripCreationEnabled ||
      !canonicalSharedTripsEnabled)
  ) {
    problems.push(
      "CANONICAL_SHARED_TRIP_MOBILE_ENABLED requires MULTI_ROUTE_ENTRY_ENABLED, MULTI_ROUTE_MATCHING_ENABLED, CANONICAL_TRIP_CREATION_ENABLED, and CANONICAL_SHARED_TRIPS_ENABLED"
    );
  }
  // Coordinates and geometry only ever reach clients through the canonical
  // catalog, so maps cannot be switched on without it.
  if (mapsEnabled && !routeManagementEnabled) {
    problems.push("MAPS_ENABLED requires ROUTE_MANAGEMENT_ENABLED");
  }
  // Barriers are drawn on the map and have no textual fallback surface.
  if (checkpointsEnabled && !mapsEnabled) {
    problems.push("CHECKPOINTS_ENABLED requires MAPS_ENABLED");
  }
  if (checkpointsEnabled && !raw.CHECKPOINTS_URL) {
    problems.push("CHECKPOINTS_URL is required when checkpoints are enabled");
  }
  if (checkpointsEnabled && !raw.CHECKPOINTS_API_KEY) {
    problems.push("CHECKPOINTS_API_KEY is required when checkpoints are enabled");
  }
  if (raw.CHECKPOINTS_URL && !raw.CHECKPOINTS_URL.startsWith("https://")) {
    problems.push("CHECKPOINTS_URL must use HTTPS");
  }
  if (raw.CHECKPOINTS_API_KEY && isUnsafeSecret(raw.CHECKPOINTS_API_KEY)) {
    problems.push("CHECKPOINTS_API_KEY uses a known placeholder or default value");
  }
  if (publicOnboardingEnabled && productionLike && raw.OTP_PROVIDER !== "email") {
    problems.push("PUBLIC_ONBOARDING_ENABLED in staging or production requires OTP_PROVIDER=email");
  }
  if (raw.OTP_PROVIDER === "email" && raw.EMAIL_DELIVERY !== "smtp") {
    problems.push("OTP_PROVIDER=email requires EMAIL_DELIVERY=smtp (and the SMTP_* settings)");
  }
  if (openSignupEnabled && !publicOnboardingEnabled) {
    problems.push("OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED requires PUBLIC_ONBOARDING_ENABLED");
  }
  if (openSignupEnabled && !driverDocumentsEnabled) {
    problems.push("OPEN_DRIVER_MERCHANT_SIGNUP_ENABLED requires DRIVER_DOCUMENTS_ENABLED so applicants can upload their documents");
  }
  if (publicOnboardingEnabled && !invitationsEnabled) {
    problems.push("PUBLIC_ONBOARDING_ENABLED requires INVITATIONS_ENABLED");
  }
  if (publicOnboardingEnabled && raw.OTP_PROVIDER !== "fake" && raw.OTP_PROVIDER !== "email") {
    problems.push("PUBLIC_ONBOARDING_ENABLED requires OTP_PROVIDER=email (or fake in local, test, or demo)");
  }
  if (productionLike && testLegalFixturesEnabled) {
    problems.push("ONBOARDING_TEST_LEGAL_FIXTURES_ENABLED is forbidden in staging and production");
  }
  if (productionLike && raw.OTP_PROVIDER === "fake") {
    problems.push("OTP_PROVIDER=fake is forbidden in staging and production");
  }
  if (routeMapsEnabled && !routeManagementEnabled) {
    problems.push("ROUTE_MAPS_ENABLED requires ROUTE_MANAGEMENT_ENABLED");
  }
  if (routeMapsEnabled && raw.ROUTE_PROVIDER === "disabled") {
    problems.push("ROUTE_PROVIDER must be selected when ROUTE_MAPS_ENABLED is true");
  }
  if (!routeMapsEnabled && raw.ROUTE_PROVIDER !== "disabled") {
    problems.push("ROUTE_PROVIDER must be disabled when ROUTE_MAPS_ENABLED is false");
  }
  if (productionLike && raw.ROUTE_PROVIDER === "fake") {
    problems.push("ROUTE_PROVIDER=fake is forbidden in staging and production");
  }
  if (routeMapsEnabled && raw.ROUTE_PROVIDER !== "fake" && !raw.ROUTE_PROVIDER_SECRET) {
    problems.push("ROUTE_PROVIDER_SECRET is required for an enabled live route provider");
  }
  if (routeMapsEnabled && raw.ROUTE_PROVIDER_SECRET && isUnsafeRouteProviderSecret(raw.ROUTE_PROVIDER_SECRET)) {
    problems.push("ROUTE_PROVIDER_SECRET uses a known placeholder or default value");
  }
  if (routeMapsEnabled && raw.ROUTE_PROVIDER_SECRET && [raw.JWT_SECRET, raw.REFRESH_TOKEN_PEPPER].includes(raw.ROUTE_PROVIDER_SECRET)) {
    problems.push("ROUTE_PROVIDER_SECRET must be distinct from operational secrets");
  }
  if (raw.XAI_API_KEY && isUnsafeSecret(raw.XAI_API_KEY)) {
    problems.push("XAI_API_KEY uses a known placeholder or default value");
  }
  if (raw.GEMINI_API_KEY && isUnsafeSecret(raw.GEMINI_API_KEY)) {
    problems.push("GEMINI_API_KEY uses a known placeholder or default value");
  }
  if (raw.GROQ_API_KEY && isUnsafeSecret(raw.GROQ_API_KEY)) {
    problems.push("GROQ_API_KEY uses a known placeholder or default value");
  }
  if (productionLike && raw.ROUTE_PROVIDER_CACHE_TTL_SECONDS !== 0) {
    problems.push("ROUTE_PROVIDER_CACHE_TTL_SECONDS must remain 0 until provider cache rights are approved");
  }
  if (raw.ROUTE_PROVIDER_REQUEST_TIMEOUT_MS < raw.ROUTE_PROVIDER_CONNECT_TIMEOUT_MS) {
    problems.push("ROUTE_PROVIDER_REQUEST_TIMEOUT_MS must be at least the connect timeout");
  }

  const supportedRegions = raw.SUPPORTED_PHONE_REGIONS.split(",")
    .map((region) => region.trim().toUpperCase())
    .filter(Boolean);
  if (supportedRegions.length !== 1 || supportedRegions[0] !== "PS") {
    problems.push("SUPPORTED_PHONE_REGIONS must be PS in M6C2B1");
  }

  const googleOAuthClientIds = (raw.GOOGLE_OAUTH_CLIENT_IDS ?? "")
    .split(",")
    .map((clientId) => clientId.trim())
    .filter(Boolean);
  const googleMobileClientIds = raw.GOOGLE_MOBILE_SERVER_CLIENT_ID ? [raw.GOOGLE_MOBILE_SERVER_CLIENT_ID] : [];
  const googleAdminClientIds = raw.GOOGLE_ADMIN_WEB_CLIENT_ID ? [raw.GOOGLE_ADMIN_WEB_CLIENT_ID] : [];
  const googlePassengerAllowlist = (raw.GOOGLE_PASSENGER_ALLOWLIST_HMACS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (googlePassengerAllowlist.some((v) => !/^[a-f0-9]{64}$/.test(v))) problems.push("GOOGLE_PASSENGER_ALLOWLIST_HMACS must contain SHA-256 HMAC digests");
  if ([...googleMobileClientIds, ...googleAdminClientIds].some(isUnsafeSecret)) problems.push("Google endpoint client IDs contain a placeholder value");
  if (googleMobileClientIds.some((id) => googleAdminClientIds.includes(id))) problems.push("Google mobile and admin audiences must be distinct");
  if (raw.GOOGLE_PASSENGER_SIGNUP_MODE !== "disabled" && (!googleMobileClientIds.length || !raw.AUTH_ACTION_TOKEN_PEPPER)) problems.push("Google passenger signup requires mobile audiences and AUTH_ACTION_TOKEN_PEPPER");
  if (raw.GOOGLE_PASSENGER_SIGNUP_MODE === "allowlist" && googlePassengerAllowlist.length === 0) problems.push("Google passenger signup requires nonempty HMAC allowlist");
  // No approved email/SMS adapter is currently wired into the application.
  // A configuration assertion cannot substitute for delivery, published legal
  // releases, and a completed runtime rehearsal. Keep rollout closed until the
  // approved adapters and their startup checks are implemented together.
  if (productionLike && raw.GOOGLE_PASSENGER_SIGNUP_MODE !== "disabled") {
    problems.push("google_signup_prerequisite_missing: approved delivery providers, published legal releases, and runtime rehearsal required");
  }
  if (googleOAuthClientIds.some((clientId) => isUnsafeSecret(clientId))) {
    problems.push("GOOGLE_OAUTH_CLIENT_IDS contains a placeholder value");
  }

  const onboardingSecrets = {
    invitationCode: raw.INVITATION_CODE_PEPPER,
    phoneDigest: raw.PHONE_DIGEST_PEPPER,
    otpCode: raw.OTP_CODE_PEPPER,
    onboardingSession: raw.ONBOARDING_SESSION_PEPPER,
    idempotency: raw.IDEMPOTENCY_KEY_PEPPER,
    abuse: raw.ABUSE_KEY_PEPPER
  };
  if (invitationsEnabled) {
    for (const [name, value] of Object.entries(onboardingSecrets)) {
      if (!value) problems.push(`${name} pepper is required when invitations are enabled`);
      else if (isUnsafeSecret(value)) problems.push(`${name} pepper uses a known placeholder or default value`);
    }
    const configuredSecrets = Object.values(onboardingSecrets).filter((value): value is string => Boolean(value));
    if (new Set(configuredSecrets).size !== configuredSecrets.length) {
      problems.push("onboarding peppers must be distinct from one another");
    }
    const operationalSecrets = [raw.JWT_SECRET, raw.REFRESH_TOKEN_PEPPER].filter(
      (value): value is string => Boolean(value)
    );
    if (configuredSecrets.some((secret) => operationalSecrets.includes(secret))) {
      problems.push("onboarding peppers must be distinct from JWT and refresh-token secrets");
    }
  }
  const idempotencyPayloadSecret = raw.IDEMPOTENCY_PAYLOAD_PEPPER;
  if (publicOnboardingEnabled) {
    if (!idempotencyPayloadSecret) problems.push("idempotency payload pepper is required when public onboarding is enabled");
    else if (isUnsafeSecret(idempotencyPayloadSecret)) problems.push("idempotency payload pepper uses a known placeholder or default value");
    const allSecrets = [
      ...Object.values(onboardingSecrets),
      raw.JWT_SECRET,
      raw.REFRESH_TOKEN_PEPPER
    ].filter((value): value is string => Boolean(value));
    if (idempotencyPayloadSecret && allSecrets.includes(idempotencyPayloadSecret)) {
      problems.push("idempotency payload pepper must be distinct from onboarding and operational secrets");
    }
  }

  if (isUnsafeSecret(raw.JWT_SECRET)) {
    problems.push("JWT_SECRET uses a known placeholder or default value");
  }
  if (raw.REFRESH_TOKEN_PEPPER && isUnsafeSecret(raw.REFRESH_TOKEN_PEPPER)) {
    problems.push("REFRESH_TOKEN_PEPPER uses a known placeholder or default value");
  }
  if (productionLike && !raw.REFRESH_TOKEN_PEPPER) {
    problems.push("REFRESH_TOKEN_PEPPER is required in staging and production");
  }
  if (raw.AUTH_ACTION_TOKEN_PEPPER && isUnsafeSecret(raw.AUTH_ACTION_TOKEN_PEPPER)) {
    problems.push("AUTH_ACTION_TOKEN_PEPPER uses a known placeholder or default value");
  }
  if (raw.AUTH_ACTION_TOKEN_PEPPER && [raw.JWT_SECRET, raw.REFRESH_TOKEN_PEPPER].includes(raw.AUTH_ACTION_TOKEN_PEPPER)) {
    problems.push("AUTH_ACTION_TOKEN_PEPPER must be distinct from JWT and refresh-token secrets");
  }

  // Production email delivery over SMTP. Problems name variables only, never values.
  let email: { delivery: "disabled" | "smtp"; smtp?: { host: string; port: number; secure: "starttls" | "tls"; user?: string; password?: string; fromAddress: string; fromName: string } } = { delivery: raw.EMAIL_DELIVERY };
  if (raw.EMAIL_DELIVERY === "smtp") {
    const missing: string[] = [];
    if (!raw.SMTP_HOST) missing.push("SMTP_HOST");
    if (!raw.EMAIL_FROM_ADDRESS) missing.push("EMAIL_FROM_ADDRESS");
    if (productionLike) {
      if (!raw.SMTP_USER) missing.push("SMTP_USER");
      if (!raw.SMTP_PASSWORD) missing.push("SMTP_PASSWORD");
    } else if (Boolean(raw.SMTP_USER) !== Boolean(raw.SMTP_PASSWORD)) {
      problems.push("SMTP_USER and SMTP_PASSWORD must be set together");
    }
    if (missing.length) problems.push(`EMAIL_DELIVERY=smtp requires ${missing.join(", ")}`);
    if (raw.SMTP_HOST && !/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[[0-9A-Fa-f:.]+\]$/.test(raw.SMTP_HOST)) {
      problems.push("SMTP_HOST must be a bare host name or IP address");
    }
    if (raw.SMTP_HOST && productionLike && ["localhost", "127.0.0.1", "[::1]"].includes(raw.SMTP_HOST.toLowerCase())) {
      problems.push("SMTP_HOST must not be a loopback address in staging and production");
    }
    if (raw.EMAIL_FROM_ADDRESS && !z.string().email().safeParse(raw.EMAIL_FROM_ADDRESS).success) {
      problems.push("EMAIL_FROM_ADDRESS must be a valid email address");
    }
    if (raw.EMAIL_FROM_NAME && /[\u0000-\u001f]/.test(raw.EMAIL_FROM_NAME)) {
      problems.push("EMAIL_FROM_NAME must not contain control characters");
    }
    if (raw.SMTP_USER && /[\u0000-\u001f]/.test(raw.SMTP_USER)) problems.push("SMTP_USER must not contain control characters");
    if (raw.SMTP_PASSWORD && /[\u0000-\u001f]/.test(raw.SMTP_PASSWORD)) problems.push("SMTP_PASSWORD must not contain control characters");
    if (raw.SMTP_PASSWORD && productionLike && isUnsafeSecret(raw.SMTP_PASSWORD)) problems.push("SMTP_PASSWORD uses a known placeholder value");
    if (productionLike && !raw.AUTH_ACTION_TOKEN_PEPPER) problems.push("EMAIL_DELIVERY=smtp requires AUTH_ACTION_TOKEN_PEPPER");
    if (!missing.length) {
      email = { delivery: "smtp", smtp: {
        host: raw.SMTP_HOST!, port: raw.SMTP_PORT ?? (raw.SMTP_SECURE === "tls" ? 465 : 587), secure: raw.SMTP_SECURE,
        user: raw.SMTP_USER, password: raw.SMTP_PASSWORD, fromAddress: raw.EMAIL_FROM_ADDRESS!, fromName: raw.EMAIL_FROM_NAME ?? "Masari"
      } };
    }
  }

  const accessTokenTtlSeconds = raw.ACCESS_TOKEN_TTL_SECONDS ?? (productionLike ? 900 : 28_800);
  const refreshTokenTtlDays = raw.REFRESH_TOKEN_TTL_DAYS ?? 30;
  if (
    productionLike &&
    (accessTokenTtlSeconds < PRODUCTION_ACCESS_TOKEN_MIN_SECONDS ||
      accessTokenTtlSeconds > PRODUCTION_ACCESS_TOKEN_MAX_SECONDS)
  ) {
    problems.push("ACCESS_TOKEN_TTL_SECONDS must be between 300 and 1800 in staging and production");
  }
  if (productionLike && refreshTokenTtlDays > PRODUCTION_REFRESH_TOKEN_MAX_DAYS) {
    problems.push("REFRESH_TOKEN_TTL_DAYS must be between 1 and 90 in staging and production");
  }

  const corsOrigins = (raw.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (productionLike && corsOrigins.length === 0) {
    problems.push("CORS_ORIGINS is required in staging and production");
  }
  if (productionLike && !raw.APP_RELEASE) {
    problems.push("APP_RELEASE is required in staging and production");
  }
  if (productionLike && corsOrigins.includes("*")) {
    problems.push("CORS_ORIGINS cannot contain a wildcard in staging or production");
  }
  if (
    isProduction &&
    corsOrigins.some((origin) => {
      try {
        const hostname = new URL(origin).hostname;
        return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
      } catch {
        return true;
      }
    })
  ) {
    problems.push("CORS_ORIGINS must contain valid non-local origins in production");
  }

  const demoValues = {
    resetKey: raw.DEMO_RESET_KEY,
    passengerPassword: raw.DEMO_PASSENGER_PASSWORD,
    driverPassword: raw.DEMO_DRIVER_PASSWORD,
    merchantPassword: raw.DEMO_MERCHANT_PASSWORD,
    adminPassword: raw.DEMO_ADMIN_PASSWORD
  };
  if (demoFeaturesEnabled) {
    for (const [name, value] of Object.entries(demoValues)) {
      if (!value) problems.push(`demo configuration ${name} is required when demo features are enabled`);
    }
  }

  const trustProxy = parseTrustProxy(raw.TRUST_PROXY, productionLike, problems);
  const globalRateLimitMax = raw.RATE_LIMIT_GLOBAL_MAX ?? (productionLike ? 300 : 5_000);
  const loginRateLimitMax = raw.RATE_LIMIT_LOGIN_MAX ?? (productionLike ? 10 : 500);
  if (productionLike && globalRateLimitMax < 50) {
    problems.push("RATE_LIMIT_GLOBAL_MAX is too low for staging or production");
  }
  if (productionLike && globalRateLimitMax > 1_000) {
    problems.push("RATE_LIMIT_GLOBAL_MAX is too high for staging or production");
  }
  if (productionLike && loginRateLimitMax < 3) {
    problems.push("RATE_LIMIT_LOGIN_MAX is too low for staging or production");
  }
  if (productionLike && loginRateLimitMax > 50) {
    problems.push("RATE_LIMIT_LOGIN_MAX is too high for staging or production");
  }
  if (productionLike && (raw.RATE_LIMIT_GLOBAL_WINDOW_MS < 60_000 || raw.RATE_LIMIT_LOGIN_WINDOW_MS < 60_000)) {
    problems.push("rate-limit windows must be at least 60000ms in staging or production");
  }
  if (productionLike && raw.READINESS_TIMEOUT_MS < 100) {
    problems.push("READINESS_TIMEOUT_MS is too low for staging or production");
  }

  if (problems.length > 0) throw new ConfigurationError(problems);

  return {
    appEnv: raw.APP_ENV,
    databaseUrl: raw.DATABASE_URL,
    jwtSecret: raw.JWT_SECRET,
    accessTokenTtlSeconds,
    refreshTokenTtlDays,
    refreshTokenPepper: raw.REFRESH_TOKEN_PEPPER ?? `masari-non-production:${raw.JWT_SECRET}`,
    authActions: raw.AUTH_ACTION_TOKEN_PEPPER
      ? {
          key: {
            secret: raw.AUTH_ACTION_TOKEN_PEPPER,
            version: raw.AUTH_ACTION_TOKEN_KEY_VERSION
          }
        }
      : undefined,
    email,
    corsOrigins,
    appRelease: raw.APP_RELEASE ?? "unreleased",
    port: raw.PORT,
    isLocal,
    isTest,
    isDemo,
    isStaging,
    isProduction,
    demoFeaturesEnabled,
    demoResetAllowedDatabases,
    routeManagementEnabled,
    multiRouteEntryEnabled,
    multiRouteMatchingEnabled,
    canonicalTripCreationEnabled,
    canonicalSharedTripsEnabled,
    canonicalSharedTripMobileEnabled,
    assistant: {
      provider: raw.ASSISTANT_PROVIDER,
      apiKey: raw.ASSISTANT_PROVIDER === "groq"
        ? raw.GROQ_API_KEY
        : raw.ASSISTANT_PROVIDER === "gemini"
          ? raw.GEMINI_API_KEY
          : raw.XAI_API_KEY,
      model: raw.ASSISTANT_PROVIDER === "groq"
        ? raw.GROQ_MODEL
        : raw.ASSISTANT_PROVIDER === "gemini"
          ? raw.GEMINI_MODEL
          : raw.XAI_MODEL,
      timeoutMs: raw.ASSISTANT_PROVIDER === "groq"
        ? raw.GROQ_TIMEOUT_MS
        : raw.ASSISTANT_PROVIDER === "gemini"
          ? raw.GEMINI_TIMEOUT_MS
          : raw.XAI_TIMEOUT_MS
    },
    mapsEnabled,
    checkpointsEnabled,
    limitedCheckpointDirectoryEnabled,
    limitedCheckpointDirectory: limitedCheckpointDirectoryEnabled ? { apiKey: raw.AWEENRAYEH_PARTNER_API_KEY!, timeoutMs: raw.AWEENRAYEH_PARTNER_TIMEOUT_MS } : undefined,
    checkpointDirectoryEnabled,
    checkpointDirectoryFile: raw.CHECKPOINT_DIRECTORY_FILE,
    checkpoints: checkpointsEnabled
      ? {
          url: raw.CHECKPOINTS_URL!,
          apiKey: raw.CHECKPOINTS_API_KEY!,
          timeoutMs: raw.CHECKPOINTS_TIMEOUT_MS,
          cacheTtlSeconds: raw.CHECKPOINTS_CACHE_TTL_SECONDS
        }
      : undefined,
    routeMaps: {
      enabled: routeMapsEnabled,
      provider: raw.ROUTE_PROVIDER,
      secret: routeMapsEnabled ? raw.ROUTE_PROVIDER_SECRET : undefined,
      connectTimeoutMs: raw.ROUTE_PROVIDER_CONNECT_TIMEOUT_MS,
      requestTimeoutMs: raw.ROUTE_PROVIDER_REQUEST_TIMEOUT_MS,
      maxRetries: raw.ROUTE_PROVIDER_MAX_RETRIES,
      cacheTtlSeconds: raw.ROUTE_PROVIDER_CACHE_TTL_SECONDS,
      rateLimit: {
        windowMs: raw.ROUTE_PROVIDER_RATE_LIMIT_WINDOW_MS,
        max: raw.ROUTE_PROVIDER_RATE_LIMIT_MAX
      }
    },
    invitationsEnabled,
    otpProvider: raw.OTP_PROVIDER,
    publicOnboardingEnabled,
    openSignupEnabled,
    openSignupMaxStartsPerHour: raw.OPEN_SIGNUP_MAX_STARTS_PER_HOUR,
    driverDocuments: driverDocumentsEnabled
      ? { dir: raw.DRIVER_DOCUMENTS_DIR!, retentionDays: raw.DRIVER_DOCUMENT_RETENTION_DAYS }
      : undefined,
    publicRegistration: publicOnboardingEnabled
      ? {
          attemptTtlSeconds: raw.ONBOARDING_ATTEMPT_TTL_SECONDS,
          registrationGrantTtlSeconds: raw.ONBOARDING_REGISTRATION_GRANT_TTL_SECONDS,
          continuationTtlSeconds: raw.ONBOARDING_CONTINUATION_TTL_SECONDS,
          pendingStatusTtlDays: raw.ONBOARDING_PENDING_STATUS_TTL_DAYS,
          testLegalFixturesEnabled,
          idempotencyPayloadKey: {
            secret: idempotencyPayloadSecret!,
            version: raw.IDEMPOTENCY_PAYLOAD_KEY_VERSION
          }
        }
      : undefined,
    onboarding: invitationsEnabled
      ? {
          otpProvider: raw.OTP_PROVIDER,
          supportedRegions: ["PS"] as const,
          invitationExpiryDays: raw.INVITATION_EXPIRY_DAYS,
          otpTtlSeconds: raw.OTP_TTL_SECONDS,
          otpMaxAttempts: raw.OTP_MAX_ATTEMPTS,
          otpResendCooldownSeconds: raw.OTP_RESEND_COOLDOWN_SECONDS,
          otpMaxResends: raw.OTP_MAX_RESENDS,
          otpMaxSendsPerPhoneDay: raw.OTP_MAX_SENDS_PER_PHONE_DAY,
          adminInvitationMaxPerHour: raw.ADMIN_INVITATION_MAX_PER_HOUR,
          keys: {
            invitationCode: { secret: onboardingSecrets.invitationCode!, version: raw.INVITATION_CODE_KEY_VERSION },
            phoneDigest: { secret: onboardingSecrets.phoneDigest!, version: raw.PHONE_DIGEST_KEY_VERSION },
            otpCode: { secret: onboardingSecrets.otpCode!, version: raw.OTP_CODE_KEY_VERSION },
            onboardingSession: {
              secret: onboardingSecrets.onboardingSession!,
              version: raw.ONBOARDING_SESSION_KEY_VERSION
            },
            idempotency: { secret: onboardingSecrets.idempotency!, version: raw.IDEMPOTENCY_KEY_VERSION },
            abuse: { secret: onboardingSecrets.abuse!, version: raw.ABUSE_KEY_VERSION }
          }
        }
      : undefined,
    logLevel: raw.LOG_LEVEL ?? (isTest ? "silent" : "info"),
    googleOAuthClientIds,
    googleAuth: { mobileClientIds: googleMobileClientIds, adminClientIds: googleAdminClientIds, passengerSignupMode: raw.GOOGLE_PASSENGER_SIGNUP_MODE, passengerAllowlist: googlePassengerAllowlist },
    trustProxy,
    approachingAlert: {
      radiusKm: raw.APPROACH_ALERT_RADIUS_KM,
      etaMinutes: raw.APPROACH_ALERT_ETA_MINUTES,
      assumedSpeedKmh: raw.APPROACH_ALERT_ASSUMED_SPEED_KMH
    },
    readinessTimeoutMs: raw.READINESS_TIMEOUT_MS,
    rateLimits: {
      global: { windowMs: raw.RATE_LIMIT_GLOBAL_WINDOW_MS, max: globalRateLimitMax },
      login: { windowMs: raw.RATE_LIMIT_LOGIN_WINDOW_MS, max: loginRateLimitMax }
    },
    emailCodeLimits: { resendCooldownSeconds: raw.EMAIL_CODE_RESEND_COOLDOWN_SECONDS, maxPerDay: raw.EMAIL_CODE_MAX_PER_EMAIL_PER_DAY },
    demo: demoFeaturesEnabled
      ? {
          resetKey: demoValues.resetKey!,
          passengerPassword: demoValues.passengerPassword!,
          driverPassword: demoValues.driverPassword!,
          merchantPassword: demoValues.merchantPassword!,
          adminPassword: demoValues.adminPassword!
        }
      : undefined
  } as const;
}

export const config = createConfig(process.env);
