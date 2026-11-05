import { randomInt, randomUUID } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { AuditAction } from "../generated/prisma/enums.js";
import { auditEvent } from "../lib/audit.js";
import { isValidNewPassword } from "../lib/passwordRule.js";
import { normalizeContactPhone } from "../lib/phone.js";
import { revokeAllUserSessions } from "../lib/refreshTokens.js";
import { ADMIN_BCRYPT_COST } from "./adminBootstrap.js";
import { ConsentReleaseService } from "./consentReleases.js";
import { legacyRouteCapacityFromProfile } from "./legacyDriverOnlineState.js";
import { isLegacyRouteTimely } from "./legacyCapacity.js";
import {
  PREDEFINED_ROUTE_PAIRS,
  driverRoutePlaces,
  ensurePredefinedRoutes,
  operatingRouteKey,
  resolveOperatingRouteByKey
} from "./operatingRoutes.js";

/**
 * Test drivers for the owner to try rider requests on the live app: driver1 ...
 * driver20, one per predefined operating route, each approved and online.
 *
 * Marker: the account's email is driverN@darb.ps AND an admin_action audit event
 * "test_driver_seed_created" names the user. Both are needed for --remove and for
 * every update, so a real account that happens to use such an address is never
 * touched. The accounts are NOT demo accounts (demo_account=false): a demo flag
 * would make the admin CLI refuse the database ("demo_accounts_present_refused");
 * demo reset already refuses any database holding a non-demo user, so the test
 * drivers add no new block there.
 *
 * The online route has no departure time and no window end, exactly like a route
 * opened by the app's go-online switch, so it never expires. Re-running the
 * script repairs anything that changed (offline route, rejected profile, ...).
 */
export const TEST_DRIVER_EMAIL_DOMAIN = "darb.ps";
export const TEST_DRIVER_CREATED_OPERATION = "test_driver_seed_created";
export const TEST_DRIVER_REMOVED_OPERATION = "test_driver_seed_removed";
export const TEST_DRIVER_PASSWORD_LENGTH = 20;
const CONSENT_SOURCE = "test_driver_seed";
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export class TestDriverSeedError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Every mode of the CLI needs this flag, so the accounts are never touched by accident. */
export function requireTestAccountConfirmation(flags: ReadonlySet<string>) {
  if (!flags.has("confirm-test-accounts")) throw new TestDriverSeedError("confirm_test_accounts_flag_required");
}

export type TestDriverSpec = { n: number; email: string; name: string; phone: string; routeKey: string; plate: string };

/** driver k <-> the k-th predefined route: pairs in listed order, outbound then inbound. */
export function predefinedRouteKeysInOrder() {
  return PREDEFINED_ROUTE_PAIRS.flatMap(([first, second]) => [
    operatingRouteKey(first, second),
    operatingRouteKey(second, first)
  ]);
}

export function testDriverSpecs(): TestDriverSpec[] {
  return predefinedRouteKeysInOrder().map((routeKey, index) => {
    const n = index + 1;
    return {
      n,
      email: `driver${n}@${TEST_DRIVER_EMAIL_DOMAIN}`,
      name: `Test Driver ${n}`,
      // 0599000001 ... : test-looking Palestinian mobile numbers, stored as E.164 like sign-up does.
      phone: normalizeContactPhone(`0599${String(n).padStart(6, "0")}`),
      routeKey,
      plate: `TEST-${String(n).padStart(2, "0")}`
    };
  });
}

export function generateTestPassword(length = TEST_DRIVER_PASSWORD_LENGTH) {
  for (;;) {
    let value = "";
    for (let i = 0; i < length; i += 1) value += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    if (isValidNewPassword(value) && /[A-Za-z]/.test(value) && /[0-9]/.test(value)) return value;
  }
}

export type TestDriverSeedOptions = {
  dryRun: boolean;
  resetPasswords: boolean;
  credentialsFile?: string;
  force: boolean;
  bcryptCost?: number;
  now?: Date;
};

type Counters = {
  created: number;
  updated: number;
  unchanged: number;
  routesCreated: number;
  routesReplaced: number;
  routesKept: number;
  routesBusy: number;
  consentsRecorded: number;
};

