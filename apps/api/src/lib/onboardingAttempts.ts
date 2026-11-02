import type { PrismaClient } from "../generated/prisma/client.js";
import type { OnboardingRole } from "../generated/prisma/enums.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "./audit.js";
import { phoneDigest, type VersionedKey } from "./keyedDigest.js";
import { normalizePhoneToE164, phoneLast4 } from "./phone.js";

export async function createOnboardingAttempt(
  db: PrismaClient,
  input: {
    invitationId: string;
    intendedRole: OnboardingRole;
    phone: string;
    region?: string;
    phoneKey: VersionedKey;
    expiresAt: Date;
    requestIpDigest?: string;
    requestIpDigestVersion?: number;
    requestId?: string;
    now?: Date;
  }
) {
  const phoneE164 = normalizePhoneToE164(input.phone, { region: input.region });
  const normalizedPhoneDigest = phoneDigest(phoneE164, input.phoneKey);
  const now = input.now ?? new Date();
  if (input.expiresAt <= now) throw new Error("onboarding_attempt_expiry_invalid");
  return db.$transaction(async (tx) => {
    const invitation = await tx.invitation.findFirst({
      where: {
        id: input.invitationId,
        intended_role: input.intendedRole,
        intended_phone_digest: normalizedPhoneDigest,
        phone_digest_version: input.phoneKey.version,
        max_uses: 1,
        used_count: 0,
        revoked_at: null,
        expires_at: { gt: now }
      },
      select: { id: true }
    });
    if (!invitation) throw new Error("onboarding_invitation_mismatch");
    const attempt = await tx.onboardingAttempt.create({
      data: {
        invitation_id: input.invitationId,
        intended_role: input.intendedRole,
        phone_e164: phoneE164,
        phone_digest: normalizedPhoneDigest,
        phone_digest_version: input.phoneKey.version,
        phone_last4: phoneLast4(phoneE164),
        request_ip_digest: input.requestIpDigest,
        request_ip_digest_version: input.requestIpDigestVersion,
        created_request_id: input.requestId,
        expires_at: input.expiresAt
      }
    });
    await auditEvent(tx, {
      action: AuditAction.onboarding_attempt_created,
      entityType: "OnboardingAttempt",
      entityId: attempt.id,
      metadata: { invitation_id: input.invitationId, intended_role: input.intendedRole, request_id: input.requestId ?? null }
    });
    return attempt;
  });
}
