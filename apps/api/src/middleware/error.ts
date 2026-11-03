import type { ErrorRequestHandler, Request } from "express";
import { ZodError } from "zod";
import { PASSWORD_RULE_ERROR_CODE, isPasswordRuleIssue } from "../lib/passwordRule.js";
import { RouteProviderError } from "../maps/contracts.js";

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

function requestId(req: Request) {
  return req.requestId ?? "unavailable";
}

function errorShape(error: string, req: Request, extra: Record<string, unknown> = {}) {
  return { error, ...extra, request_id: requestId(req) };
}

function errorCode(value: unknown) {
  if (!value || typeof value !== "object" || !("code" in value) || typeof value.code !== "string") return undefined;
  return /^P\d{4}$/.test(value.code) ? value.code : undefined;
}

function errorType(value: unknown) {
  if (value instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value.name)) return value.name;
  return "UnknownError";
}

export const notFoundHandler = ((req, res) => {
  res.status(404).json(errorShape("not_found", req));
}) satisfies import("express").RequestHandler;

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const code = errorCode(error);
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      path: issue.path.map(String),
      code: issue.code,
      message: "Invalid value"
    }));
    // A request whose only problem is the shared password rule gets its own stable code so the apps can show the rule.
    const otherProblems = error.issues.length === 0 || !error.issues.every(isPasswordRuleIssue);
    res.status(400).json(errorShape(otherProblems ? "validation_error" : PASSWORD_RULE_ERROR_CODE, req, { details }));
    return;
  }

  if (error instanceof HttpError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      req.operationalLog?.warn(
        {
          event: error.statusCode === 401 ? "authentication_failed" : "authorization_failed",
          ...(req.user ? { actor_id: req.user.id, actor_role: req.user.role } : {})
        },
        "Access request rejected"
      );
    }
    res.status(error.statusCode).json(errorShape(error.message, req));
    return;
  }
  if (error instanceof RouteProviderError) {
    const status = error.category === "invalid_input" ? 400
      : error.category === "provider_rate_limited" || error.category === "provider_quota_exhausted" ? 429
      : error.category === "provider_timeout" ? 504
      : error.category === "provider_unauthorized" || error.category === "malformed_provider_response" ? 502
      : 503;
    const arabic = req.acceptsLanguages("ar") === "ar";
    const message = arabic
      ? (error.category === "provider_timeout" ? "انتهت مهلة مزود المسار. حاول لاحقاً." : error.category === "invalid_input" ? "بيانات المسار غير صالحة." : "خدمة حساب المسار غير متاحة حالياً.")
      : (error.category === "provider_timeout" ? "The route provider timed out. Try again later." : error.category === "invalid_input" ? "The route input is invalid." : "Route calculation is currently unavailable.");
    res.status(status).json(errorShape(error.category, req, { message }));
    return;
  }

  if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
    res.status(413).json(errorShape("payload_too_large", req, { message: "Request body exceeds the allowed size." }));
    return;
  }

  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json(errorShape("invalid_json", req, { message: "Request body contains invalid JSON." }));
    return;
  }

  if (code === "P2002") {
    res.status(409).json(errorShape("resource_conflict", req));
    return;
  }
  if (code === "P2025") {
    res.status(404).json(errorShape("resource_not_found", req));
    return;
  }
  if (code === "P2034") {
    res.status(409).json(errorShape("transaction_retry_required", req));
    return;
  }

  req.operationalLog?.error(
    {
      event: "unhandled_error",
      error_type: errorType(error),
      ...(code ? { prisma_code: code } : {})
    },
    "Unhandled request error"
  );
  res.status(500).json(
    errorShape("internal_server_error", req, { message: "An unexpected error occurred. Use the request ID for support." })
  );
};