export type TestDriverSeedResult = Counters & {
  dryRun: boolean;
  total: number;
  passwordsWritten: number;
  consentRelease: "recorded" | "none_effective";
  credentialsFileWritten: boolean;
};

type Tx = Prisma.TransactionClient;
type Db = PrismaClient;

async function ownedUsers(db: Db | Tx, emails: string[]) {
  const users = await db.user.findMany({
    where: { email: { in: emails } },
    include: { driver_profile: true, driver_verification: true }
  });
  const events = users.length
    ? await db.auditEvent.findMany({
        where: { action: AuditAction.admin_action, entity_type: "User", entity_id: { in: users.map((user) => user.id) } },
        select: { entity_id: true, metadata: true }
      })
    : [];
  const owned = new Set(
    events
      .filter((event) => (event.metadata as { operation?: string } | null)?.operation === TEST_DRIVER_CREATED_OPERATION)
      .map((event) => event.entity_id)
  );
  return users.map((user) => ({ user, owned: owned.has(user.id) }));
}

function profileData(spec: TestDriverSpec) {
  return {
    vehicle_type: "sedan",
    seats_total: 4,
    parcel_capacity: 5,
    vehicle_make_model: "TEST Toyota Corolla",
    vehicle_color: "White",
    plate_number: spec.plate,
    national_id_number: `TEST-NID-${String(spec.n).padStart(6, "0")}`,
    licence_number: `TEST-LIC-${String(spec.n).padStart(6, "0")}`,
    verified: true
  };
}

type Existing = Awaited<ReturnType<typeof ownedUsers>>[number]["user"];

