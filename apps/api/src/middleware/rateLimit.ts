import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { AppConfig } from "../config.js";
import { normalizeEmailForAbuse } from "../lib/contactEmail.js";
import type { AuthenticatedRequest } from "./auth.js";

function safeIpKey(req: Request) {
  return ipKeyGenerator(req.ip ?? "unknown", 56);
}

function loginKey(req: Request, secret: string) {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  // Valid identities share a keyed bucket across IPs and spelling variants.
  // Credential-only actions use an IP bucket, never a raw credential key.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 191) return safeIpKey(req);
  return createHmac("sha256", secret).update(`masari:auth-rate-limit:${normalizeEmailForAbuse(email)}`).digest("hex");
}

function handler(req: Request, res: Response) {
  res.status(429).json({
    error: "rate_limited",
    message: "Too many requests. Try again later.",
    request_id: req.requestId
  });
}

function sharedOptions(windowMs: number, max: number) {
  return {
    windowMs,
    limit: max,
    standardHeaders: "draft-8" as const,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    skip: (req: Request) => req.method === "OPTIONS",
    handler
  };
}

export function createGlobalRateLimiter(appConfig: AppConfig) {
  return rateLimit({
    ...sharedOptions(appConfig.rateLimits.global.windowMs, appConfig.rateLimits.global.max),
    identifier: "masari-global-api",
    keyGenerator: safeIpKey
  });
}

export function createLoginRateLimiter(appConfig: AppConfig) {
  return rateLimit({
    ...sharedOptions(appConfig.rateLimits.login.windowMs, appConfig.rateLimits.login.max),
    identifier: "masari-login",
    skip: (req) => {
      const path = req.originalUrl.split("?")[0].toLowerCase().replace(/\/+$/, "");
      // These routes authenticate first and use an account-bound limiter below.
      return req.method === "OPTIONS" || path === "/api/v1/auth/password/set" || path === "/api/v1/auth/password/set/start";
    },
    keyGenerator: (req) => loginKey(req, appConfig.authActions?.key.secret ?? appConfig.refreshTokenPepper)
  });
}

export function createAuthenticatedAuthRateLimiter(appConfig: AppConfig) {
  return rateLimit({
    ...sharedOptions(appConfig.rateLimits.login.windowMs, appConfig.rateLimits.login.max),
    identifier: "masari-authenticated-credential-action",
    keyGenerator: (req: AuthenticatedRequest) => {
      if (!req.user) return safeIpKey(req);
      return createHmac("sha256", appConfig.authActions?.key.secret ?? appConfig.refreshTokenPepper)
        .update(`masari:authenticated-auth-rate-limit:${req.user.id}`).digest("hex");
    }
  });
}
