import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { revokeAllUserSessions } from "../lib/refreshTokens.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { AccountStatus, AuditAction, DriverVerificationStatus } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import { notifyDriverVerification } from "../services/notifications.js";
import {
  EXPIRY_COLUMN,
  EXPIRY_KINDS,
  daysUntilExpiry,
  expiryDatesOf,
  isExpired,
  isoDate,
  utcMidnight,
  type ExpiryKind
} from "../services/driverDocumentExpiry.js";

export const adminRouter = Router();

const safeUserSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  role: true,
  account_status: true,
  status_reason: true,
  status_updated_at: true,
  last_login_at: true,
  demo_account: true,
  review_submitted_at: true,
  created_at: true
} as const;

const userDirectoryListSelect = {
  ...safeUserSelect,
  driver_profile: { select: { id: true, verified: true } },
  driver_verification: { select: { status: true } }
} as const;

type UserDirectoryListRecord = Prisma.UserGetPayload<{ select: typeof userDirectoryListSelect }>;

const userDirectoryDetailSelect = {
  ...safeUserSelect,
  driver_profile: {
    select: {
      id: true,
      vehicle_type: true,
      seats_total: true,
      parcel_capacity: true,
      verified: true,
      trust_score: true
    }
  },
  driver_verification: {
    select: {
      id: true,
      status: true,
      revision: true,
      submitted_at: true,
      reviewed_at: true,
      reviewed_by: { select: { id: true, name: true } }
    }
  }
} as const;

type UserDirectoryDetailRecord = Prisma.UserGetPayload<{ select: typeof userDirectoryDetailSelect }>;

function serializeSafeUser(user: {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  account_status: string;
  status_reason: string | null;
  status_updated_at: Date;
  last_login_at: Date | null;
  demo_account: boolean;
  created_at: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    account_status: user.account_status,
    status_reason: user.status_reason,
    status_updated_at: user.status_updated_at,
    last_login_at: user.last_login_at,
    demo_account: user.demo_account,
    created_at: user.created_at
  };
}

function serializeUserDirectoryListRecord(user: UserDirectoryListRecord) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    account_status: user.account_status,
    status_reason: user.status_reason,
    status_updated_at: user.status_updated_at,
    last_login_at: user.last_login_at,
    demo_account: user.demo_account,
    created_at: user.created_at,
    role_context: createUserRoleContext(user)
  };
}

function createUserRoleContext(
  user: { role: string; review_submitted_at?: Date | null; driver_profile: { verified: boolean } | null; driver_verification: { status: string } | null }
) {
  if (user.role === "driver") {
    return {
      kind: "driver",
      driver_profile_exists: Boolean(user.driver_profile),
      driver_profile_verified: user.driver_profile?.verified ?? false,
      driver_verification_status: user.driver_verification?.status ?? "none",
      application_submitted: user.review_submitted_at !== null
    };
  }
  if (user.role === "merchant") {
    return { kind: "merchant", merchant_approval_connected: true, application_submitted: user.review_submitted_at !== null };
  }
  if (user.role === "admin") return { kind: "admin" };
  return { kind: "passenger" };
}

function serializeUserDirectoryDetailRecord(user: UserDirectoryDetailRecord) {
  const roleContext = createUserRoleContext(user);
  return {
    ...serializeSafeUser(user),
    role_context: roleContext,
    driver_profile: user.driver_profile
      ? {
          id: user.driver_profile.id,
          vehicle_type: user.driver_profile.vehicle_type,
          seats_total: user.driver_profile.seats_total,
          parcel_capacity: user.driver_profile.parcel_capacity,
          verified: user.driver_profile.verified,
          trust_score: user.driver_profile.trust_score
        }
        : null,
    driver_verification: user.driver_verification
      ? {
          id: user.driver_verification.id,
          status: user.driver_verification.status,
          revision: user.driver_verification.revision,
          submitted_at: user.driver_verification.submitted_at,
          reviewed_at: user.driver_verification.reviewed_at,
          reviewer: user.driver_verification.reviewed_by
        }
      : null
  };
}

