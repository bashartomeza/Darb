import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { revokeAllUserSessions } from "../lib/refreshTokens.js";
import { canonicalEmail, newPassword } from "./emailAuth.js";

/** Same cost the API uses for every password hash (services/emailAuth.ts). */
export const ADMIN_BCRYPT_COST = 12;
/** Staff accounts: the runbook requires 16 or more characters; the shared newPassword rule (12..72 bytes) also applies. */
export const ADMIN_MIN_PASSWORD_LENGTH = 16;

export class AdminBootstrapError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const adminName = z.string().trim().min(1).max(120);

export function validateAdminInput(input: { email: string; name?: string; password?: string }) {
  const email = canonicalEmail.safeParse(input.email);
  if (!email.success) throw new AdminBootstrapError("invalid_email");
  let name: string | undefined;
  if (input.name !== undefined) {
    const parsed = adminName.safeParse(input.name);
    if (!parsed.success) throw new AdminBootstrapError("invalid_name");
    name = parsed.data;
  }
  if (input.password !== undefined) {
    if ([...input.password].length < ADMIN_MIN_PASSWORD_LENGTH) throw new AdminBootstrapError("password_too_short");
    if (!newPassword.safeParse(input.password).success) throw new AdminBootstrapError("password_invalid");
  }
  return { email: email.data, name };
}

export type DatabaseGuard = {
  demoFeaturesEnabled: boolean;
  databaseName: string;
  demoResetAllowedDatabases: string[];
  allowDemoDatabase: boolean;
};

/** Refuses to touch a demo/test database: demo features on, a reset-allowed database name, or demo accounts present. */
export async function assertNotDemoDatabase(db: Pick<PrismaClient, "user">, guard: DatabaseGuard) {
  if (guard.allowDemoDatabase) return;
  if (guard.demoFeaturesEnabled) throw new AdminBootstrapError("demo_environment_refused");
  if (guard.demoResetAllowedDatabases.includes(guard.databaseName)) throw new AdminBootstrapError("demo_database_refused");
  if ((await db.user.count({ where: { demo_account: true } })) > 0) throw new AdminBootstrapError("demo_accounts_present_refused");
}

export type AdminBootstrapResult = {
  action: "created" | "password_reset";
  dryRun: boolean;
  email: string;
  userId?: string;
};

export async function createOrResetAdmin(
  db: PrismaClient,
  input: { email: string; name?: string; password: string; resetPassword: boolean; dryRun: boolean; guard: DatabaseGuard }
): Promise<AdminBootstrapResult> {
  const { email, name } = validateAdminInput(input);
  await assertNotDemoDatabase(db, input.guard);
  const existing = await db.user.findUnique({ where: { email } });

  if (input.resetPassword) {
    if (!existing || existing.role !== "admin") throw new AdminBootstrapError("admin_not_found");
    if (input.dryRun) return { action: "password_reset", dryRun: true, email, userId: existing.id };
    const passwordHash = await bcrypt.hash(input.password, ADMIN_BCRYPT_COST);
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.id },
        data: { password_hash: passwordHash, security_version: { increment: 1 }, email_verified_at: existing.email_verified_at ?? now }
      });
      await revokeAllUserSessions(tx, { userId: existing.id, reason: "admin_password_reset", now });
      await auditEvent(tx, {
        userId: existing.id,
        action: AuditAction.admin_action,
        entityType: "User",
        entityId: existing.id,
        metadata: { operation: "admin_password_reset_cli", source: "cli" }
      });
    });
    return { action: "password_reset", dryRun: false, email, userId: existing.id };
  }

  if (existing) throw new AdminBootstrapError("email_already_exists");
  if (!name) throw new AdminBootstrapError("name_required");
  if (input.dryRun) return { action: "created", dryRun: true, email };
  const passwordHash = await bcrypt.hash(input.password, ADMIN_BCRYPT_COST);
  const now = new Date();
  const id = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id,
        name,
        email,
        email_verified_at: now,
        password_hash: passwordHash,
        role: "admin",
        account_status: "active",
        profile_state: "complete",
        status_updated_at: now,
        demo_account: false
      }
    });
    await auditEvent(tx, {
      userId: id,
      action: AuditAction.admin_action,
      entityType: "User",
      entityId: id,
      metadata: { operation: "admin_created_cli", source: "cli" }
    });
  });
  return { action: "created", dryRun: false, email, userId: id };
}

export type AdminListRow = { email: string | null; account_status: string; created_at: Date; last_login_at: Date | null };

/** Read-only. Selects no hash or other secret column. */
export async function listAdmins(db: Pick<PrismaClient, "user">): Promise<AdminListRow[]> {
  return db.user.findMany({
    where: { role: "admin" },
    select: { email: true, account_status: true, created_at: true, last_login_at: true },
    orderBy: { created_at: "asc" }
  });
}
