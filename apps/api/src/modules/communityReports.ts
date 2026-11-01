import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { assertTripParticipant } from "./incidents.js";

export const COMMUNITY_REPORT_CATEGORIES = [
  "road_closure",
  "road_reopened",
  "road_congestion",
  "checkpoint_open_marked_closed",
  "checkpoint_closed_marked_open",
  "checkpoint_outdated",
  "safety_alert",
  "driver_report",
  "incorrect_map_info",
  "other"
] as const;
/** Categories an Admin must verify; the community never decides them. */
export const ADMIN_VERIFIED_CATEGORIES: readonly string[] = [
  "incorrect_map_info",
  "checkpoint_open_marked_closed",
  "checkpoint_closed_marked_open",
  "checkpoint_outdated"
];
export const MAX_REPORTS_PER_USER_PER_HOUR = 10;
/** Distinct user flags after which a report is queued for Admin review. */
export const FLAGS_BEFORE_ADMIN_REVIEW = 3;
const LIST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""))
    .refine((value) => value.length >= min && value.length <= max, "Invalid value");

const createSchema = z
  .object({
    category: z.enum(COMMUNITY_REPORT_CATEGORIES),
    description: cleanText(3, 500),
    location_name: cleanText(2, 120),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    trip_id: z.string().min(1).max(191).optional()
  })
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: "coordinates_incomplete",
    path: ["latitude"]
  });

const listSchema = z.object({
  category: z.enum(COMMUNITY_REPORT_CATEGORIES).optional(),
  sort: z.enum(["recent", "top", "disputed"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const voteSchema = z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) });

const adminListSchema = z.object({
  pending: z.enum(["true", "false"]).default("true"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

const adminActionSchema = z.object({ action: z.enum(["reviewed", "hide", "restore"]) });

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.length === 0 || value.length > 191) throw new HttpError(400, "invalid_route_param");
  return value;
}

type ReportRow = {
  id: string;
  author_id: string;
  trip_id: string | null;
  category: string;
  description: string;
  location_name: string;
  latitude: { toString(): string } | number | null;
  longitude: { toString(): string } | number | null;
  needs_admin_review: boolean;
  admin_reviewed_at: Date | null;
  hidden_at: Date | null;
  created_at: Date;
};

type Tally = { up: number; down: number; mine: number };

function serialize(row: ReportRow, tally: Tally | undefined, viewerId: string, admin = false) {
  const t = tally ?? { up: 0, down: 0, mine: 0 };
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    location_name: row.location_name,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    created_at: row.created_at,
    upvotes: t.up,
    downvotes: t.down,
    my_vote: t.mine,
    is_mine: row.author_id === viewerId,
    // Unverified community input: the map and checkpoint status are never changed by it.
    awaiting_admin_review: row.needs_admin_review && row.admin_reviewed_at === null,
    // The author, trip and driver stay private; only that a trip is linked is shown.
    has_trip: row.trip_id !== null,
    ...(admin ? { author_id: row.author_id, trip_id: row.trip_id, hidden_at: row.hidden_at } : {})
  };
}

async function tallies(ids: string[], viewerId: string) {
  const map = new Map<string, Tally>();
  if (ids.length === 0) return map;
  const [groups, mine] = await Promise.all([
    prisma.communityReportVote.groupBy({
      by: ["report_id", "value"],
      where: { report_id: { in: ids } },
      _count: { _all: true }
    }),
    prisma.communityReportVote.findMany({
      where: { report_id: { in: ids }, user_id: viewerId },
      select: { report_id: true, value: true }
    })
  ]);
  const get = (id: string) => {
    let t = map.get(id);
    if (!t) map.set(id, (t = { up: 0, down: 0, mine: 0 }));
    return t;
  };
  for (const g of groups) {
    const t = get(g.report_id);
    if (g.value > 0) t.up += g._count._all;
    else t.down += g._count._all;
  }
  for (const m of mine) get(m.report_id).mine = m.value;
  return map;
}

export const communityReportsRouter = Router();

communityReportsRouter.use("/community-reports", requireAuth, requireRole("passenger", "driver"));
communityReportsRouter.use("/admin/community-reports", requireAuth, requireRole("admin"));

communityReportsRouter.post("/community-reports", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const user = req.user!;
    const recent = await prisma.communityReport.count({
      where: { author_id: user.id, created_at: { gte: new Date(Date.now() - 60 * 60 * 1000) } }
    });
    if (recent >= MAX_REPORTS_PER_USER_PER_HOUR) throw new HttpError(429, "too_many_reports");
    if (input.trip_id) await assertTripParticipant(input.trip_id, user.id, user.role);

    const created = await prisma.communityReport.create({
      data: {
        author_id: user.id,
        trip_id: input.trip_id,
        category: input.category,
        description: input.description,
        location_name: input.location_name,
        latitude: input.latitude,
        longitude: input.longitude,
        needs_admin_review: ADMIN_VERIFIED_CATEGORIES.includes(input.category)
      }
    });
    res.status(201).json({ report: serialize(created, undefined, user.id) });
  } catch (error) {
    next(error);
  }
});