const adminUserListQuerySchema = z.object({
  role: z.enum(["passenger", "driver", "merchant", "admin"]).optional(),
  account_status: z
    .enum([AccountStatus.active, AccountStatus.pending, AccountStatus.suspended, AccountStatus.disabled])
    .optional(),
  demo_account: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  search: z.string().trim().max(64).default(""),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const driverVerificationInclude = {
  user: { select: { ...safeUserSelect, driver_profile: true } },
  reviewed_by: { select: { id: true, name: true } },
  decisions: {
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: 20,
    include: { decided_by: { select: { id: true, name: true } } }
  },
  evidence: {
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: 50,
    include: { recorded_by: { select: { id: true, name: true } } }
  },
  documents: {
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    take: 20,
    select: { id: true, revision: true, kind: true, mime_type: true, size_bytes: true, created_at: true }
  }
} satisfies Prisma.DriverVerificationInclude;

type DriverVerificationRecord = Prisma.DriverVerificationGetPayload<{
  include: typeof driverVerificationInclude;
}>;

/** One entry per tracked document: its last valid day and the days left (negative once expired). */
function serializeExpiry(verification: Partial<Parameters<typeof expiryDatesOf>[0]>, now = new Date()) {
  const dates = expiryDatesOf({
    licence_expires_at: verification.licence_expires_at ?? null,
    vehicle_registration_expires_at: verification.vehicle_registration_expires_at ?? null,
    insurance_expires_at: verification.insurance_expires_at ?? null,
    contract_ends_at: verification.contract_ends_at ?? null
  });
  const out: Record<string, { expires_on: string; days_left: number } | null> = {};
  for (const kind of EXPIRY_KINDS) {
    const date = dates[kind];
    out[kind] = date ? { expires_on: isoDate(date), days_left: daysUntilExpiry(date, now) } : null;
  }
  return out;
}

const expiryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), "Invalid date");

/** A date sets the expiry, null clears it, an omitted field is left as it is. */
const expiryInputSchema = z
  .object({
    licence: expiryDateSchema.nullable(),
    vehicle_registration: expiryDateSchema.nullable(),
    insurance: expiryDateSchema.nullable(),
    contract: expiryDateSchema.nullable()
  })
  .partial();

type ExpiryInput = z.infer<typeof expiryInputSchema>;

/** Merges the Admin's input over what is stored; every resulting date must still be valid today or later. */
function resolveExpiry(
  stored: Parameters<typeof expiryDatesOf>[0],
  input: ExpiryInput | undefined,
  now: Date
): Record<(typeof EXPIRY_COLUMN)[ExpiryKind], Date | null> {
  const merged = expiryDatesOf(stored);
  for (const kind of EXPIRY_KINDS) {
    if (input && input[kind] !== undefined) merged[kind] = input[kind]!;
  }
  const columns = {} as Record<(typeof EXPIRY_COLUMN)[ExpiryKind], Date | null>;
  for (const kind of EXPIRY_KINDS) {
    const value = merged[kind];
    if (value && isExpired(value, now)) throw new HttpError(400, "expiry_date_in_past");
    columns[EXPIRY_COLUMN[kind]] = value;
  }
  return columns;
}

function serializeDriverVerification(verification: DriverVerificationRecord) {
  const { driver_profile: driverProfile, ...candidate } = verification.user;
  return {
    id: verification.id,
    revision: verification.revision,
    application_submitted: verification.user.review_submitted_at !== null,
    status: verification.status,
    expiry: serializeExpiry(verification),
    documents_expired_at: verification.documents_expired_at ?? null,
    renewal_submitted_at: verification.renewal_submitted_at ?? null,
    rejection_reason: verification.rejection_reason,
    submitted_at: verification.submitted_at,
    reviewed_at: verification.reviewed_at,
    reviewer: verification.reviewed_by,
    candidate: serializeSafeUser(candidate),
    driver_profile: driverProfile,
    history: verification.decisions.map((entry) => ({
      id: entry.id,
      revision: entry.revision,
      decision: entry.decision,
      reason: entry.reason,
      decided_by: entry.decided_by,
      created_at: entry.created_at
    })),
    evidence: serializeEvidence(verification)
  };
}

export const EVIDENCE_KINDS = ["driver_licence", "vehicle_registration", "national_id", "insurance", "other"] as const;
/** Per-revision cap, so one review cannot grow without bound. */
export const MAX_EVIDENCE_PER_REVISION = 10;

/** Only the current revision counts: earlier rounds stay in the table, not on the review. */
function serializeEvidence(verification: DriverVerificationRecord) {
  const items = verification.evidence
    .filter((entry) => entry.revision === verification.revision)
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      note: entry.note,
      recorded_by: entry.recorded_by,
      created_at: entry.created_at
    }));
  const documents = verification.documents
    .filter((entry) => entry.revision === verification.revision)
    .map(({ id, kind, mime_type, size_bytes, created_at }) => ({ id, kind, mime_type, size_bytes, created_at }));
  return items.length === 0 && documents.length === 0
    ? { status: "not_collected" as const, items, documents }
    : { status: "recorded" as const, items, documents };
}

