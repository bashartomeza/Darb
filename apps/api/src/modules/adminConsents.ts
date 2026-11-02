import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { ConsentReleaseService } from "../services/consentReleases.js";

const version = z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/);
const instant = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const documentInput = z.strictObject({
  type: z.enum(["terms", "privacy", "adult_self_attestation"]),
  locale: z.enum(["ar", "en"]),
  content: z.string()
});
const draftInput = z.strictObject({
  version,
  intended_effective_at: instant,
  documents: z.array(documentInput).length(6)
});
const updateInput = z.strictObject({
  expected_revision: z.number().int().min(1),
  intended_effective_at: instant,
  documents: z.array(documentInput).length(6)
});
const approveInput = z.strictObject({
  expected_revision: z.number().int().min(1),
  legal_approval_confirmed: z.literal(true)
});
const activateInput = z.strictObject({
  expected_revision: z.number().int().min(1),
  expected_current_release_id: z.string().min(1).max(191).nullable(),
  activation_confirmed: z.literal(true)
});
const retireInput = z.strictObject({
  expected_revision: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
  confirm_disable_onboarding: z.literal(true)
});

type Release = NonNullable<Awaited<ReturnType<ConsentReleaseService["findByVersion"]>>>;

function serializeRelease(release: Release) {
  return {
    id: release.id,
    version: release.version,
    status: release.status,
    revision: release.revision,
    intended_effective_at: release.intended_effective_at,
    legal_approved_at: release.legal_approved_at,
    legal_approved_by: release.legal_approved_by,
    activated_at: release.activated_at,
    activated_by: release.activated_by,
    retired_at: release.retired_at,
    retired_by: release.retired_by,
    retirement_reason: release.retirement_reason,
    created_by: release.created_by,
    created_at: release.created_at,
    updated_at: release.updated_at,
    documents: release.documents.map((document) => ({
      id: document.id,
      type: document.document_type,
      locale: document.locale,
      version: document.version,
      content: document.content_body,
      content_digest: document.content_digest,
      effective_at: document.effective_at,
      retired_at: document.retired_at,
      legal_approved_at: document.legal_approved_at,
      legal_approved_by: document.legal_approved_by
    }))
  };
}

function transactionConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2034");
}

export function createAdminConsentRouter(service = new ConsentReleaseService(prisma)) {
  const router = Router();
  router.use("/admin/consent-releases", requireAuth, requireRole("admin"));

  router.get("/admin/consent-releases", async (_req, res, next) => {
    try {
      const releases = await service.list();
      res.json({ releases: releases.map(serializeRelease) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/consent-releases/current", async (_req, res, next) => {
    try {
      const current = await service.current();
      res.json({
        ready: current.ready,
        ambiguous: current.ambiguous,
        release: current.release ? serializeRelease(current.release) : null
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/consent-releases/:version", async (req, res, next) => {
    try {
      const releaseVersion = version.parse(req.params.version);
      const release = await service.findByVersion(releaseVersion);
      if (!release) throw new HttpError(404, "consent_release_not_found");
      res.json({ release: serializeRelease(release) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/consent-releases", async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = draftInput.parse(req.body);
      const release = await service.create({
        version: input.version,
        intendedEffectiveAt: input.intended_effective_at,
        documents: input.documents
      }, req.user!.id);
      res.status(201).json({ release: serializeRelease(release) });
    } catch (error) {
      next(transactionConflict(error) ? new HttpError(409, "consent_release_state_conflict") : error);
    }
  });

  router.put("/admin/consent-releases/:version", async (req: AuthenticatedRequest, res, next) => {
    try {
      const releaseVersion = version.parse(req.params.version);
      const input = updateInput.parse(req.body);
      const release = await service.updateDraft(releaseVersion, input.expected_revision, {
        intendedEffectiveAt: input.intended_effective_at,
        documents: input.documents
      }, req.user!.id);
      res.json({ release: serializeRelease(release) });
    } catch (error) {
      next(transactionConflict(error) ? new HttpError(409, "consent_release_state_conflict") : error);
    }
  });

  router.post("/admin/consent-releases/:version/approve", async (req: AuthenticatedRequest, res, next) => {
    try {
      const releaseVersion = version.parse(req.params.version);
      const input = approveInput.parse(req.body);
      const release = await service.approve(releaseVersion, input.expected_revision, req.user!.id);
      res.json({ release: serializeRelease(release) });
    } catch (error) {
      next(transactionConflict(error) ? new HttpError(409, "consent_release_state_conflict") : error);
    }
  });

  router.post("/admin/consent-releases/:version/activate", async (req: AuthenticatedRequest, res, next) => {
    try {
      const releaseVersion = version.parse(req.params.version);
      const input = activateInput.parse(req.body);
      const release = await service.activate(
        releaseVersion,
        input.expected_revision,
        input.expected_current_release_id,
        req.user!.id
      );
      res.json({ release: serializeRelease(release) });
    } catch (error) {
      next(transactionConflict(error) ? new HttpError(409, "consent_release_state_conflict") : error);
    }
  });

  router.post("/admin/consent-releases/:version/retire", async (req: AuthenticatedRequest, res, next) => {
    try {
      const releaseVersion = version.parse(req.params.version);
      const input = retireInput.parse(req.body);
      const release = await service.retire(
        releaseVersion,
        input.expected_revision,
        input.reason,
        input.confirm_disable_onboarding,
        req.user!.id
      );
      res.json({ release: serializeRelease(release) });
    } catch (error) {
      next(transactionConflict(error) ? new HttpError(409, "consent_release_state_conflict") : error);
    }
  });

  return router;
}