async function syncDriver(
  tx: Tx,
  input: {
    spec: TestDriverSpec;
    existing: Existing | undefined;
    passwordHash: string | null;
    now: Date;
    adminId: string | null;
    consentDocumentIds: string[];
    write: boolean;
    counters: Counters;
  }
) {
  const { spec, existing, passwordHash, now, adminId, write, counters } = input;
  const wanted = profileData(spec);
  const userId = existing?.id ?? randomUUID();
  let changed = false;

  if (!existing) {
    changed = true;
    counters.created += 1;
    if (write) {
      await tx.user.create({
        data: {
          id: userId,
          name: spec.name,
          email: spec.email,
          email_verified_at: now,
          contact_phone: spec.phone,
          password_hash: passwordHash,
          role: "driver",
          account_status: "active",
          profile_state: "complete",
          status_updated_at: now,
          review_submitted_at: now,
          demo_account: false
        }
      });
      await tx.driverProfile.create({ data: { user_id: userId, ...wanted } });
      const verification = await tx.driverVerification.create({
        data: { user_id: userId, status: "approved", reviewed_at: now, reviewed_by_id: adminId }
      });
      await tx.driverVerificationDecision.create({
        data: { verification_id: verification.id, revision: verification.revision, decision: "approved", decided_by_id: adminId }
      });
    }
  } else {
    const userOk =
      existing.name === spec.name &&
      existing.contact_phone === spec.phone &&
      existing.role === "driver" &&
      existing.account_status === "active" &&
      existing.profile_state === "complete" &&
      Boolean(existing.email_verified_at);
    const current = existing.driver_profile as Record<string, unknown> | null;
    const profileOk = Boolean(current) && Object.entries(wanted).every(([key, value]) => current![key] === value);
    const verificationOk = existing.driver_verification?.status === "approved";
    if (!userOk || passwordHash) {
      changed = true;
      if (write) {
        await tx.user.update({
          where: { id: userId },
          data: {
            name: spec.name,
            contact_phone: spec.phone,
            role: "driver",
            account_status: "active",
            profile_state: "complete",
            status_updated_at: now,
            email_verified_at: existing.email_verified_at ?? now,
            ...(passwordHash ? { password_hash: passwordHash, security_version: { increment: 1 } } : {})
          }
        });
        if (passwordHash) await revokeAllUserSessions(tx, { userId, reason: "test_driver_password_reset", now });
      }
    }
    if (!profileOk) {
      changed = true;
      if (write) await tx.driverProfile.upsert({ where: { user_id: userId }, create: { user_id: userId, ...wanted }, update: wanted });
    }
    if (!verificationOk) {
      changed = true;
      if (write) {
        const verification = await tx.driverVerification.upsert({
          where: { user_id: userId },
          create: { user_id: userId, status: "approved", reviewed_at: now, reviewed_by_id: adminId },
          update: { status: "approved", rejection_reason: null, reviewed_at: now, reviewed_by_id: adminId, documents_expired_at: null }
        });
        await tx.driverVerificationDecision.create({
          data: { verification_id: verification.id, revision: verification.revision, decision: "approved", decided_by_id: adminId }
        });
      }
    }
  }

  // Consents of the current release, when one is in force.
  if (input.consentDocumentIds.length) {
    const have = existing
      ? await tx.userConsent.findMany({ where: { user_id: userId, consent_document_id: { in: input.consentDocumentIds } }, select: { consent_document_id: true } })
      : [];
    const haveIds = new Set(have.map((row) => row.consent_document_id));
    const missing = input.consentDocumentIds.filter((id) => !haveIds.has(id));
    if (missing.length) {
      changed = true;
      counters.consentsRecorded += missing.length;
      if (write) {
        await tx.userConsent.createMany({
          data: missing.map((documentId) => ({ user_id: userId, consent_document_id: documentId, accepted_at: now, source: CONSENT_SOURCE }))
        });
      }
    }
  }

  // Exactly one online (active) route on the driver's own predefined route.
  const profile = existing?.driver_profile ?? (write ? await tx.driverProfile.findUniqueOrThrow({ where: { user_id: userId } }) : null);
  const live = profile
    ? await tx.driverRoute.findMany({
        where: { driver_id: profile.id, operational_mode: "legacy", status: { in: ["active", "assigned", "on_trip"] } },
        select: { id: true, status: true, corridor_key: true, departure_at: true, departed_at: true, availability_window_end: true }
      })
    : [];
  if (live.some((route) => route.status !== "active")) {
    counters.routesBusy += 1;
  } else if (live.length === 1 && live[0]!.corridor_key === spec.routeKey && isLegacyRouteTimely(live[0]!, now)) {
    counters.routesKept += 1;
  } else {
    const operating = await resolveOperatingRouteByKey(tx, spec.routeKey);
    if (live.length) {
      counters.routesReplaced += 1;
      if (write) {
        await tx.driverRoute.updateMany({ where: { id: { in: live.map((route) => route.id) } }, data: { status: "inactive", completed_at: now } });
      }
    }
    counters.routesCreated += 1;
    changed = true;
    if (write && profile) {
      const route = await tx.driverRoute.create({
        data: {
          driver_id: profile.id,
          ...driverRoutePlaces(operating),
          ...legacyRouteCapacityFromProfile(profile),
          status: "active",
          operational_mode: "legacy",
          activated_at: now
        }
      });
      await auditEvent(tx, {
        userId,
        action: AuditAction.driver_route_created,
        entityType: "DriverRoute",
        entityId: route.id,
        metadata: { transition: "offline_to_online", source: "test_driver_seed", service_route_id: operating.serviceRouteId }
      });
    }
  }

  if (existing) counters[changed ? "updated" : "unchanged"] += 1;
  if (write && (!existing || changed)) {
    await auditEvent(tx, {
      userId,
      action: AuditAction.admin_action,
      entityType: "User",
      entityId: userId,
      metadata: {
        operation: existing ? "test_driver_seed_updated" : TEST_DRIVER_CREATED_OPERATION,
        source: "cli",
        driver_number: spec.n,
        route_key: spec.routeKey,
        password_reset: Boolean(existing && passwordHash)
      }
    });
  }
}

