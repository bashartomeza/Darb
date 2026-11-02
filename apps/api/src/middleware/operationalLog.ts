import type { Request, RequestHandler } from "express";
import type { Logger } from "pino";

const SAFE_PATH_SEGMENTS = new Set([
  "api",
  "v1",
  "health",
  "live",
  "ready",
  "auth",
  "login",
  "refresh",
  "sessions",
  "logout",
  "logout-all",
  "me",
  "demo",
  "reset",
  "passenger",
  "requests",
  "active",
  "cancel",
  "driver",
  "routes",
  "deactivate",
  "merchant",
  "orders",
  "batch",
  "matches",
  "run",
  "accept",
  "reject",
  "trips",
  "status",
  "location",
  "simulate",
  "step",
  "compare",
  "runs",
  "admin",
  "users",
  "status",
  "dashboard",
  "drivers",
  "parcels",
  "onboarding",
  "config",
  "consents",
  "attempts",
  "resend",
  "verify",
  "complete",
  "status-sessions",
  "canonical-match-offers",
  "route-requests",
  "route-orders",
  "preview",
  "geocode",
  "stops",
  "route-versions"
]);

function normalizedRoute(req: Request) {
  const pathname = new URL(req.originalUrl, "http://darb.invalid").pathname;
  return pathname
    .split("/")
    .map((segment) => (segment === "" || SAFE_PATH_SEGMENTS.has(segment) ? segment : ":id"))
    .join("/");
}

export function operationalLogMiddleware(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    req.operationalLog = logger.child({ request_id: req.requestId });

    res.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      req.operationalLog.info(
        {
          event: "http_request_completed",
          method: req.method,
          path: normalizedRoute(req),
          status_code: res.statusCode,
          duration_ms: Number(durationMs.toFixed(2)),
          ...(req.user ? { actor_id: req.user.id, actor_role: req.user.role } : {})
        },
        "HTTP request completed"
      );
    });

    next();
  };
}
