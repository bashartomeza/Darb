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

export function createCors(appConfig: AppConfig = config): RequestHandler {
  const allowedOrigins = new Set(appConfig.corsOrigins);
  const allowAnyLoopbackPort = !appConfig.isStaging && !appConfig.isProduction;
  return (req, res, next) => {
    const origin = req.header("origin");
    if (origin && (allowedOrigins.has(origin) || (allowAnyLoopbackPort && isLoopbackOrigin(origin)))) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
      res.header(
        "Access-Control-Allow-Headers",
        "Content-Type,Authorization,X-Request-Id,Idempotency-Key,x-demo-reset-key"
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
