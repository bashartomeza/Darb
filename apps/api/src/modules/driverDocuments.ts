import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { auditEvent } from "../lib/audit.js";
import { consumeAbuseCounter } from "../lib/abuseCounters.js";
import { abuseSubjectDigest } from "../lib/keyedDigest.js";
import { missingDocumentKinds, requiredDocumentKinds } from "../lib/applicationReview.js";
import type { AppConfig } from "../config.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { notify } from "../services/notifications.js";
import { requireOnboardingToken, type OnboardingAuthenticatedRequest } from "../middleware/onboardingAuth.js";
import { AccountStatus, AuditAction, DriverVerificationStatus } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  DOCUMENT_KINDS,
  MAX_DOCUMENTS_PER_REVISION,
  MAX_DOCUMENT_BYTES,
  MERCHANT_DOCUMENT_KINDS,
  createDocumentStorage,
  sniffDocumentMime
} from "../services/driverDocumentStorage.js";

const uploadQuerySchema = z.object({ kind: z.enum(DOCUMENT_KINDS) });
const merchantUploadQuerySchema = z.object({ kind: z.enum(MERCHANT_DOCUMENT_KINDS) });

const EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

function routeParam(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.length === 0 || value.length > 191) throw new HttpError(400, "invalid_route_param");
  return value;
}

function serializeDocument(row: { id: string; kind: string; mime_type: string; size_bytes: number; created_at: Date }) {
  return { id: row.id, kind: row.kind, mime_type: row.mime_type, size_bytes: row.size_bytes, created_at: row.created_at };
}

function isWriteConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

/**
 * Applicant document upload (pending-status session) and Admin download.
 * Disabled unless DRIVER_DOCUMENTS_ENABLED is set with a storage directory.
 */