const recordEvidenceSchema = z.object({
  expected_revision: z.number().int().min(1),
  kind: z.enum(EVIDENCE_KINDS),
  note: z
    .string()
    .max(200)
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => !/[ -]/.test(value), "Invalid value")
    .optional()
});

const verificationListSchema = z.object({
  status: z
    .enum([
      DriverVerificationStatus.pending,
      DriverVerificationStatus.approved,
      DriverVerificationStatus.rejected,
      DriverVerificationStatus.documents_expired
    ])
    .default(DriverVerificationStatus.pending),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const profileInputSchema = z.object({
  vehicle_type: z
    .string()
    .min(2)
    .max(80)
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length >= 2 && !/[\u0000-\u001f\u007f]/.test(value), "Invalid value"),
  seats_total: z.number().int().min(1).max(8),
  parcel_capacity: z.number().int().min(0).max(20)
});

const approveVerificationSchema = z.object({
  expected_revision: z.number().int().min(1),
  profile: profileInputSchema.optional(),
  expiry: expiryInputSchema.optional()
});

const rejectVerificationSchema = z.object({
  expected_revision: z.number().int().min(1),
  reason: z
    .string()
    .min(3)
    .max(500)
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length >= 3 && !/[\u0000-\u001f\u007f]/.test(value), "Invalid value")
});

function requestParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

adminRouter.use("/admin", requireAuth, requireRole("admin"));