communityReportsRouter.get("/community-reports", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = listSchema.parse(req.query);
    const viewerId = req.user!.id;
    const rows = await prisma.communityReport.findMany({
      where: {
        hidden_at: null,
        created_at: { gte: new Date(Date.now() - LIST_WINDOW_MS) },
        ...(input.category ? { category: input.category } : {})
      },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: input.limit
    });
    const counts = await tallies(
      rows.map((row) => row.id),
      viewerId
    );
    const items = rows.map((row) => serialize(row, counts.get(row.id), viewerId));
    const score = (r: { upvotes: number; downvotes: number }) => r.upvotes - r.downvotes;
    if (input.sort === "top") items.sort((a, b) => score(b) - score(a));
    if (input.sort === "disputed") items.sort((a, b) => score(a) - score(b));
    res.json({ reports: items });
  } catch (error) {
    next(error);
  }
});

communityReportsRouter.put("/community-reports/:id/vote", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = routeParam(req.params.id);
    const { value } = voteSchema.parse(req.body);
    const user = req.user!;
    const report = await prisma.communityReport.findUnique({ where: { id } });
    if (!report || report.hidden_at) throw new HttpError(404, "report_not_found");
    if (report.author_id === user.id) throw new HttpError(403, "cannot_vote_own_report");

    if (value === 0) {
      await prisma.communityReportVote.deleteMany({ where: { report_id: id, user_id: user.id } });
    } else {
      // The unique (report_id, user_id) key makes this one changeable vote per user.
      await prisma.communityReportVote.upsert({
        where: { report_id_user_id: { report_id: id, user_id: user.id } },
        create: { report_id: id, user_id: user.id, value },
        update: { value }
      });
    }
    const counts = await tallies([id], user.id);
    res.json({ report: serialize(report, counts.get(id), user.id) });
  } catch (error) {
    next(error);
  }
});

communityReportsRouter.post("/community-reports/:id/flag", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = routeParam(req.params.id);
    const user = req.user!;
    const report = await prisma.communityReport.findUnique({ where: { id } });
    if (!report || report.hidden_at) throw new HttpError(404, "report_not_found");
    if (report.author_id === user.id) throw new HttpError(403, "cannot_flag_own_report");
    await prisma.communityReportFlag.upsert({
      where: { report_id_user_id: { report_id: id, user_id: user.id } },
      create: { report_id: id, user_id: user.id },
      update: {}
    });
    const flags = await prisma.communityReportFlag.count({ where: { report_id: id } });
    // Flags only queue a report for a human; nothing is removed automatically.
    if (flags >= FLAGS_BEFORE_ADMIN_REVIEW && !report.needs_admin_review) {
      await prisma.communityReport.update({
        where: { id },
        data: { needs_admin_review: true, admin_reviewed_at: null }
      });
    }
    res.json({ flagged: true });
  } catch (error) {
    next(error);
  }
});

communityReportsRouter.get("/admin/community-reports", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = adminListSchema.parse(req.query);
    const where = input.pending === "true" ? { needs_admin_review: true, admin_reviewed_at: null } : {};
    const [rows, total] = await Promise.all([
      prisma.communityReport.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit
      }),
      prisma.communityReport.count({ where })
    ]);
    const viewerId = req.user!.id;
    const counts = await tallies(
      rows.map((row) => row.id),
      viewerId
    );
    res.json({
      reports: rows.map((row) => serialize(row, counts.get(row.id), viewerId, true)),
      page: input.page,
      limit: input.limit,
      total
    });
  } catch (error) {
    next(error);
  }
});

communityReportsRouter.patch("/admin/community-reports/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const id = routeParam(req.params.id);
    const { action } = adminActionSchema.parse(req.body);
    const adminId = req.user!.id;
    const current = await prisma.communityReport.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "report_not_found");
    const now = new Date();
    const updated = await prisma.communityReport.update({
      where: { id },
      data:
        action === "reviewed"
          ? { admin_reviewed_at: now }
          : action === "hide"
            ? { admin_reviewed_at: now, hidden_at: now }
            : { hidden_at: null }
    });
    await auditEvent(prisma, {
      userId: adminId,
      action: AuditAction.admin_action,
      entityType: "CommunityReport",
      entityId: id,
      metadata: { action: `community_report_${action}`, request_id: req.requestId }
    });
    res.json({ report: serialize(updated, undefined, adminId, true) });
  } catch (error) {
    next(error);
  }
});
