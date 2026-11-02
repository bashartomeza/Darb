import { prisma } from "../lib/prisma.js";
import { CONSENT_DOCUMENT_TYPES, CONSENT_LOCALES } from "../lib/consentContent.js";
import { ConsentReleaseService } from "../services/consentReleases.js";
import bcrypt from "bcryptjs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const prefix = `consent-ci-${Date.now()}`;
const service = new ConsentReleaseService(prisma);
const checks: string[] = [];
let temporaryAdminId: string | null = null;
const check = (condition: unknown, message: string) => { assert(condition, message); checks.push(message); };

function documents(label: string) {
  return CONSENT_DOCUMENT_TYPES.flatMap((type) => CONSENT_LOCALES.map((locale) => ({
    type,
    locale,
    content: `TEST ONLY - NOT LEGAL CONTENT - ${label} - ${type}/${locale}`
  })));
}

async function cleanup() {
  const releases = await prisma.consentRelease.findMany({ where: { version: { startsWith: prefix } }, include: { documents: true } });
  const releaseIds = releases.map((release) => release.id);
  const documentIds = releases.flatMap((release) => release.documents.map((document) => document.id));
  if (documentIds.length) await prisma.auditEvent.deleteMany({ where: { entity_type: "ConsentDocument", entity_id: { in: documentIds } } });
  if (releaseIds.length) {
    await prisma.auditEvent.deleteMany({ where: { entity_type: "ConsentRelease", entity_id: { in: releaseIds } } });
    await prisma.consentDocument.deleteMany({ where: { release_id: { in: releaseIds } } });
    await prisma.consentRelease.deleteMany({ where: { id: { in: releaseIds } } });
  }
  if (temporaryAdminId) {
    await prisma.auditEvent.deleteMany({ where: { user_id: temporaryAdminId } });
    await prisma.user.deleteMany({ where: { id: temporaryAdminId, name: "TEST ONLY Consent Admin" } });
    temporaryAdminId = null;
  }
}

async function main() {
  const database = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  assert(database.endsWith("_ci"), "Consent integration refuses a non-CI database");
  await cleanup();
  let admin = await prisma.user.findFirst({ where: { role: "admin", account_status: "active" } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        name: "TEST ONLY Consent Admin",
        phone: "+12025550199",
        password_hash: await bcrypt.hash("TEST ONLY integration password", 10),
        role: "admin",
        account_status: "active",
        demo_account: false
      }
    });
    temporaryAdminId = admin.id;
  }
  const past = new Date(Date.now() - 60_000);

  const editVersion = `${prefix}-edit`;
  const draft = await service.create({ version: editVersion, intendedEffectiveAt: past, documents: documents("draft") }, admin.id);
  check(draft.documents.length === 6 && draft.documents.every((document) => /^[a-f0-9]{64}$/.test(document.content_digest)), "draft creates six server-digested documents atomically");
  const edits = await Promise.allSettled([
    service.updateDraft(editVersion, 1, { intendedEffectiveAt: past, documents: documents("admin-a") }, admin.id),
    service.updateDraft(editVersion, 1, { intendedEffectiveAt: past, documents: documents("admin-b") }, admin.id)
  ]);
  check(edits.filter((result) => result.status === "fulfilled").length === 1 && edits.filter((result) => result.status === "rejected").length === 1, "concurrent draft edits allow one revision transition");

  const editCurrent = await service.findByVersion(editVersion);
  assert(editCurrent, "edited release missing");
  const approvals = await Promise.allSettled([
    service.approve(editVersion, editCurrent.revision, admin.id),
    service.approve(editVersion, editCurrent.revision, admin.id)
  ]);
  check(approvals.filter((result) => result.status === "fulfilled").length === 1 && approvals.filter((result) => result.status === "rejected").length === 1, "concurrent approval is one logical transition");
  const approved = await service.findByVersion(editVersion);
  assert(approved, "approved release missing");
  let approvedEditBlocked = false;
  try {
    await service.updateDraft(editVersion, approved.revision, { intendedEffectiveAt: past, documents: documents("forbidden") }, admin.id);
  } catch { approvedEditBlocked = true; }
  check(approvedEditBlocked, "approved content is immutable through the service");

  const activations = await Promise.allSettled([
    service.activate(editVersion, approved.revision, null, admin.id),
    service.activate(editVersion, approved.revision, null, admin.id)
  ]);
  check(activations.filter((result) => result.status === "fulfilled").length === 1 && activations.filter((result) => result.status === "rejected").length === 1, "concurrent activation is one logical transition");
  const first = await service.findByVersion(editVersion);
  assert(first?.status === "effective", "first release did not become effective");

  const replacementVersion = `${prefix}-replacement`;
  const replacementDraft = await service.create({ version: replacementVersion, intendedEffectiveAt: past, documents: documents("replacement") }, admin.id);
  const replacementApproved = await service.approve(replacementVersion, replacementDraft.revision, admin.id);
  const replacement = await service.activate(replacementVersion, replacementApproved.revision, first.id, admin.id);
  const retiredFirst = await service.findByVersion(editVersion);
  check(retiredFirst?.status === "retired" && retiredFirst.retired_at?.getTime() === replacement.activated_at?.getTime(), "replacement retires old and activates new at one boundary");
  const current = await service.current();
  check(current.ready && current.release.id === replacement.id && current.release.documents.length === 6, "current release is complete and unambiguous");

  const raceVersion = `${prefix}-race`;
  const raceDraft = await service.create({ version: raceVersion, intendedEffectiveAt: past, documents: documents("race") }, admin.id);
  const raceApproved = await service.approve(raceVersion, raceDraft.revision, admin.id);
  const race = await Promise.allSettled([
    service.activate(raceVersion, raceApproved.revision, replacement.id, admin.id),
    service.retire(replacementVersion, replacement.revision, "TEST ONLY retirement race", true, admin.id)
  ]);
  check(race.filter((result) => result.status === "fulfilled").length === 1, "activation racing retirement serializes to one transition");
  const effective = await prisma.consentRelease.findMany({ where: { version: { startsWith: prefix }, status: "effective", retired_at: null }, include: { documents: true } });
  check(effective.length <= 1 && effective.every((release) => release.documents.length === 6), "race leaves no overlapping or partial current set");

  const audit = await prisma.auditEvent.findMany({ where: { entity_type: "ConsentRelease", entity_id: { in: [draft.id, replacement.id, raceDraft.id] } }, select: { metadata: true } });
  const auditText = JSON.stringify(audit);
  check(audit.length >= 5 && !auditText.includes("TEST ONLY - NOT LEGAL CONTENT"), "workflow audit covers transitions without legal content");
  console.log(`Consent management MySQL integration passed: ${checks.length} checks`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Consent management integration failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