adminRouter.get("/admin/users", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = adminUserListQuerySchema.parse(req.query);
    const where: Prisma.UserWhereInput = {
      ...(input.role ? { role: input.role } : null),
      ...(input.account_status ? { account_status: input.account_status } : null),
      ...(typeof input.demo_account === "boolean" ? { demo_account: input.demo_account } : null),
      ...(input.search
        ? {
            OR: [
              { id: { contains: input.search } },
              { name: { contains: input.search } },
              { phone: { contains: input.search } },
              { status_reason: { contains: input.search } }
            ]
          }
        : null)
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userDirectoryListSelect,
        orderBy: [{ created_at: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit
      }),
      prisma.user.count({ where })
    ]);
    res.json({
      users: users.map(serializeUserDirectoryListRecord),
      page: input.page,
      limit: input.limit,
      total
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/admin/users/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = requestParam(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userDirectoryDetailSelect
    });
    if (!user) throw new HttpError(404, "user_not_found");

    const [activeSessionSummary, passengerRequestCount, merchantOrderCount] = await Promise.all([
      prisma.authSession.aggregate({
        where: {
          user_id: user.id,
          revoked_at: null
        },
        _count: { _all: true },
        _max: { last_used_at: true }
      }),
      prisma.passengerRequest.count({
        where: { passenger_id: user.id }
      }),
      prisma.merchantOrder.count({
        where: { merchant_id: user.id }
      })
    ]);

    const serialized = serializeUserDirectoryDetailRecord(user);
    res.json({
      user: {
        ...serialized,
        active_session_count: activeSessionSummary._count._all,
        last_session_at: activeSessionSummary._max.last_used_at,
        passenger_request_count: user.role === "passenger" ? passengerRequestCount : 0,
        merchant_order_count: user.role === "merchant" ? merchantOrderCount : 0
      }
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/admin/driver-verifications", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = verificationListSchema.parse(req.query);
    // Applicants who have not sent their documents for review are not in the queue yet.
    const where = { status: input.status, user: { review_submitted_at: { not: null } } };
    const [verifications, total] = await Promise.all([
      prisma.driverVerification.findMany({
        where,
        include: driverVerificationInclude,
        orderBy: [{ submitted_at: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit
      }),
      prisma.driverVerification.count({ where })
    ]);
    res.json({
      verifications: verifications.map(serializeDriverVerification),
      page: input.page,
      limit: input.limit,
      total
    });
  } catch (error) {
    next(error);
  }
});

const expiringQuerySchema = z.object({
  within_days: z.coerce.number().int().min(0).max(365).default(30),
  kind: z.enum(EXPIRY_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

/** Approved drivers with a document that runs out soon (or already ran out and is not yet processed). */
adminRouter.get("/admin/driver-verifications/expiring", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = expiringQuerySchema.parse(req.query);
    const now = new Date();
    const horizon = new Date(utcMidnight(now) + input.within_days * 24 * 60 * 60 * 1000);
    const kinds = input.kind ? [input.kind] : [...EXPIRY_KINDS];
    const where = {
      status: DriverVerificationStatus.approved,
      OR: kinds.map((kind) => ({ [EXPIRY_COLUMN[kind]]: { lte: horizon } }))
    } satisfies Prisma.DriverVerificationWhereInput;
    const [verifications, total] = await Promise.all([
      prisma.driverVerification.findMany({
        where,
        include: driverVerificationInclude,
        orderBy: [{ licence_expires_at: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit
      }),
      prisma.driverVerification.count({ where })
    ]);
    res.json({
      verifications: verifications.map(serializeDriverVerification),
      page: input.page,
      limit: input.limit,
      total,
      within_days: input.within_days
    });
  } catch (error) {
    next(error);
  }
});

const reReviewQuerySchema = z.object({
  /** submitted: renewed documents waiting for Admin; awaiting_driver: restricted, nothing sent yet. */
  state: z.enum(["submitted", "awaiting_driver", "all"]).default("submitted"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

adminRouter.get("/admin/driver-verifications/re-review", async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = reReviewQuerySchema.parse(req.query);
    const submitted = { status: DriverVerificationStatus.pending, renewal_submitted_at: { not: null } };
    const awaiting = { status: DriverVerificationStatus.documents_expired };
    const where: Prisma.DriverVerificationWhereInput =
      input.state === "submitted" ? submitted : input.state === "awaiting_driver" ? awaiting : { OR: [submitted, awaiting] };
    const [verifications, total] = await Promise.all([
      prisma.driverVerification.findMany({
        where,
        include: driverVerificationInclude,
        orderBy: [{ submitted_at: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.limit,
        take: input.limit
      }),
      prisma.driverVerification.count({ where })
    ]);
    res.json({ verifications: verifications.map(serializeDriverVerification), page: input.page, limit: input.limit, total, state: input.state });
  } catch (error) {
    next(error);
  }
});

const updateExpirySchema = z.object({ expected_revision: z.number().int().min(1), expiry: expiryInputSchema });

/** Corrects the recorded dates of an approved driver, e.g. after a licence was renewed early. */
adminRouter.post("/admin/driver-verifications/:userId/expiry", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = requestParam(req.params.userId);
    const input = updateExpirySchema.parse(req.body);
    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.driverVerification.findUnique({ where: { user_id: userId }, include: driverVerificationInclude });
        if (!current) throw new HttpError(404, "driver_verification_not_found");
        if (current.status !== DriverVerificationStatus.approved || current.revision !== input.expected_revision) {
          throw new HttpError(409, "driver_verification_state_conflict");
        }
        const now = new Date();
        const columns = resolveExpiry(current, input.expiry, now);
        const changed = await tx.driverVerification.updateMany({
          where: { id: current.id, status: DriverVerificationStatus.approved, revision: input.expected_revision },
          data: columns
        });
        if (changed.count !== 1) throw new HttpError(409, "driver_verification_state_conflict");
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "DriverVerification",
          entityId: current.id,
          metadata: {
            action: "driver_verification_expiry_updated",
            target_user_id: current.user_id,
            expiry: serializeExpiry(columns, now),
            request_id: req.requestId
          }
        });
        return tx.driverVerification.findUniqueOrThrow({ where: { id: current.id }, include: driverVerificationInclude });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    res.json({ verification: serializeDriverVerification(result) });
  } catch (error) {
    next(isTransactionWriteConflict(error) ? new HttpError(409, "driver_verification_state_conflict") : error);
  }
});

adminRouter.get("/admin/driver-verifications/:userId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = requestParam(req.params.userId);
    const verification = await prisma.driverVerification.findUnique({
      where: { user_id: userId },
      include: driverVerificationInclude
    });
    if (!verification) throw new HttpError(404, "driver_verification_not_found");
    res.json({ verification: serializeDriverVerification(verification) });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/admin/driver-verifications/:userId/approve", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = requestParam(req.params.userId);
    const input = approveVerificationSchema.parse(req.body);
    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.driverVerification.findUnique({
          where: { user_id: userId },
          include: driverVerificationInclude
        });
        if (!current) throw new HttpError(404, "driver_verification_not_found");
        if (current.user.role !== "driver") throw new HttpError(409, "driver_verification_role_conflict");
        if (current.user.review_submitted_at === null) throw new HttpError(409, "application_not_submitted");
        if (current.user.account_status !== AccountStatus.pending && current.user.account_status !== AccountStatus.active) {
          throw new HttpError(409, "driver_account_status_conflict");
        }
        if (current.status !== DriverVerificationStatus.pending || current.revision !== input.expected_revision) {
          throw new HttpError(409, "driver_verification_state_conflict");
        }
        if (!current.user.driver_profile && !input.profile) throw new HttpError(400, "driver_profile_required");
        if (current.user.driver_profile && input.profile) throw new HttpError(409, "driver_profile_already_exists");

        const now = new Date();
        const expiryColumns = resolveExpiry(current, input.expiry, now);
        // A re-review after expiry must record the new licence date, otherwise
        // the driver would be restricted again or never checked again.
        if (current.renewal_submitted_at && !expiryColumns.licence_expires_at) {
          throw new HttpError(400, "expiry_dates_required");
        }
        const transitioned = await tx.driverVerification.updateMany({
          where: {
            id: current.id,
            status: DriverVerificationStatus.pending,
            revision: input.expected_revision
          },
          data: {
            status: DriverVerificationStatus.approved,
            rejection_reason: null,
            ...expiryColumns,
            documents_expired_at: null,
            renewal_submitted_at: null,
            reviewed_at: now,
            reviewed_by_id: req.user!.id,
            revision: { increment: 1 }
          }
        });
        if (transitioned.count !== 1) throw new HttpError(409, "driver_verification_state_conflict");

        if (current.user.driver_profile) {
          await tx.driverProfile.update({ where: { id: current.user.driver_profile.id }, data: { verified: true } });
        } else {
          await tx.driverProfile.create({
            data: {
              user_id: current.user_id,
              vehicle_type: input.profile!.vehicle_type,
              seats_total: input.profile!.seats_total,
              parcel_capacity: input.profile!.parcel_capacity,
              verified: true
            }
          });
        }
        if (current.user.account_status === AccountStatus.pending) {
          await tx.user.update({
            where: { id: current.user_id },
            data: { account_status: AccountStatus.active, status_reason: null, status_updated_at: now }
          });
        }
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "DriverVerification",
          entityId: current.id,
          metadata: {
            action: current.renewal_submitted_at ? "driver_verification_re_approved" : "driver_verification_approved",
            expiry: serializeExpiry(expiryColumns, now),
            target_user_id: current.user_id,
            previous_status: current.status,
            new_status: DriverVerificationStatus.approved,
            previous_revision: current.revision,
            request_id: req.requestId
          }
        });
        await tx.driverVerificationDecision.create({
          data: { verification_id: current.id, revision: current.revision, decision: "approved", decided_by_id: req.user!.id }
        });
        await notifyDriverVerification(tx, current.user_id, current.id, current.revision, "approved");
        return tx.driverVerification.findUniqueOrThrow({
          where: { id: current.id },
          include: driverVerificationInclude
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    res.json({ verification: serializeDriverVerification(result) });
  } catch (error) {
    next(isTransactionWriteConflict(error) ? new HttpError(409, "driver_verification_state_conflict") : error);
  }
});

adminRouter.post("/admin/driver-verifications/:userId/reject", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = requestParam(req.params.userId);
    const input = rejectVerificationSchema.parse(req.body);
    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.driverVerification.findUnique({
          where: { user_id: userId },
          include: driverVerificationInclude
        });
        if (!current) throw new HttpError(404, "driver_verification_not_found");
        if (current.user.role !== "driver") throw new HttpError(409, "driver_verification_role_conflict");
        if (current.user.review_submitted_at === null) throw new HttpError(409, "application_not_submitted");
        if (current.status !== DriverVerificationStatus.pending || current.revision !== input.expected_revision) {
          throw new HttpError(409, "driver_verification_state_conflict");
        }

        const now = new Date();
        const transitioned = await tx.driverVerification.updateMany({
          where: {
            id: current.id,
            status: DriverVerificationStatus.pending,
            revision: input.expected_revision
          },
          data: {
            status: DriverVerificationStatus.rejected,
            rejection_reason: input.reason,
            documents_expired_at: null,
            renewal_submitted_at: null,
            reviewed_at: now,
            reviewed_by_id: req.user!.id,
            revision: { increment: 1 }
          }
        });
        if (transitioned.count !== 1) throw new HttpError(409, "driver_verification_state_conflict");
        if (current.user.driver_profile) {
          await tx.driverProfile.update({ where: { id: current.user.driver_profile.id }, data: { verified: false } });
        }
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "DriverVerification",
          entityId: current.id,
          metadata: {
            action: "driver_verification_rejected",
            target_user_id: current.user_id,
            previous_status: current.status,
            new_status: DriverVerificationStatus.rejected,
            reason: input.reason,
            previous_revision: current.revision,
            request_id: req.requestId
          }
        });
        await tx.driverVerificationDecision.create({
          data: {
            verification_id: current.id,
            revision: current.revision,
            decision: "rejected",
            reason: input.reason,
            decided_by_id: req.user!.id
          }
        });
        await notifyDriverVerification(tx, current.user_id, current.id, current.revision, "rejected", input.reason);
        return tx.driverVerification.findUniqueOrThrow({
          where: { id: current.id },
          include: driverVerificationInclude
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    res.json({ verification: serializeDriverVerification(result) });
  } catch (error) {
    next(isTransactionWriteConflict(error) ? new HttpError(409, "driver_verification_state_conflict") : error);
  }
});

