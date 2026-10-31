import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { notify } from "../services/notifications.js";

export const INCIDENT_CATEGORIES = ["safety", "delay", "parcel_damage", "behavior", "other"] as const;
export const INCIDENT_STATUSES = ["open", "reviewing", "resolved"] as const;
/** Per-reporter cap on unresolved reports, so the queue cannot be flooded. */
export const MAX_OPEN_INCIDENTS_PER_USER = 10;

const cleanText = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""))
    .refine((value) => value.length >= 3 && value.length <= max, "Invalid value");

const createIncidentSchema = z.object({
  category: z.enum(INCIDENT_CATEGORIES),
  description: cleanText(1000),
  trip_id: z.string().min(1).max(191).optional()
});

const adminListSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  category: z.enum(INCIDENT_CATEGORIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

const updateIncidentSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES),
    expected_revision: z.number().int().min(1),
    note: cleanText(1000).optional()
  })
  .refine((value) => value.status !== "open", { message: "invalid_status", path: ["status"] });

/** Forward-only triage: open → reviewing → resolved (or open → resolved). */
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  open: ["reviewing", "resolved"],
  reviewing: ["resolved"],
  resolved: []
};

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_route_param");
  return value;
}

type IncidentRow = {
  id: string;
  trip_id: string | null;
  category: string;
  description: string;
  status: string;
  admin_note: string | null;
  revision: number;
  reviewed_at: Date | null;
  resolved_at: Date | null;
  created_at: Date;
  reporter?: { id: string; name: string; role: string } | null;
};

function serialize(row: IncidentRow, options: { admin: boolean }) {
  return {
    id: row.id,
    trip_id: row.trip_id,
    category: row.category,
    description: row.description,
    status: row.status,
    // The reporter sees the outcome of their report; internal wording stays with Admin.
    admin_note: options.admin ? row.admin_note : null,
    revision: row.revision,
    reviewed_at: row.reviewed_at,
    resolved_at: row.resolved_at,
    created_at: row.created_at,
    ...(options.admin && row.reporter ? { reporter: { id: row.reporter.id, name: row.reporter.name, role: row.reporter.role } } : {})
  };
}

async function assertTripParticipant(tripId: string, userId: string, role: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      driver_route: { select: { driver: { select: { user_id: true } } } },
      passenger_request: { select: { passenger_id: true } },
      merchant_order: { select: { merchant_id: true } }
    }
  });
  const participant =
    (role === "driver" && trip?.driver_route.driver.user_id === userId) ||
    (role === "passenger" && trip?.passenger_request?.passenger_id === userId) ||
    (role === "merchant" && trip?.merchant_order?.merchant_id === userId);
  // Same answer for "no such trip" and "not your trip": ids are not discoverable.
  if (!participant) throw new HttpError(404, "trip_not_found");
}

export const incidentsRouter = Router();

incidentsRouter.use("/incidents", requireAuth, requireRole("passenger", "driver", "merchant"));
incidentsRouter.use("/admin/incidents", requireAuth, requireRole("admin"));

incidentsRouter.post("/incidents", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = createIncidentSchema.parse(req.body);
    const user = req.user!;
    const openCount = await prisma.incident.count({
      where: { reporter_id: user.id, status: { not: "resolved" } }
    });
    if (openCount >= MAX_OPEN_INCIDENTS_PER_USER) throw new HttpError(429, "too_many_open_incidents");
    if (input.trip_id) await assertTripParticipant(input.trip_id, user.id, user.role);

    const created = await prisma.incident.create({
      data: {
        reporter_id: user.id,
        trip_id: input.trip_id,
        category: input.category,
        description: input.description
      }
    });
    res.status(201).json({ incident: serialize(created, { admin: false }) });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.get("/incidents", async (req: AuthenticatedRequest, res, next) => {
  try {
    const rows = await prisma.incident.findMany({
      where: { reporter_id: req.user!.id },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: 50
    });
    res.json({ incidents: rows.map((row) => serialize(row, { admin: false })) });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.get("/admin/incidents", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = adminListSchema.parse(req.query);
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.category ? { category: input.category } : {})
    };
    const [rows, total, open] = await Promise.all([
      prisma.incident.findMany({
        where,
        include: { reporter: { select: { id: true, name: true, role: true } } },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit
      }),
      prisma.incident.count({ where }),
      prisma.incident.count({ where: { status: { not: "resolved" } } })
    ]);
    res.json({
      incidents: rows.map((row) => serialize(row, { admin: true })),
      page: input.page,
      limit: input.limit,
      total,
      open_total: open
    });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.patch("/admin/incidents/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = routeParam(req.params.id);
    const input = updateIncidentSchema.parse(req.body);
    const adminId = req.user!.id;

    const current = await prisma.incident.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "incident_not_found");
    if (current.revision !== input.expected_revision) throw new HttpError(409, "incident_state_conflict");
    if (!ALLOWED_TRANSITIONS[current.status]?.includes(input.status)) {
      throw new HttpError(409, "invalid_incident_transition");
    }

    const now = new Date();
    const changed = await prisma.incident.updateMany({
      where: { id, revision: current.revision, status: current.status },
      data: {
        status: input.status,
        admin_note: input.note ?? current.admin_note,
        reviewed_by_id: adminId,
        reviewed_at: now,
        resolved_at: input.status === "resolved" ? now : null,
        revision: { increment: 1 }
      }
    });
    if (changed.count !== 1) throw new HttpError(409, "incident_state_conflict");

    const updated = await prisma.incident.findUniqueOrThrow({
      where: { id },
      include: { reporter: { select: { id: true, name: true, role: true } } }
    });
    await auditEvent(prisma, {
      userId: adminId,
      action: AuditAction.admin_action,
      entityType: "Incident",
      entityId: id,
      metadata: {
        action: "incident_status_changed",
        previous_status: current.status,
        new_status: input.status,
        request_id: req.requestId
      }
    });
    await notify(prisma, {
      userId: updated.reporter_id,
      type: "incident_updated",
      entityType: "Incident",
      entityId: id,
      dedupeKey: `incident_updated:${id}:${updated.revision}`,
      params: { status: input.status }
    });
    res.json({ incident: serialize(updated, { admin: true }) });
  } catch (error) {
    next(error);
  }
});
