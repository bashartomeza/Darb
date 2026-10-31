import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  unread_only: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true")
});

function serialize(row: {
  id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  params: unknown;
  read_at: Date | null;
  created_at: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    params: row.params ?? null,
    read_at: row.read_at,
    created_at: row.created_at
  };
}

export const notificationsRouter = Router();

// Every role has an inbox; ownership is enforced by always filtering on the caller.
notificationsRouter.use("/notifications", requireAuth);

notificationsRouter.get("/notifications", async (req: AuthenticatedRequest, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const userId = req.user!.id;
    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { user_id: userId, ...(query.unread_only ? { read_at: null } : {}) },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: query.limit
      }),
      prisma.notification.count({ where: { user_id: userId, read_at: null } })
    ]);
    res.json({ notifications: rows.map(serialize), unread_count: unreadCount });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/notifications/read-all", async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { user_id: req.user!.id, read_at: null },
      data: { read_at: new Date() }
    });
    res.json({ updated: result.count });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/notifications/:id/read", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = req.params.id;
    if (typeof id !== "string") throw new HttpError(400, "invalid_route_param");
    const userId = req.user!.id;
    // Scoped to the caller: another user's id is indistinguishable from a missing one.
    await prisma.notification.updateMany({ where: { id, user_id: userId, read_at: null }, data: { read_at: new Date() } });
    const row = await prisma.notification.findFirst({ where: { id, user_id: userId } });
    if (!row) throw new HttpError(404, "notification_not_found");
    res.json({ notification: serialize(row) });
  } catch (error) {
    next(error);
  }
});