const reopenVerificationSchema = z.object({
  expected_revision: z.number().int().min(1),
  reason: z
    .string()
    .min(3)
    .max(500)
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length >= 3 && !/[\u0000-\u001f\u007f]/.test(value), "Invalid value")
});

/**
 * Records that an Admin sighted a kind of document for the revision under review.
 * It stores no file and no document number, and approval does not depend on it.
 */
adminRouter.post("/admin/driver-verifications/:userId/evidence", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = requestParam(req.params.userId);
    const input = recordEvidenceSchema.parse(req.body);
    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.driverVerification.findUnique({
          where: { user_id: userId },
          include: driverVerificationInclude
        });
        if (!current) throw new HttpError(404, "driver_verification_not_found");
        if (current.user.role !== "driver") throw new HttpError(409, "driver_verification_role_conflict");
        if (current.status !== DriverVerificationStatus.pending || current.revision !== input.expected_revision) {
          throw new HttpError(409, "driver_verification_state_conflict");
        }
        const recorded = await tx.driverVerificationEvidence.count({
          where: { verification_id: current.id, revision: current.revision }
        });
        if (recorded >= MAX_EVIDENCE_PER_REVISION) throw new HttpError(409, "driver_verification_evidence_limit");

        await tx.driverVerificationEvidence.create({
          data: {
            verification_id: current.id,
            revision: current.revision,
            kind: input.kind,
            note: input.note || null,
            recorded_by_id: req.user!.id
          }
        });
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "DriverVerification",
          entityId: current.id,
          metadata: {
            action: "driver_verification_evidence_recorded",
            target_user_id: current.user_id,
            kind: input.kind,
            revision: current.revision,
            request_id: req.requestId
          }
        });
        return tx.driverVerification.findUniqueOrThrow({ where: { id: current.id }, include: driverVerificationInclude });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    res.status(201).json({ verification: serializeDriverVerification(result) });
  } catch (error) {
    next(isTransactionWriteConflict(error) ? new HttpError(409, "driver_verification_state_conflict") : error);
  }
});

