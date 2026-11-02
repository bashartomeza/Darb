import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuditAction, ConsentReleaseStatus } from "../generated/prisma/enums.js";
import {
  CONSENT_RELEASE_DOCUMENT_COUNT,
  canonicalConsentBundle,
  consentDigestMatches,
  type ConsentContentInput
} from "../lib/consentContent.js";
import { auditEvent } from "../lib/audit.js";
import { HttpError } from "../middleware/error.js";

type Db = PrismaClient | Prisma.TransactionClient;

const releaseInclude = {
  documents: { orderBy: [{ document_type: "asc" as const }, { locale: "asc" as const }] }
};

export type ConsentReleaseDraftInput = {
  version: string;
  intendedEffectiveAt: Date;
  documents: ConsentContentInput[];
};

function conflict(message = "consent_release_state_conflict"): never {
  throw new HttpError(409, message);
}

function assertCompleteRelease(release: Awaited<ReturnType<ConsentReleaseService["findByVersion"]>>) {
  if (!release || release.documents.length !== CONSENT_RELEASE_DOCUMENT_COUNT) conflict("consent_release_incomplete");
  const bundle = canonicalConsentBundle(release.documents.map((document) => ({
    type: document.document_type,
    locale: document.locale,
    content: document.content_body ?? ""
  })));
  for (const document of release.documents) {
    if (!document.content_body || !consentDigestMatches(document.content_body, document.content_digest)) {
      conflict("consent_content_integrity_failed");
    }
    const expected = bundle.find((entry) => entry.type === document.document_type && entry.locale === document.locale);
    if (!expected || expected.digest !== document.content_digest) conflict("consent_content_integrity_failed");
  }
}

