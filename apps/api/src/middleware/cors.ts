import type { RequestHandler } from "express";
import { config, type AppConfig } from "../config.js";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// Flutter's web dev server picks a random port on every run, so an exact-match
// allowlist cannot cover it outside staging and production.
function isLoopbackOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return (protocol === "http:" || protocol === "https:") && LOOPBACK_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

function browserOriginPolicy(appConfig: AppConfig) {
  const allowedOrigins = new Set(appConfig.corsOrigins);
  const allowAnyLoopbackPort = !appConfig.isStaging && !appConfig.isProduction;
  return (origin: string) => allowedOrigins.has(origin) || (allowAnyLoopbackPort && isLoopbackOrigin(origin));
}

/**
 * The one origin rule shared by CORS and the Admin cookie-session CSRF check:
 * the explicit CORS_ORIGINS allowlist, plus any loopback port outside staging
 * and production. A browser origin outside it can neither read responses nor
 * make cookie-authenticated changes.
 */
export function isAllowedBrowserOrigin(origin: string, appConfig: AppConfig = config) {
  return browserOriginPolicy(appConfig)(origin);
}

export function createCors(appConfig: AppConfig = config): RequestHandler {
  const isAllowed = browserOriginPolicy(appConfig);
  return (req, res, next) => {
    const origin = req.header("origin");
    if (origin && isAllowed(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      // Credentials (the Admin session cookie) are allowed only for these
      // origins; every other origin gets no CORS headers at all.
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.header(
        "Access-Control-Allow-Headers",
        "Content-Type,Authorization,X-Request-Id,Idempotency-Key,x-demo-reset-key,X-Darb-Admin-Session"
      );
      res.header("Access-Control-Expose-Headers", "X-Request-Id,Retry-After");
    }

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  };
}

export const localDevCors = createCors();