/**
 * Sends a rejected application back to the pending queue for a fresh decision,
 * e.g. after the applicant corrected what the rejection named. The earlier
 * outcome stays in `history`; nothing about the account itself changes here.
 */
adminRouter.post("/admin/driver-verifications/:userId/reopen", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = requestParam(req.params.userId);
    const input = reopenVerificationSchema.parse(req.body);
    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.driverVerification.findUnique({
          where: { user_id: userId },
          include: driverVerificationInclude
        });
        if (!current) throw new HttpError(404, "driver_verification_not_found");
        if (current.user.role !== "driver") throw new HttpError(409, "driver_verification_role_conflict");
        if (current.user.account_status !== AccountStatus.pending && current.user.account_status !== AccountStatus.active) {
          throw new HttpError(409, "driver_account_status_conflict");
        }
        if (current.status !== DriverVerificationStatus.rejected || current.revision !== input.expected_revision) {
          throw new HttpError(409, "driver_verification_state_conflict");
        }

        const now = new Date();
        const transitioned = await tx.driverVerification.updateMany({
          where: { id: current.id, status: DriverVerificationStatus.rejected, revision: input.expected_revision },
          data: {
            status: DriverVerificationStatus.pending,
            rejection_reason: null,
            submitted_at: now,
            reviewed_at: null,
            reviewed_by_id: null,
            revision: { increment: 1 }
          }
        });
        if (transitioned.count !== 1) throw new HttpError(409, "driver_verification_state_conflict");

        await tx.driverVerificationDecision.create({
          data: {
            verification_id: current.id,
            revision: current.revision,
            decision: "reopened",
            reason: input.reason,
            decided_by_id: req.user!.id
          }
        });
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "DriverVerification",
          entityId: current.id,
          metadata: {
            action: "driver_verification_reopened",
            target_user_id: current.user_id,
            previous_status: current.status,
            new_status: DriverVerificationStatus.pending,
            reason: input.reason,
            previous_revision: current.revision,
            request_id: req.requestId
          }
        });
        return tx.driverVerification.findUniqueOrThrow({ where: { id: current.id }, include: driverVerificationInclude });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    res.json({ verification: serializeDriverVerification(result) });
  } catch (error) {
    next(isTransactionWriteConflict(error) ? new HttpError(409, "driver_verification_state_conflict") : error);
  }
});