async function lockAllReleases(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM consent_releases ORDER BY id FOR UPDATE`;
}

export class ConsentReleaseService {
  constructor(private readonly db: PrismaClient) {}

  findByVersion(version: string, db: Db = this.db) {
    return db.consentRelease.findUnique({ where: { version }, include: releaseInclude });
  }

  list() {
    return this.db.consentRelease.findMany({
      include: releaseInclude,
      orderBy: [{ created_at: "desc" }, { id: "desc" }]
    });
  }

  async current(now = new Date(), db: Db = this.db) {
    const releases = await db.consentRelease.findMany({
      where: { status: ConsentReleaseStatus.effective, activated_at: { lte: now }, retired_at: null },
      include: releaseInclude,
      orderBy: [{ activated_at: "desc" }, { id: "desc" }]
    });
    if (releases.length !== 1) return { ready: false as const, release: null, ambiguous: releases.length > 1 };
    const release = releases[0];
    try {
      assertCompleteRelease(release);
    } catch {
      return { ready: false as const, release: null, ambiguous: false };
    }
    const currentDocuments = release.documents.filter((document) =>
      document.legal_approved_at !== null &&
      document.effective_at <= now &&
      (document.retired_at === null || document.retired_at > now)
    );
    if (currentDocuments.length !== CONSENT_RELEASE_DOCUMENT_COUNT) {
      return { ready: false as const, release: null, ambiguous: false };
    }
    return { ready: true as const, release, ambiguous: false };
  }

  async create(input: ConsentReleaseDraftInput, actorId: string) {
    let documents;
    try {
      documents = canonicalConsentBundle(input.documents);
    } catch (error) {
      const message = error instanceof Error ? error.message : "consent_release_invalid";
      throw new HttpError(400, message);
    }
    return this.db.$transaction(async (tx) => {
      const release = await tx.consentRelease.create({
        data: {
          version: input.version,
          intended_effective_at: input.intendedEffectiveAt,
          created_by: actorId,
          documents: {
            create: documents.map((document) => ({
              document_type: document.type,
              locale: document.locale,
              version: input.version,
              content_body: document.content,
              content_digest: document.digest,
              content_reference: null,
              effective_at: input.intendedEffectiveAt,
              legal_approved_at: null,
              legal_approved_by: null,
              retired_at: null
            }))
          }
        },
        include: releaseInclude
      });
      for (const document of release.documents) {
        await auditEvent(tx, {
          userId: actorId,
          action: AuditAction.consent_document_created,
          entityType: "ConsentDocument",
          entityId: document.id,
          metadata: { release_id: release.id, version: release.version, type: document.document_type, locale: document.locale }
        });
      }
      await auditEvent(tx, {
        userId: actorId,
        action: AuditAction.admin_action,
        entityType: "ConsentRelease",
        entityId: release.id,
        metadata: { action: "consent_release_created", version: release.version, revision: release.revision }
      });
      return release;
    }, { isolationLevel: "Serializable" });
  }

  async updateDraft(version: string, expectedRevision: number, input: Omit<ConsentReleaseDraftInput, "version">, actorId: string) {
    let documents;
    try {
      documents = canonicalConsentBundle(input.documents);
    } catch (error) {
      const message = error instanceof Error ? error.message : "consent_release_invalid";
      throw new HttpError(400, message);
    }
    return this.db.$transaction(async (tx) => {
      const existing = await tx.consentRelease.findUnique({ where: { version }, include: releaseInclude });
      if (!existing) throw new HttpError(404, "consent_release_not_found");
      await tx.$queryRaw`SELECT id FROM consent_releases WHERE id = ${existing.id} FOR UPDATE`;
      const current = await tx.consentRelease.findUniqueOrThrow({ where: { id: existing.id }, include: releaseInclude });
      if (current.status !== ConsentReleaseStatus.draft || current.revision !== expectedRevision) conflict();
      if (current.documents.length !== CONSENT_RELEASE_DOCUMENT_COUNT || current.documents.some((document) => document.legal_approved_at)) {
        conflict("consent_release_not_editable");
      }
      const transitioned = await tx.consentRelease.updateMany({
        where: { id: current.id, status: ConsentReleaseStatus.draft, revision: expectedRevision },
        data: { intended_effective_at: input.intendedEffectiveAt, revision: { increment: 1 } }
      });
      if (transitioned.count !== 1) conflict();
      for (const document of documents) {
        await tx.consentDocument.update({
          where: { document_type_version_locale: { document_type: document.type, version, locale: document.locale } },
          data: {
            content_body: document.content,
            content_digest: document.digest,
            effective_at: input.intendedEffectiveAt
          }
        });
      }
      await auditEvent(tx, {
        userId: actorId,
        action: AuditAction.admin_action,
        entityType: "ConsentRelease",
        entityId: current.id,
        metadata: { action: "consent_release_draft_updated", version, previous_revision: expectedRevision, new_revision: expectedRevision + 1 }
      });
      return tx.consentRelease.findUniqueOrThrow({ where: { id: current.id }, include: releaseInclude });
    }, { isolationLevel: "Serializable" });
  }

  async approve(version: string, expectedRevision: number, actorId: string) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.consentRelease.findUnique({ where: { version }, include: releaseInclude });
      if (!existing) throw new HttpError(404, "consent_release_not_found");
      await tx.$queryRaw`SELECT id FROM consent_releases WHERE id = ${existing.id} FOR UPDATE`;
      const current = await tx.consentRelease.findUniqueOrThrow({ where: { id: existing.id }, include: releaseInclude });
      if (current.status !== ConsentReleaseStatus.draft || current.revision !== expectedRevision) conflict();
      assertCompleteRelease(current);
      const now = new Date();
      const transitioned = await tx.consentRelease.updateMany({
        where: { id: current.id, status: ConsentReleaseStatus.draft, revision: expectedRevision },
        data: {
          status: ConsentReleaseStatus.approved,
          legal_approved_at: now,
          legal_approved_by: actorId,
          revision: { increment: 1 }
        }
      });
      if (transitioned.count !== 1) conflict();
      const documents = await tx.consentDocument.updateMany({
        where: { release_id: current.id, legal_approved_at: null },
        data: { legal_approved_at: now, legal_approved_by: actorId }
      });
      if (documents.count !== CONSENT_RELEASE_DOCUMENT_COUNT) conflict("consent_release_incomplete");
      await auditEvent(tx, {
        userId: actorId,
        action: AuditAction.admin_action,
        entityType: "ConsentRelease",
        entityId: current.id,
        metadata: { action: "consent_release_legally_approved", version, previous_revision: expectedRevision, new_revision: expectedRevision + 1 }
      });
      return tx.consentRelease.findUniqueOrThrow({ where: { id: current.id }, include: releaseInclude });
    }, { isolationLevel: "Serializable" });
  }

  async activate(version: string, expectedRevision: number, expectedCurrentReleaseId: string | null, actorId: string, now = new Date()) {
    return this.db.$transaction(async (tx) => {
      await lockAllReleases(tx);
      const current = await tx.consentRelease.findUnique({ where: { version }, include: releaseInclude });
      if (!current) throw new HttpError(404, "consent_release_not_found");
      if (current.status !== ConsentReleaseStatus.approved || current.revision !== expectedRevision) conflict();
      if (current.intended_effective_at > now) conflict("consent_release_not_due");
      assertCompleteRelease(current);
      const effective = await tx.consentRelease.findMany({ where: { status: ConsentReleaseStatus.effective, retired_at: null } });
      if (effective.length > 1 || (effective[0]?.id ?? null) !== expectedCurrentReleaseId) conflict();
      if (effective[0]) {
        await tx.consentRelease.update({
          where: { id: effective[0].id },
          data: { status: ConsentReleaseStatus.retired, retired_at: now, retired_by: actorId, retirement_reason: "replaced_by_release", revision: { increment: 1 } }
        });
        await tx.consentDocument.updateMany({ where: { release_id: effective[0].id }, data: { retired_at: now } });
      }
      const transitioned = await tx.consentRelease.updateMany({
        where: { id: current.id, status: ConsentReleaseStatus.approved, revision: expectedRevision },
        data: { status: ConsentReleaseStatus.effective, activated_at: now, activated_by: actorId, revision: { increment: 1 } }
      });
      if (transitioned.count !== 1) conflict();
      const documents = await tx.consentDocument.updateMany({
        where: { release_id: current.id, legal_approved_at: { not: null }, retired_at: null },
        data: { effective_at: now }
      });
      if (documents.count !== CONSENT_RELEASE_DOCUMENT_COUNT) conflict("consent_release_incomplete");
      await auditEvent(tx, {
        userId: actorId,
        action: AuditAction.admin_action,
        entityType: "ConsentRelease",
        entityId: current.id,
        metadata: {
          action: "consent_release_made_effective",
          version,
          previous_release_id: effective[0]?.id ?? null,
          previous_revision: expectedRevision,
          new_revision: expectedRevision + 1
        }
      });
      return tx.consentRelease.findUniqueOrThrow({ where: { id: current.id }, include: releaseInclude });
    }, { isolationLevel: "Serializable" });
  }

  async retire(version: string, expectedRevision: number, reason: string, confirmDisableOnboarding: boolean, actorId: string, now = new Date()) {
    if (!confirmDisableOnboarding) throw new HttpError(400, "consent_retirement_confirmation_required");
    return this.db.$transaction(async (tx) => {
      await lockAllReleases(tx);
      const current = await tx.consentRelease.findUnique({ where: { version }, include: releaseInclude });
      if (!current) throw new HttpError(404, "consent_release_not_found");
      if (current.status !== ConsentReleaseStatus.effective || current.revision !== expectedRevision) conflict();
      const effectiveCount = await tx.consentRelease.count({ where: { status: ConsentReleaseStatus.effective, retired_at: null } });
      if (effectiveCount !== 1) conflict();
      const transitioned = await tx.consentRelease.updateMany({
        where: { id: current.id, status: ConsentReleaseStatus.effective, revision: expectedRevision },
        data: {
          status: ConsentReleaseStatus.retired,
          retired_at: now,
          retired_by: actorId,
          retirement_reason: reason,
          revision: { increment: 1 }
        }
      });
      if (transitioned.count !== 1) conflict();
      await tx.consentDocument.updateMany({ where: { release_id: current.id }, data: { retired_at: now } });
      await auditEvent(tx, {
        userId: actorId,
        action: AuditAction.admin_action,
        entityType: "ConsentRelease",
        entityId: current.id,
        metadata: {
          action: "consent_release_retired",
          version,
          previous_revision: expectedRevision,
          new_revision: expectedRevision + 1,
          onboarding_ready: false
        }
      });
      return tx.consentRelease.findUniqueOrThrow({ where: { id: current.id }, include: releaseInclude });
    }, { isolationLevel: "Serializable" });
  }
}
