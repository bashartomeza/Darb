import type { CookieOptions, Request, Response } from "express";
import { config, type AppConfig } from "../config.js";
import { isAllowedBrowserOrigin } from "./cors.js";
import { HttpError } from "./error.js";

/**
 * The Admin console sends `X-Darb-Admin-Session: 1` on every request. It asks
 * the Admin sign-in endpoints for a cookie session, and it is the first half of
 * the CSRF defence: a cross-site form, link or image cannot set a custom
 * header, and a cross-origin fetch that sets one needs a CORS preflight that
 * only the configured origins pass. CORS lists the same header by name.
 */
export const ADMIN_SESSION_HEADER = "x-darb-admin-session";
/** The cookie is only ever sent to the API, never to the console's own pages. */
export const ADMIN_SESSION_COOKIE_PATH = "/api/v1";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function adminSessionCookieName(appConfig: AppConfig = config) {
  // Browsers accept a `__Secure-` cookie only when it is set Secure over HTTPS,
  // so a plain-http page on the same host cannot plant or overwrite it.
  return appConfig.adminSession.cookieSecure ? "__Secure-darb_admin_session" : "darb_admin_session";
}

function cookieOptions(appConfig: AppConfig): CookieOptions {
  // SameSite=Strict: the console and the API share one site (one origin in
  // production), so the browser never needs to attach this cookie to a
  // request started by another site.
  return { httpOnly: true, secure: appConfig.adminSession.cookieSecure, sameSite: "strict", path: ADMIN_SESSION_COOKIE_PATH };
}

export function setAdminSessionCookie(res: Response, value: string, appConfig: AppConfig = config) {
  res.cookie(adminSessionCookieName(appConfig), value, {
    ...cookieOptions(appConfig),
    maxAge: appConfig.adminSession.absoluteTimeoutSeconds * 1_000
  });
}

export function clearAdminSessionCookie(res: Response, appConfig: AppConfig = config) {
  res.clearCookie(adminSessionCookieName(appConfig), cookieOptions(appConfig));
}

export function readAdminSessionCookie(req: Request, appConfig: AppConfig = config): string | undefined {
  const header = req.header("cookie");
  if (!header) return undefined;
  const name = adminSessionCookieName(appConfig);
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || undefined;
  }
  return undefined;
}

export function requestsAdminCookieSession(req: Request) {
  return req.header(ADMIN_SESSION_HEADER) === "1";
}

/**
 * Sliding expiry: every authenticated request moves the end of an Admin
 * cookie session to one idle timeout from now, but never past the absolute
 * timeout counted from sign-in.
 */
export function adminSessionExpiresAt(createdAt: Date, now: Date, appConfig: AppConfig = config) {
  const idleEnd = now.getTime() + appConfig.adminSession.idleTimeoutSeconds * 1_000;
  return new Date(Math.min(idleEnd, adminSessionAbsoluteEnd(createdAt, appConfig).getTime()));
}

export function adminSessionAbsoluteEnd(createdAt: Date, appConfig: AppConfig = config) {
  return new Date(createdAt.getTime() + appConfig.adminSession.absoluteTimeoutSeconds * 1_000);
}

function requestOrigin(req: Request) {
  const origin = req.header("origin");
  if (origin) return origin;
  const referer = req.header("referer");
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

/**
 * CSRF defence for requests that authenticate with the Admin session cookie
 * (and for the cookie sign-in itself): the custom header must be present, and
 * a state-changing request must come from an allowed browser origin, read from
 * `Origin` or, failing that, `Referer`. A request with neither is refused.
 */
export function assertAdminSessionRequest(req: Request, appConfig: AppConfig = config) {
  if (!requestsAdminCookieSession(req)) throw new HttpError(403, "csrf_rejected");
  if (SAFE_METHODS.has(req.method)) return;
  const origin = requestOrigin(req);
  if (!origin || origin === "null" || !isAllowedBrowserOrigin(origin, appConfig)) {
    throw new HttpError(403, "csrf_rejected");
  }
}
