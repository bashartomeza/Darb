import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { OnboardingRole } from "../generated/prisma/enums.js";
import { invitationCodeDigest, keyedDigestMatches, phoneDigest, type VersionedKey } from "./keyedDigest.js";
import { normalizePhoneToE164, phoneLast4 } from "./phone.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "./audit.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateInvitationCode() {
  let value = BigInt(`0x${randomBytes(13).toString("hex")}`) >> 4n;
  let code = "";
  for (let index = 0; index < 20; index += 1) {
    code = CROCKFORD[Number(value & 31n)] + code;
    value >>= 5n;
  }
  return code.match(/.{1,5}/g)!.join("-");
}

export function normalizeInvitationCode(code: string) {
  const normalized = code.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[0-9A-HJKMNP-TV-Z]{20}$/.test(normalized)) throw new Error("invalid_invitation_code");
  return normalized;
}

type InvitationKeys = { code: VersionedKey; phone: VersionedKey };

export async function createInvitation(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    createdById: string;
    intendedRole: OnboardingRole;
    intendedPhone?: string;
    contactEmail?: string;
    phoneRegion?: string;
    campaign?: string;
    source?: string;
    expiresAt: Date;
    keys: InvitationKeys;
  }
) {
  if (!input.intendedPhone) throw new Error("invitation_phone_required");
  const canonicalPhone = normalizePhoneToE164(input.intendedPhone, { region: input.phoneRegion });
  for (let collisionAttempt = 0; collisionAttempt < 5; collisionAttempt += 1) {
    const rawCode = generateInvitationCode();
    const normalizedCode = normalizeInvitationCode(rawCode);
    try {
      const invitation = await db.invitation.create({
        data: {
          code_digest: invitationCodeDigest(normalizedCode, input.keys.code),
          code_key_version: input.keys.code.version,
          intended_role: input.intendedRole,
          intended_phone_digest: phoneDigest(canonicalPhone, input.keys.phone),
          phone_digest_version: input.keys.phone.version,
          phone_last4: phoneLast4(canonicalPhone),
          contact_email: input.contactEmail ?? null,
          campaign: input.campaign,
          source: input.source,
          expires_at: input.expiresAt,
          created_by_id: input.createdById
        }
      });
      return { invitation, code: rawCode };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
  throw new Error("invitation_code_generation_failed");
}

export async function consumeInvitation(
  db: PrismaClient,
  input: { invitationId: string; onboardingAttemptId: string; userId?: string; now?: Date }
) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const attempt = await tx.onboardingAttempt.findFirst({
      where: {
        id: input.onboardingAttemptId,
        invitation_id: input.invitationId,
        status: "created",
        expires_at: { gt: now }
      },
      select: {
        id: true,
        intended_role: true,
        phone_e164: true,
        phone_digest: true,
        phone_digest_version: true
      }
    });
    if (!attempt) return { consumed: false as const };
    if (input.userId) {
      const user = await tx.user.findFirst({
        where: { id: input.userId, role: attempt.intended_role, phone: attempt.phone_e164 },
        select: { id: true }
      });
      if (!user) return { consumed: false as const };
    }
    const consumed = await tx.invitation.updateMany({
      where: {
        id: input.invitationId,
        intended_role: attempt.intended_role,
        intended_phone_digest: attempt.phone_digest,
        phone_digest_version: attempt.phone_digest_version,
        max_uses: 1,
        revoked_at: null,
        expires_at: { gt: now },
        used_count: { lt: 1 }
      },
      data: { used_count: { increment: 1 }, last_used_at: now }
    });
    if (consumed.count !== 1) return { consumed: false as const };
    const redemption = await tx.invitationRedemption.create({
      data: {
        invitation_id: input.invitationId,
        onboarding_attempt_id: input.onboardingAttemptId,
        user_id: input.userId,
        redeemed_at: now
      }
    });
    await auditEvent(tx, {
      action: AuditAction.invitation_consumed,
      entityType: "Invitation",
      entityId: input.invitationId,
      metadata: { onboarding_attempt_id: input.onboardingAttemptId }
    });
    return { consumed: true as const, redemption };
  });
}

export async function revokeInvitation(
  db: PrismaClient,
  input: { invitationId: string; revokedById: string; reason: string; now?: Date }
) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const current = await tx.invitation.findUnique({ where: { id: input.invitationId } });
    if (!current) return { kind: "not_found" as const };
    if (current.revoked_at) return { kind: "revoked" as const, invitation: current };
    if (current.used_count > 0) return { kind: "consumed" as const, invitation: current };
    const updated = await tx.invitation.updateMany({
      where: { id: current.id, revoked_at: null, used_count: 0 },
      data: { revoked_at: now, revoked_by_id: input.revokedById, revoke_reason: input.reason }
    });
    if (updated.count !== 1) return { kind: "race_lost" as const };
    return { kind: "revoked" as const, invitation: await tx.invitation.findUniqueOrThrow({ where: { id: current.id } }) };
  });
}

export async function findUsableInvitationByCode(
  db: PrismaClient,
  input: { code: string; key: VersionedKey; phoneE164?: string; phoneKey?: VersionedKey; now?: Date }
) {
  const normalized = normalizeInvitationCode(input.code);
  const invitation = await db.invitation.findUnique({
    where: { code_digest: invitationCodeDigest(normalized, input.key) }
  });
  const now = input.now ?? new Date();
  if (!invitation || invitation.code_key_version !== input.key.version || invitation.revoked_at || invitation.expires_at <= now || invitation.used_count >= invitation.max_uses) {
    return null;
  }
  if (invitation.intended_phone_digest) {
    if (!input.phoneE164 || !input.phoneKey || invitation.phone_digest_version !== input.phoneKey.version) return null;
    if (!keyedDigestMatches(invitation.intended_phone_digest, "masari:phone", input.phoneE164, input.phoneKey)) return null;
  }
  return invitation;
}