export async function seedTestDrivers(db: Db, options: TestDriverSeedOptions): Promise<TestDriverSeedResult> {
  const specs = testDriverSpecs();
  const now = options.now ?? new Date();
  const write = !options.dryRun;
  if (write && !options.credentialsFile) throw new TestDriverSeedError("credentials_file_required");
  if (write && options.credentialsFile && existsSync(options.credentialsFile) && !options.force) {
    throw new TestDriverSeedError("credentials_file_exists");
  }
  if (write) await ensurePredefinedRoutes(db);

  const found = await ownedUsers(db, specs.map((spec) => spec.email));
  const byEmail = new Map(found.map((entry) => [entry.user.email, entry]));
  if (found.some((entry) => !entry.owned)) throw new TestDriverSeedError("email_in_use_by_another_account");

  for (const spec of specs) {
    try {
      await resolveOperatingRouteByKey(db, spec.routeKey);
    } catch {
      throw new TestDriverSeedError(`route_missing:${spec.routeKey}`);
    }
  }

  const release = await new ConsentReleaseService(db).current(now);
  const consentDocumentIds = release.ready ? release.release.documents.filter((document) => document.locale === "ar").map((document) => document.id) : [];
  const admin = await db.user.findFirst({ where: { role: "admin" }, orderBy: [{ created_at: "asc" }, { id: "asc" }], select: { id: true } });

  const counters: Counters = { created: 0, updated: 0, unchanged: 0, routesCreated: 0, routesReplaced: 0, routesKept: 0, routesBusy: 0, consentsRecorded: 0 };
  const lines: string[] = [];
  const cost = options.bcryptCost ?? ADMIN_BCRYPT_COST;
  for (const spec of specs) {
    const entry = byEmail.get(spec.email);
    // Only a new account, or an explicit --reset-passwords, gets a password.
    const password = !entry || options.resetPasswords ? generateTestPassword() : null;
    const passwordHash = password && write ? await bcrypt.hash(password, cost) : password ? "dry-run" : null;
    const run = (tx: Tx) =>
      syncDriver(tx, { spec, existing: entry?.user, passwordHash, now, adminId: admin?.id ?? null, consentDocumentIds, write, counters });
    if (write) await db.$transaction(run);
    else await run(db as unknown as Tx);
    if (password) lines.push(`${spec.email} | ${password} | ${spec.routeKey}`);
  }

  let credentialsFileWritten = false;
  if (write && lines.length) {
    try {
      writeFileSync(options.credentialsFile!, `${lines.join("\n")}\n`, { mode: 0o600, flag: options.force ? "w" : "wx" });
      chmodSync(options.credentialsFile!, 0o600);
      credentialsFileWritten = true;
    } catch {
      throw new TestDriverSeedError("credentials_file_write_failed_rerun_with_reset_passwords_and_force");
    }
  }
  return {
    dryRun: options.dryRun,
    total: specs.length,
    ...counters,
    passwordsWritten: credentialsFileWritten ? lines.length : 0,
    consentRelease: release.ready ? "recorded" : "none_effective",
    credentialsFileWritten
  };
}

export type RemoveResult = { dryRun: boolean; matched: number; removed: number; suspended: number; skippedNotOwned: number };

/** Removes only accounts that carry both the test address and the creation audit marker. */
export async function removeTestDrivers(db: Db, options: { dryRun: boolean; now?: Date }): Promise<RemoveResult> {
  const now = options.now ?? new Date();
  const found = await ownedUsers(db, testDriverSpecs().map((spec) => spec.email));
  const own = found.filter((entry) => entry.owned && entry.user.role === "driver");
  const result: RemoveResult = { dryRun: options.dryRun, matched: own.length, removed: 0, suspended: 0, skippedNotOwned: found.length - own.length };
  if (options.dryRun) return result;
  for (const { user } of own) {
    try {
      await db.$transaction(async (tx) => {
        await tx.userConsent.deleteMany({ where: { user_id: user.id } });
        await tx.user.delete({ where: { id: user.id } });
      });
      result.removed += 1;
    } catch {
      // Trip or match history keeps the row: take the driver offline and suspend the account instead.
      await db.$transaction(async (tx) => {
        if (user.driver_profile) {
          await tx.driverRoute.updateMany({ where: { driver_id: user.driver_profile.id, status: "active" }, data: { status: "inactive", completed_at: now } });
        }
        await tx.user.update({ where: { id: user.id }, data: { account_status: "suspended", status_updated_at: now, security_version: { increment: 1 } } });
        await revokeAllUserSessions(tx, { userId: user.id, reason: "test_driver_removed", now });
      });
      result.suspended += 1;
    }
  }
  await auditEvent(db, {
    action: AuditAction.admin_action,
    entityType: "TestDriverSeed",
    metadata: { operation: TEST_DRIVER_REMOVED_OPERATION, source: "cli", removed: result.removed, suspended: result.suspended }
  });
  return result;
}
