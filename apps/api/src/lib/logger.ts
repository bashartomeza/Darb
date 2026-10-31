import pino, { type DestinationStream, type Logger } from "pino";
import type { AppConfig } from "../config.js";

const AUTH_CREDENTIAL_FIELD_NAMES = [
  "authorization",
  "apikey",
  "apiKey",
  "CHECKPOINTS_API_KEY",
  "SMTP_PASSWORD",
  "smtp_password",
  "AWEENRAYEH_PARTNER_API_KEY",
  "x-api-key",
  "X-Api-Key",
  "cookie",
  "token",
  "raw_action_token",
  "action_token",
  "rawToken",
  "idToken",
  "id_token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "credential",
  "credentials",
  "registration_token",
  "email_verification_token",
  "reauthentication_token",
  "current_password"
] as const;

// Pino/fast-redact supports `*` for one object segment, not an unbounded
// recursive wildcard. Masari supports structured operational log contexts to
// five object levels, so generate every safe path through that depth.
const AUTH_CREDENTIAL_REDACTION_PATHS = AUTH_CREDENTIAL_FIELD_NAMES.flatMap((field) =>
  Array.from({ length: 6 }, (_, depth) => `${Array(depth).fill("*").join(".")}${field.includes("-") ? `["${field}"]` : `${depth ? "." : ""}${field}`}`)
);

const REDACTED_PATHS = [...new Set([
  "authorization",
  "cookie",
  "token",
  "raw_action_token",
  "action_token",
  "rawToken",
  "idToken",
  "refreshToken",
  "auth_action.rawToken",
  "auth_action.idToken",
  "*.rawToken",
  "*.idToken",
  "*.refreshToken",
  "*.*.rawToken",
  "*.*.idToken",
  "*.*.refreshToken",
  "id_token",
  "credential",
  "access_token",
  "refresh_token",
  "token_hash",
  "refresh_token_hash",
  "refresh_token_pepper",
  "code",
  "code_digest",
  "invitation_code",
  "invitation_code_pepper",
  "otp_code",
  "otp_code_pepper",
  "phone_digest",
  "phone_digest_pepper",
  "intended_phone_digest",
  "onboarding_session_pepper",
  "idempotency_key",
  "idempotency_key_pepper",
  "idempotency_payload_pepper",
  "abuse_key_pepper",
  "password",
  "password_hash",
  "registration_grant",
  "registration_grant_digest",
  "database_url",
  "reset_key",
  "phone",
  "email",
  "profile.email",
  "profile.phone",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body",
  "res.body",
  ...AUTH_CREDENTIAL_REDACTION_PATHS
])];

export function createOperationalLogger(appConfig: AppConfig, destination?: DestinationStream): Logger {
  const options = {
    level: appConfig.logLevel,
    base: {
      service: "masari-api",
      app_env: appConfig.appEnv,
      release: appConfig.appRelease
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" }
  } as const;

  return pino(options, destination ?? pino.destination({ sync: false }));
}
