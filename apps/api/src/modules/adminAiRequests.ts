import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { purgeExpiredUncertainRequests } from "../services/uncertainAiRequests.js";

const listSchema = z.object({
  status: z.enum(["open", "resolved"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

const resolveSchema = z.object({
  expected_revision: z.number().int().min(1),
  note: z
    .string()
    .transform((value) => value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""))
    .refine((value) => value.length <= 500, "Invalid value")
    .optional()
});

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

type Row = {
  id: string;
  locale: string;
  text: string;
  intent_type: string;
  confidence: { toString(): string } | number;
  source: string;
  reason: string;
  pickup_key: string | null;
  dropoff_key: string | null;
  status: string;
  resolution_note: string | null;
  resolved_at: Date | null;
  revision: number;
  created_at: Date;
  expires_at: Date;
};

function serialize(row: Row) {
  return {
    id: row.id,
    locale: row.locale,
    text: row.text,
    intent_type: row.intent_type,
    confidence: Number(row.confidence.toString()),
    source: row.source,
    reason: row.reason,
    pickup_key: row.pickup_key,
    dropoff_key: row.dropoff_key,
    status: row.status,
    resolution_note: row.resolution_note,
    resolved_at: row.resolved_at,
    revision: row.revision,
    created_at: row.created_at,
    expires_at: row.expires_at
  };
}

export const adminAiRequestsRouter = Router();

adminAiRequestsRouter.use("/admin/ai-uncertain-requests", requireAuth, requireRole("admin"));

adminAiRequestsRouter.get("/admin/ai-uncertain-requests", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = listSchema.parse(req.query);
    // Retention is enforced here too, so an idle assistant cannot keep old text around.
    await purgeExpiredUncertainRequests().catch(() => undefined);
    const where = input.status ? { status: input.status } : {};
    const [rows, total, open] = await Promise.all([
      prisma.uncertainAiRequest.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit
      }),
      prisma.uncertainAiRequest.count({ where }),
      prisma.uncertainAiRequest.count({ where: { status: "open" } })
    ]);
    res.json({
      requests: rows.map(serialize),
      page: input.page,
      limit: input.limit,
      total,
      open_total: open
    });
  } catch (error) {
    next(error);
  }
});

adminAiRequestsRouter.patch("/admin/ai-uncertain-requests/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = routeParam(req.params.id);
    const input = resolveSchema.parse(req.body);
    const adminId = req.user!.id;

    const current = await prisma.uncertainAiRequest.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "uncertain_request_not_found");
    if (current.status === "resolved") throw new HttpError(409, "uncertain_request_already_resolved");
    if (current.revision !== input.expected_revision) throw new HttpError(409, "uncertain_request_state_conflict");

    const changed = await prisma.uncertainAiRequest.updateMany({
      where: { id, revision: current.revision, status: "open" },
      data: {
        status: "resolved",
        resolution_note: input.note || null,
        resolved_by_id: adminId,
        resolved_at: new Date(),
        revision: { increment: 1 }
      }
    });
    if (changed.count !== 1) throw new HttpError(409, "uncertain_request_state_conflict");

    const updated = await prisma.uncertainAiRequest.findUniqueOrThrow({ where: { id } });
    await auditEvent(prisma, {
      userId: adminId,
      action: AuditAction.admin_action,
      entityType: "UncertainAiRequest",
      entityId: id,
      metadata: { action: "uncertain_ai_request_resolved", request_id: req.requestId }
    });
    res.json({ request: serialize(updated) });
  } catch (error) {
    next(error);
  }
});