const merchantDecisionSchema = z.object({
  reason: z
    .string()
    .max(500)
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Invalid value")
    .optional()
});

/**
 * Merchant onboarding review: a pending merchant is either activated or
 * refused. This is deliberately separate from the generic account-status
 * endpoint, which still rejects pending → active for non-passengers.
 */
async function decideMerchant(req: AuthenticatedRequest, decision: "approve" | "reject") {
  const userId = requestParam(req.params.userId);
  const input = merchantDecisionSchema.parse(req.body ?? {});
  if (decision === "reject" && (!input.reason || input.reason.length < 3)) {
    throw new HttpError(400, "reason_required");
  }
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: safeUserSelect });
    if (!target) throw new HttpError(404, "user_not_found");
    if (target.role !== "merchant") throw new HttpError(409, "merchant_role_required");
    if (target.review_submitted_at === null) throw new HttpError(409, "application_not_submitted");
    if (target.account_status !== AccountStatus.pending) throw new HttpError(409, "account_status_conflict");

    const now = new Date();
    const nextStatus = decision === "approve" ? AccountStatus.active : AccountStatus.disabled;
    const changed = await tx.user.updateMany({
      where: { id: target.id, role: "merchant", account_status: AccountStatus.pending },
      data: {
        account_status: nextStatus,
        status_reason: decision === "reject" ? input.reason! : null,
        status_updated_at: now,
        ...(decision === "reject" ? { security_version: { increment: 1 } } : {})
      }
    });
    if (changed.count !== 1) throw new HttpError(409, "account_status_conflict");
    if (decision === "reject") {
      await revokeAllUserSessions(tx, { userId: target.id, reason: "merchant_rejected", now });
      await tx.onboardingSession.updateMany({
        where: { user_id: target.id, purpose: "pending_status", revoked_at: null },
        data: { revoked_at: now, revoke_reason: "merchant_rejected" }
      });
    }
    await auditEvent(tx, {
      userId: req.user!.id,
      action: AuditAction.account_status_changed,
      entityType: "User",
      entityId: target.id,
      metadata: {
        kind: "merchant_approval",
        decision,
        target_user_id: target.id,
        previous_status: target.account_status,
        new_status: nextStatus,
        reason: input.reason ?? null,
        request_id: req.requestId
      }
    });
    return tx.user.findUniqueOrThrow({ where: { id: target.id }, select: safeUserSelect });
  });
}

for (const decision of ["approve", "reject"] as const) {
  adminRouter.post(`/admin/merchant-approvals/:userId/${decision}`, async (req: AuthenticatedRequest, res, next) => {
    try {
      res.json({ user: serializeSafeUser(await decideMerchant(req, decision)) });
    } catch (error) {
      next(error);
    }
  });
}

const accountStatusSchema = z
  .object({
    status: z.enum([AccountStatus.active, AccountStatus.suspended, AccountStatus.disabled]),
    expected_status: z.enum([AccountStatus.active, AccountStatus.pending, AccountStatus.suspended, AccountStatus.disabled]),
    reason: z
      .string()
      .max(500)
      .transform((value) => value.trim().replace(/\s+/g, " "))
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Invalid value")
      .optional()
  })
  .superRefine((value, context) => {
    if (value.status !== AccountStatus.active && (!value.reason || value.reason.length < 3)) {
      context.addIssue({ code: "custom", path: ["reason"], message: "Invalid value" });
    }
  });

function isTransactionWriteConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2034");
}