export function createDriverDocumentsRouter(appConfig: AppConfig) {
  const router = Router();
  const settings = appConfig.driverDocuments;
  const storage = settings ? createDocumentStorage(settings.dir) : null;
  const available = (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
    next(storage ? undefined : new HttpError(404, "driver_documents_unavailable"));
  const applicant = requireOnboardingToken(appConfig, ["pending_status"]);

  /** Hourly cap per applicant, so open signup cannot be used to churn the disk. */
  async function consumeUploadBucket(req: OnboardingAuthenticatedRequest, type: string, limit: number) {
    const onboarding = appConfig.onboarding;
    const userId = req.onboarding?.userId;
    if (!onboarding || !userId) return;
    const result = await consumeAbuseCounter(prisma, {
      bucketType: type,
      subjectDigest: abuseSubjectDigest(type, userId, onboarding.keys.abuse),
      digestVersion: onboarding.keys.abuse.version,
      windowSeconds: 3_600,
      limit
    });
    if (!result.allowed) throw new HttpError(429, "rate_limited");
  }

  /** Once submitted, an applicant cannot delete the last file of a required kind. */
  async function assertSubmittedKeepsRequired(
    userId: string,
    role: "driver" | "merchant",
    document: { id: string; kind: string }
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { review_submitted_at: true } });
    if (!user?.review_submitted_at || !requiredDocumentKinds(role).includes(document.kind)) return;
    const others =
      role === "driver"
        ? await prisma.driverVerificationDocument.count({
            where: {
              kind: document.kind,
              id: { not: document.id },
              verification: { user_id: userId },
              revision: (await prisma.driverVerification.findUnique({ where: { user_id: userId } }))?.revision
            }
          })
        : await prisma.merchantApplicationDocument.count({
            where: { user_id: userId, kind: document.kind, id: { not: document.id } }
          });
    if (others === 0) throw new HttpError(409, "documents_required");
  }

  /** The applicant's own verification, only while it is pending review. */
  async function pendingVerificationFor(req: OnboardingAuthenticatedRequest) {
    const context = req.onboarding!;
    if (context.userRole !== "driver" || context.userStatus !== "pending" || !context.userId) {
      throw new HttpError(403, "driver_documents_unavailable");
    }
    const verification = await prisma.driverVerification.findUnique({ where: { user_id: context.userId } });
    if (!verification || verification.status !== DriverVerificationStatus.pending) {
      throw new HttpError(409, "driver_verification_state_conflict");
    }
    return verification;
  }

  router.get("/onboarding/driver-documents", available, applicant, async (req: OnboardingAuthenticatedRequest, res, next) => {
    try {
      const verification = await pendingVerificationFor(req);
      const documents = await prisma.driverVerificationDocument.findMany({
        where: { verification_id: verification.id, revision: verification.revision },
        orderBy: [{ created_at: "asc" }, { id: "asc" }]
      });
      res.json({
        documents: documents.map(serializeDocument),
        limits: { max_documents: MAX_DOCUMENTS_PER_REVISION, max_bytes: MAX_DOCUMENT_BYTES, kinds: DOCUMENT_KINDS },
        request_id: req.requestId
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/onboarding/driver-documents",
    available,
    applicant,
    express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES }),
    async (req: OnboardingAuthenticatedRequest, res, next) => {
      let savedKey: string | null = null;
      try {
        const { kind } = uploadQuerySchema.parse(req.query);
        const verification = await pendingVerificationFor(req);
        await consumeUploadBucket(req, "document_upload", 30);
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (bytes.length === 0) throw new HttpError(400, "document_empty");
        const mime = sniffDocumentMime(bytes);
        if (!mime) throw new HttpError(415, "document_type_unsupported");

        const saved = await storage!.save(bytes);
        savedKey = saved.key;
        const created = await prisma.$transaction(
          async (tx) => {
            const current = await tx.driverVerification.findUnique({ where: { id: verification.id } });
            if (!current || current.status !== DriverVerificationStatus.pending || current.revision !== verification.revision) {
              throw new HttpError(409, "driver_verification_state_conflict");
            }
            const count = await tx.driverVerificationDocument.count({
              where: { verification_id: current.id, revision: current.revision }
            });
            if (count >= MAX_DOCUMENTS_PER_REVISION) throw new HttpError(409, "driver_document_limit");
            const row = await tx.driverVerificationDocument.create({
              data: {
                verification_id: current.id,
                revision: current.revision,
                kind,
                mime_type: mime,
                size_bytes: bytes.length,
                sha256: saved.sha256,
                storage_key: saved.key
              }
            });
            await auditEvent(tx, {
              userId: req.onboarding!.userId,
              action: AuditAction.driver_verification,
              entityType: "DriverVerification",
              entityId: current.id,
              metadata: { action: "driver_document_uploaded", kind, size_bytes: bytes.length, request_id: req.requestId }
            });
            return row;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        savedKey = null;
        res.status(201).json({ document: serializeDocument(created), request_id: req.requestId });
      } catch (error) {
        // The row never committed, so the file must not outlive the request.
        if (savedKey) await storage!.remove(savedKey).catch(() => undefined);
        next(isWriteConflict(error) ? new HttpError(409, "driver_verification_state_conflict") : error);
      }
    }
  );

  router.delete("/onboarding/driver-documents/:id", available, applicant, async (req: OnboardingAuthenticatedRequest, res, next) => {
    try {
      const verification = await pendingVerificationFor(req);
      const id = routeParam(req.params.id);
      const document = await prisma.driverVerificationDocument.findFirst({
        where: { id, verification_id: verification.id, revision: verification.revision }
      });
      if (!document) throw new HttpError(404, "driver_document_not_found");
      await consumeUploadBucket(req, "document_delete", 30);
      await assertSubmittedKeepsRequired(req.onboarding!.userId!, "driver", document);
      await prisma.$transaction(async (tx) => {
        await tx.driverVerificationDocument.delete({ where: { id: document.id } });
        await auditEvent(tx, {
          userId: req.onboarding!.userId,
          action: AuditAction.driver_verification,
          entityType: "DriverVerification",
          entityId: verification.id,
          metadata: { action: "driver_document_deleted", kind: document.kind, request_id: req.requestId }
        });
      });
      await storage!.remove(document.storage_key);
      res.json({ deleted: true, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/admin/driver-verifications/:userId/documents/:documentId",
    available,
    requireAuth,
    requireRole("admin"),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const userId = routeParam(req.params.userId);
        const documentId = routeParam(req.params.documentId);
        const document = await prisma.driverVerificationDocument.findFirst({
          where: { id: documentId, verification: { user_id: userId } }
        });
        if (!document) throw new HttpError(404, "driver_document_not_found");
        let bytes: Buffer;
        try {
          bytes = await storage!.read(document.storage_key);
        } catch {
          throw new HttpError(404, "driver_document_not_found");
        }
        await auditEvent(prisma, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "DriverVerification",
          entityId: document.verification_id,
          metadata: { action: "driver_document_viewed", document_id: document.id, kind: document.kind, request_id: req.requestId }
        });
        // Documents are attachments, never rendered in the console's own origin.
        res.set({
          "Content-Type": document.mime_type,
          "Content-Disposition": `attachment; filename="${document.id}.${EXTENSIONS[document.mime_type] ?? "bin"}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
          "Content-Length": String(bytes.length)
        });
        res.send(bytes);
      } catch (error) {
        next(error);
      }
    }
  );

  // ---- Renewal after documents expired: the driver's normal (active) session ----
  const driverSession = [requireAuth, requireRole("driver")] as const;

  async function expiredVerificationFor(userId: string) {
    const verification = await prisma.driverVerification.findUnique({ where: { user_id: userId } });
    if (!verification || verification.status !== DriverVerificationStatus.documents_expired) {
      throw new HttpError(409, "driver_verification_state_conflict");
    }
    return verification;
  }

  router.get("/driver/document-renewal", available, ...driverSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const verification = await prisma.driverVerification.findUnique({ where: { user_id: req.user!.id } });
      if (!verification) throw new HttpError(404, "driver_verification_not_found");
      const editable = verification.status === DriverVerificationStatus.documents_expired;
      const documents = await prisma.driverVerificationDocument.findMany({
        where: { verification_id: verification.id, revision: verification.revision },
        orderBy: [{ created_at: "asc" }, { id: "asc" }]
      });
      res.json({
        status: verification.status,
        can_upload: editable,
        submitted: verification.status === DriverVerificationStatus.pending && Boolean(verification.renewal_submitted_at),
        documents_expired_at: verification.documents_expired_at,
        renewal_submitted_at: verification.renewal_submitted_at,
        documents: documents.map(serializeDocument),
        limits: { max_documents: MAX_DOCUMENTS_PER_REVISION, max_bytes: MAX_DOCUMENT_BYTES, kinds: DOCUMENT_KINDS },
        request_id: req.requestId
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/driver/document-renewal/documents",
    available,
    ...driverSession,
    express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES }),
    async (req: AuthenticatedRequest, res, next) => {
      let savedKey: string | null = null;
      try {
        const { kind } = uploadQuerySchema.parse(req.query);
        const verification = await expiredVerificationFor(req.user!.id);
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (bytes.length === 0) throw new HttpError(400, "document_empty");
        const mime = sniffDocumentMime(bytes);
        if (!mime) throw new HttpError(415, "document_type_unsupported");
        const saved = await storage!.save(bytes);
        savedKey = saved.key;
        const created = await prisma.$transaction(
          async (tx) => {
            const current = await tx.driverVerification.findUnique({ where: { id: verification.id } });
            if (!current || current.status !== DriverVerificationStatus.documents_expired || current.revision !== verification.revision) {
              throw new HttpError(409, "driver_verification_state_conflict");
            }
            const count = await tx.driverVerificationDocument.count({
              where: { verification_id: current.id, revision: current.revision }
            });
            if (count >= MAX_DOCUMENTS_PER_REVISION) throw new HttpError(409, "driver_document_limit");
            const row = await tx.driverVerificationDocument.create({
              data: {
                verification_id: current.id,
                revision: current.revision,
                kind,
                mime_type: mime,
                size_bytes: bytes.length,
                sha256: saved.sha256,
                storage_key: saved.key
              }
            });
            await auditEvent(tx, {
              userId: req.user!.id,
              action: AuditAction.driver_verification,
              entityType: "DriverVerification",
              entityId: current.id,
              metadata: { action: "driver_renewal_document_uploaded", kind, size_bytes: bytes.length, request_id: req.requestId }
            });
            return row;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        savedKey = null;
        res.status(201).json({ document: serializeDocument(created), request_id: req.requestId });
      } catch (error) {
        if (savedKey) await storage!.remove(savedKey).catch(() => undefined);
        next(isWriteConflict(error) ? new HttpError(409, "driver_verification_state_conflict") : error);
      }
    }
  );

  router.delete("/driver/document-renewal/documents/:id", available, ...driverSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const verification = await expiredVerificationFor(req.user!.id);
      const document = await prisma.driverVerificationDocument.findFirst({
        where: { id: routeParam(req.params.id), verification_id: verification.id, revision: verification.revision }
      });
      if (!document) throw new HttpError(404, "driver_document_not_found");
      await prisma.$transaction(async (tx) => {
        await tx.driverVerificationDocument.delete({ where: { id: document.id } });
        await auditEvent(tx, {
          userId: req.user!.id,
          action: AuditAction.driver_verification,
          entityType: "DriverVerification",
          entityId: verification.id,
          metadata: { action: "driver_renewal_document_deleted", kind: document.kind, request_id: req.requestId }
        });
      });
      await storage!.remove(document.storage_key);
      res.json({ deleted: true, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  /** Sends the uploaded documents to the Admin re-review queue. Access stays restricted until approval. */
  router.post("/driver/document-renewal/submit", available, ...driverSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const verification = await expiredVerificationFor(req.user!.id);
      await prisma.$transaction(
        async (tx) => {
          const count = await tx.driverVerificationDocument.count({
            where: { verification_id: verification.id, revision: verification.revision }
          });
          if (count === 0) throw new HttpError(409, "renewal_documents_required");
          const now = new Date();
          const moved = await tx.driverVerification.updateMany({
            where: { id: verification.id, status: DriverVerificationStatus.documents_expired, revision: verification.revision },
            data: { status: DriverVerificationStatus.pending, submitted_at: now, renewal_submitted_at: now }
          });
          if (moved.count !== 1) throw new HttpError(409, "driver_verification_state_conflict");
          await tx.driverVerificationDecision.create({
            data: { verification_id: verification.id, revision: verification.revision, decision: "renewal_submitted", decided_by_id: null }
          });
          await auditEvent(tx, {
            userId: req.user!.id,
            action: AuditAction.driver_verification,
            entityType: "DriverVerification",
            entityId: verification.id,
            metadata: { action: "driver_renewal_submitted", documents: count, request_id: req.requestId }
          });
          await notify(tx, {
            userId: req.user!.id,
            type: "driver_documents_renewal_submitted",
            entityType: "DriverVerification",
            entityId: verification.id,
            dedupeKey: `driver_documents_renewal_submitted:${verification.id}:${verification.revision}`
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      res.json({ submitted: true, request_id: req.requestId });
    } catch (error) {
      next(isWriteConflict(error) ? new HttpError(409, "driver_verification_state_conflict") : error);
    }
  });

  /** A shop owner's own pending application (pending-status session). */
  function pendingMerchantId(req: OnboardingAuthenticatedRequest) {
    const context = req.onboarding!;
    if (context.userRole !== "merchant" || context.userStatus !== "pending" || !context.userId) {
      throw new HttpError(403, "driver_documents_unavailable");
    }
    return context.userId;
  }

  async function assertMerchantPending(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, account_status: true } });
    if (!user || user.role !== "merchant" || user.account_status !== AccountStatus.pending) {
      throw new HttpError(409, "driver_verification_state_conflict");
    }
  }

  router.get("/onboarding/merchant-documents", available, applicant, async (req: OnboardingAuthenticatedRequest, res, next) => {
    try {
      const userId = pendingMerchantId(req);
      await assertMerchantPending(userId);
      const documents = await prisma.merchantApplicationDocument.findMany({
        where: { user_id: userId },
        orderBy: [{ created_at: "asc" }, { id: "asc" }]
      });
      res.json({
        documents: documents.map(serializeDocument),
        limits: { max_documents: MAX_DOCUMENTS_PER_REVISION, max_bytes: MAX_DOCUMENT_BYTES, kinds: MERCHANT_DOCUMENT_KINDS },
        request_id: req.requestId
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/onboarding/merchant-documents",
    available,
    applicant,
    express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES }),
    async (req: OnboardingAuthenticatedRequest, res, next) => {
      let savedKey: string | null = null;
      try {
        const { kind } = merchantUploadQuerySchema.parse(req.query);
        const userId = pendingMerchantId(req);
        await assertMerchantPending(userId);
        await consumeUploadBucket(req, "document_upload", 30);
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (bytes.length === 0) throw new HttpError(400, "document_empty");
        const mime = sniffDocumentMime(bytes);
        if (!mime) throw new HttpError(415, "document_type_unsupported");

        const saved = await storage!.save(bytes);
        savedKey = saved.key;
        const created = await prisma.$transaction(
          async (tx) => {
            const user = await tx.user.findUnique({ where: { id: userId }, select: { account_status: true } });
            if (!user || user.account_status !== AccountStatus.pending) {
              throw new HttpError(409, "driver_verification_state_conflict");
            }
            const count = await tx.merchantApplicationDocument.count({ where: { user_id: userId } });
            if (count >= MAX_DOCUMENTS_PER_REVISION) throw new HttpError(409, "driver_document_limit");
            const row = await tx.merchantApplicationDocument.create({
              data: {
                user_id: userId,
                kind,
                mime_type: mime,
                size_bytes: bytes.length,
                sha256: saved.sha256,
                storage_key: saved.key
              }
            });
            await auditEvent(tx, {
              userId,
              action: AuditAction.account_status_changed,
              entityType: "User",
              entityId: userId,
              metadata: { action: "merchant_document_uploaded", kind, size_bytes: bytes.length, request_id: req.requestId }
            });
            return row;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        savedKey = null;
        res.status(201).json({ document: serializeDocument(created), request_id: req.requestId });
      } catch (error) {
        if (savedKey) await storage!.remove(savedKey).catch(() => undefined);
        next(isWriteConflict(error) ? new HttpError(409, "driver_verification_state_conflict") : error);
      }
    }
  );

  router.delete("/onboarding/merchant-documents/:id", available, applicant, async (req: OnboardingAuthenticatedRequest, res, next) => {
    try {
      const userId = pendingMerchantId(req);
      await assertMerchantPending(userId);
      const document = await prisma.merchantApplicationDocument.findFirst({
        where: { id: routeParam(req.params.id), user_id: userId }
      });
      if (!document) throw new HttpError(404, "driver_document_not_found");
      await consumeUploadBucket(req, "document_delete", 30);
      await assertSubmittedKeepsRequired(userId, "merchant", document);
      await prisma.$transaction(async (tx) => {
        await tx.merchantApplicationDocument.delete({ where: { id: document.id } });
        await auditEvent(tx, {
          userId,
          action: AuditAction.account_status_changed,
          entityType: "User",
          entityId: userId,
          metadata: { action: "merchant_document_deleted", kind: document.kind, request_id: req.requestId }
        });
      });
      await storage!.remove(document.storage_key);
      res.json({ deleted: true, request_id: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Sends the applicant's complete application to the Admin review queue. The server
   * refuses until every required document kind is on file, so a modified app cannot
   * skip the documents step. Idempotent once submitted.
   */
  router.post("/onboarding/application/submit", available, applicant, async (req: OnboardingAuthenticatedRequest, res, next) => {
    try {
      const context = req.onboarding!;
      if (!context.userId || context.userStatus !== "pending" || !["driver", "merchant"].includes(context.userRole ?? "")) {
        throw new HttpError(403, "driver_documents_unavailable");
      }
      const userId = context.userId;
      await consumeUploadBucket(req, "application_submit", 20);
      const outcome = await prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { role: true, account_status: true, review_submitted_at: true }
          });
          if (!user || user.account_status !== AccountStatus.pending || !["driver", "merchant"].includes(user.role)) {
            throw new HttpError(409, "driver_verification_state_conflict");
          }
          if (user.review_submitted_at) return { missing: [] as string[], submittedAt: user.review_submitted_at };
          if (user.role === "driver") {
            const verification = await tx.driverVerification.findUnique({ where: { user_id: userId } });
            if (!verification || verification.status !== DriverVerificationStatus.pending) {
              throw new HttpError(409, "driver_verification_state_conflict");
            }
          }
          const missing = await missingDocumentKinds(tx, userId, user.role);
          if (missing.length > 0) return { missing, submittedAt: null };
          const now = new Date();
          await tx.user.update({ where: { id: userId }, data: { review_submitted_at: now } });
          if (user.role === "driver") {
            await tx.driverVerification.update({ where: { user_id: userId }, data: { submitted_at: now } });
          }
          await auditEvent(tx, {
            userId,
            action: AuditAction.account_status_changed,
            entityType: "User",
            entityId: userId,
            metadata: { action: "application_submitted", role: user.role, request_id: req.requestId }
          });
          return { missing: [] as string[], submittedAt: now };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      if (outcome.missing.length > 0) {
        res.status(409).json({ error: "documents_required", missing_documents: outcome.missing, request_id: req.requestId });
        return;
      }
      res.json({
        onboarding_status: "pending_review",
        next_action: "await_approval",
        submitted_at: outcome.submittedAt,
        request_id: req.requestId
      });
    } catch (error) {
      next(isWriteConflict(error) ? new HttpError(409, "driver_verification_state_conflict") : error);
    }
  });

  router.get(
    "/admin/merchant-approvals/:userId/documents",
    available,
    requireAuth,
    requireRole("admin"),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const documents = await prisma.merchantApplicationDocument.findMany({
          where: { user_id: routeParam(req.params.userId) },
          orderBy: [{ created_at: "asc" }, { id: "asc" }]
        });
        res.json({ documents: documents.map(serializeDocument), request_id: req.requestId });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/admin/merchant-approvals/:userId/documents/:documentId",
    available,
    requireAuth,
    requireRole("admin"),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const document = await prisma.merchantApplicationDocument.findFirst({
          where: { id: routeParam(req.params.documentId), user_id: routeParam(req.params.userId) }
        });
        if (!document) throw new HttpError(404, "driver_document_not_found");
        let bytes: Buffer;
        try {
          bytes = await storage!.read(document.storage_key);
        } catch {
          throw new HttpError(404, "driver_document_not_found");
        }
        await auditEvent(prisma, {
          userId: req.user!.id,
          action: AuditAction.admin_action,
          entityType: "User",
          entityId: document.user_id,
          metadata: { action: "merchant_document_viewed", document_id: document.id, kind: document.kind, request_id: req.requestId }
        });
        res.set({
          "Content-Type": document.mime_type,
          "Content-Disposition": `attachment; filename="${document.id}.${EXTENSIONS[document.mime_type] ?? "bin"}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
          "Content-Length": String(bytes.length)
        });
        res.send(bytes);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