adminRouter.patch("/admin/users/:id/status", async (req: AuthenticatedRequest, res, next) => {
  try {
    const targetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const input = accountStatusSchema.parse(req.body);
    if (targetId === req.user!.id && input.status !== AccountStatus.active) {
      throw new HttpError(409, "cannot_suspend_current_admin");
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const target = await tx.user.findUnique({ where: { id: targetId }, select: safeUserSelect });
        if (!target) throw new HttpError(404, "user_not_found");
        if (target.account_status !== input.expected_status) {
          throw new HttpError(409, "account_status_conflict");
        }
        if (target.account_status === AccountStatus.pending && input.status === AccountStatus.active && target.role !== "passenger") {
          throw new HttpError(409, "approval_required");
        }
        if (target.account_status === input.status) return target;

        if (target.role === "admin" && input.status !== AccountStatus.active) {
          const otherActiveAdmins = await tx.user.count({
            where: { role: "admin", account_status: AccountStatus.active, id: { not: target.id } }
          });
          if (otherActiveAdmins === 0) throw new HttpError(409, "last_active_admin_required");
        }

        const now = new Date();
        if (input.status !== AccountStatus.active) {
          await revokeAllUserSessions(tx, { userId: target.id, reason: `account_${input.status}`, now });
          await tx.onboardingSession.updateMany({
            where: { user_id: target.id, purpose: "pending_status", revoked_at: null },
            data: { revoked_at: now, revoke_reason: `account_${input.status}` }
          });
        }
        const updated = await tx.user.update({
          where: { id: target.id },
          data: {
            account_status: input.status,
            status_reason: input.reason ?? null,
            status_updated_at: now,
            ...(input.status !== AccountStatus.active ? { security_version: { increment: 1 } } : {})
          },
          select: safeUserSelect
        });
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.account_status_changed,
          entityType: "User",
          entityId: target.id,
          metadata: {
            target_user_id: target.id,
            previous_status: target.account_status,
            new_status: input.status,
            reason: input.reason ?? null,
            request_id: req.requestId
          }
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    res.json({ user: serializeSafeUser(result) });
  } catch (error) {
    next(isTransactionWriteConflict(error) ? new HttpError(409, "account_status_conflict") : error);
  }
});

adminRouter.get("/admin/dashboard", async (req: AuthenticatedRequest, res, next) => {
  try {
    const [
      users,
      drivers,
      routes,
      requests,
      orders,
      parcels,
      activeDriverGroups,
      pendingDriverApprovals,
      openIncidents,
      recentRequests,
      recentOrders,
      recentRoutes
    ] =
      await Promise.all([
        prisma.user.count(),
        prisma.driverProfile.count(),
        prisma.driverRoute.count(),
        prisma.passengerRequest.count(),
        prisma.merchantOrder.count(),
        prisma.parcel.count(),
        // Active driver = verified driver with a route in service: waiting for work
        // (active), holding an accepted job (assigned), or driving it (on_trip).
        prisma.driverRoute.groupBy({
          by: ["driver_id"],
          where: { status: { in: ["active", "assigned", "on_trip"] }, driver: { verified: true } }
        }),
        prisma.driverVerification.count({ where: { status: "pending", user: { review_submitted_at: { not: null } } } }),
        prisma.incident.count({ where: { status: { not: "resolved" } } }),
        prisma.passengerRequest.findMany({ orderBy: { created_at: "desc" }, take: 5 }),
        prisma.merchantOrder.findMany({ orderBy: { created_at: "desc" }, take: 5, include: { parcels: true } }),
        prisma.driverRoute.findMany({ orderBy: { activated_at: "desc" }, take: 5 })
      ]);

    await auditEvent(prisma, {
      userId: req.user!.id,
      action: AuditAction.admin_action,
      entityType: "AdminDashboard",
      metadata: { action: "dashboard_viewed" }
    });

    res.json({
      counts: {
        users,
        drivers,
        routes,
        passenger_requests: requests,
        merchant_orders: orders,
        parcels,
        active_drivers: activeDriverGroups.length,
        pending_driver_approvals: pendingDriverApprovals,
        open_incidents: openIncidents
      },
      recent: { passenger_requests: recentRequests, merchant_orders: recentOrders, routes: recentRoutes }
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/admin/drivers", async (_req, res, next) => {
  try {
    const drivers = await prisma.driverProfile.findMany({
      include: { user: { select: safeUserSelect }, routes: true }
    });
    res.json({ drivers: drivers.map((driver) => ({ ...driver, user: serializeSafeUser(driver.user) })) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/admin/requests", async (_req, res, next) => {
  try {
    const requests = await prisma.passengerRequest.findMany({
      include: { passenger: { select: safeUserSelect } }
    });
    res.json({ requests: requests.map((request) => ({ ...request, passenger: serializeSafeUser(request.passenger) })) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/admin/orders", async (_req, res, next) => {
  try {
    const orders = await prisma.merchantOrder.findMany({
      where: { passenger_parcel: null },
      include: { merchant: { select: safeUserSelect }, parcels: true }
    });
    res.json({ orders: orders.map((order) => ({ ...order, merchant: serializeSafeUser(order.merchant) })) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/admin/routes", async (_req, res, next) => {
  try {
    const routes = await prisma.driverRoute.findMany({
      include: { driver: { include: { user: { select: safeUserSelect } } } }
    });
    res.json({
      routes: routes.map((route) => ({
        ...route,
        driver: { ...route.driver, user: serializeSafeUser(route.driver.user) }
      }))
    });
  } catch (error) {
    next(error);
  }
});
