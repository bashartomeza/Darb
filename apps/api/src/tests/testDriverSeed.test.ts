import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ ready: false }));

vi.mock("../lib/refreshTokens.js", () => ({ revokeAllUserSessions: vi.fn(async () => undefined) }));
vi.mock("../services/consentReleases.js", () => ({
  ConsentReleaseService: class {
    async current() {
      return consent.ready
        ? { ready: true, release: { documents: [{ id: "doc-ar-1", locale: "ar" }, { id: "doc-ar-2", locale: "ar" }, { id: "doc-en-1", locale: "en" }] } }
        : { ready: false, release: null };
    }
  }
}));
vi.mock("../services/operatingRoutes.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/operatingRoutes.js")>();
  return {
    ...original,
    ensurePredefinedRoutes: vi.fn(async () => undefined),
    resolveOperatingRouteByKey: vi.fn(async (_db: unknown, routeKey: string) => ({
      routeKey,
      serviceRouteId: `sr-${routeKey}`,
      routeVersionId: `rv-${routeKey}`,
      origin: { nameEn: "A", latitude: "31.1", longitude: "35.1" },
      destination: { nameEn: "B", latitude: "31.2", longitude: "35.2" }
    }))
  };
});

const { PASSWORD_MIN_CHARACTERS, isValidNewPassword } = await import("../lib/passwordRule.js");
const { PREDEFINED_ROUTE_PAIRS } = await import("../services/operatingRoutes.js");
const { generateTestPassword, requireTestAccountConfirmation, removeTestDrivers, seedTestDrivers, testDriverSpecs } = await import("../services/testDriverSeed.js");
const { parseCliArgs } = await import("../scripts/adminCliInput.js");

type Row = Record<string, any>;

function fakeDb(options: { failUserDelete?: boolean } = {}) {
  const t = { users: [] as Row[], profiles: [] as Row[], verifications: [] as Row[], decisions: [] as Row[], consents: [] as Row[], routes: [] as Row[], audits: [] as Row[] };
  let id = 0;
  const next = (prefix: string) => `${prefix}${++id}`;
  const db: any = {
    user: {
      findMany: async ({ where }: Row) =>
        t.users
          .filter((u) => where.email.in.includes(u.email))
          .map((u) => ({ ...u, driver_profile: t.profiles.find((p) => p.user_id === u.id) ?? null, driver_verification: t.verifications.find((v) => v.user_id === u.id) ?? null })),
      findFirst: async () => null,
      create: async ({ data }: Row) => { t.users.push({ ...data }); return data; },
      update: async ({ where, data }: Row) => {
        const user = t.users.find((u) => u.id === where.id)!;
        for (const [k, v] of Object.entries(data)) user[k] = v && typeof v === "object" && "increment" in (v as Row) ? (user[k] ?? 0) + (v as Row).increment : v;
        return user;
      },
      delete: async ({ where }: Row) => {
        if (options.failUserDelete) throw new Error("fk");
        t.users = t.users.filter((u) => u.id !== where.id);
      }
    },
    auditEvent: {
      findMany: async ({ where }: Row) => t.audits.filter((a) => a.action === where.action && a.entity_type === where.entity_type && where.entity_id.in.includes(a.entity_id)),
      create: async ({ data }: Row) => { t.audits.push({ ...data }); }
    },
    driverProfile: {
      create: async ({ data }: Row) => { const row = { id: next("p"), trust_score: 70, ...data }; t.profiles.push(row); return row; },
      upsert: async ({ where, create, update }: Row) => {
        const found = t.profiles.find((p) => p.user_id === where.user_id);
        if (found) return Object.assign(found, update);
        const row = { id: next("p"), ...create }; t.profiles.push(row); return row;
      },
      findUniqueOrThrow: async ({ where }: Row) => t.profiles.find((p) => p.user_id === where.user_id)!
    },
    driverVerification: {
      create: async ({ data }: Row) => { const row = { id: next("v"), revision: 1, ...data }; t.verifications.push(row); return row; },
      upsert: async ({ where, create, update }: Row) => {
        const found = t.verifications.find((v) => v.user_id === where.user_id);
        if (found) return Object.assign(found, update);
        const row = { id: next("v"), revision: 1, ...create }; t.verifications.push(row); return row;
      }
    },
    driverVerificationDecision: { create: async ({ data }: Row) => { t.decisions.push(data); } },
    userConsent: {
      findMany: async ({ where }: Row) => t.consents.filter((c) => c.user_id === where.user_id && where.consent_document_id.in.includes(c.consent_document_id)),
      createMany: async ({ data }: Row) => { t.consents.push(...data); },
      deleteMany: async ({ where }: Row) => { t.consents = t.consents.filter((c) => c.user_id !== where.user_id); }
    },
    driverRoute: {
      findMany: async ({ where }: Row) => t.routes.filter((r) => r.driver_id === where.driver_id && where.status.in.includes(r.status)),
      create: async ({ data }: Row) => { const row = { id: next("r"), departure_at: null, departed_at: null, availability_window_end: null, ...data }; t.routes.push(row); return row; },
      updateMany: async ({ where, data }: Row) => { for (const r of t.routes) if ((where.id?.in ?? []).includes(r.id) || (where.driver_id === r.driver_id && r.status === where.status)) Object.assign(r, data); }
    }
  };
  db.$transaction = async (run: (tx: any) => unknown) => run(db);
  return { db, t };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "darb-test-drivers-")); consent.ready = false; });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = (file: string, extra: Row = {}) => ({ dryRun: false, resetPasswords: false, force: false, credentialsFile: file, bcryptCost: 4, ...extra });
const readLines = (file: string) => readFileSync(file, "utf8").trim().split("\n").map((line) => line.split(" | "));

describe("test driver plan", () => {
  it("maps driver k to the k-th predefined route with distinct valid phones", () => {
    const specs = testDriverSpecs();
    expect(specs).toHaveLength(20);
    expect(specs[0]).toMatchObject({ email: "driver1@darb.ps", routeKey: "hebron-to-bethlehem", phone: "+970599000001" });
    expect(specs[1]!.routeKey).toBe("bethlehem-to-hebron");
    expect(new Set(specs.map((s) => s.routeKey)).size).toBe(PREDEFINED_ROUTE_PAIRS.length * 2);
    expect(new Set(specs.map((s) => s.phone)).size).toBe(20);
    expect(specs[19]!.plate).toBe("TEST-20");
  });

  it("generates passwords that satisfy the password rule", () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTestPassword();
      expect(password.length).toBeGreaterThanOrEqual(16);
      expect(password.length).toBeGreaterThan(PASSWORD_MIN_CHARACTERS);
      expect(isValidNewPassword(password)).toBe(true);
    }
  });
});

describe("seedTestDrivers", () => {
  it("creates 20 approved drivers, one active route each, and a 0600 credentials file", async () => {
    const { db, t } = fakeDb();
    const file = join(dir, "creds.txt");
    const result = await seedTestDrivers(db, base(file));
    expect(result).toMatchObject({ created: 20, routesCreated: 20, passwordsWritten: 20, credentialsFileWritten: true, consentRelease: "none_effective" });
    expect(t.users.every((u) => u.role === "driver" && u.account_status === "active" && u.profile_state === "complete" && u.demo_account === false)).toBe(true);
    expect(t.profiles.every((p) => p.verified && p.seats_total === 4 && p.parcel_capacity === 5 && /^TEST-\d\d$/.test(p.plate_number))).toBe(true);
    expect(t.verifications.every((v) => v.status === "approved")).toBe(true);
    expect(t.routes).toHaveLength(20);
    expect(new Set(t.routes.map((r) => r.corridor_key)).size).toBe(20);
    expect(t.routes.every((r) => r.status === "active" && r.seats_available === 4 && r.parcel_capacity_available === 5 && r.departure_at === null)).toBe(true);
    expect(t.audits.filter((a) => a.metadata.operation === "test_driver_seed_created")).toHaveLength(20);

    const rows = readLines(file);
    expect(rows).toHaveLength(20);
    for (const [index, [email, password, routeKey]] of rows.entries()) {
      expect(email).toBe(`driver${index + 1}@darb.ps`);
      expect(isValidNewPassword(password!)).toBe(true);
      const user = t.users.find((u) => u.email === email)!;
      expect(await bcrypt.compare(password!, user.password_hash)).toBe(true);
      expect(routeKey).toBe(testDriverSpecs()[index]!.routeKey);
    }
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("is idempotent: a second run changes nothing and keeps passwords", async () => {
    const { db, t } = fakeDb();
    await seedTestDrivers(db, base(join(dir, "a.txt")));
    const hashes = t.users.map((u) => u.password_hash);
    const second = join(dir, "b.txt");
    const result = await seedTestDrivers(db, base(second));
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 20, routesCreated: 0, routesKept: 20, passwordsWritten: 0, credentialsFileWritten: false });
    expect(t.users.map((u) => u.password_hash)).toEqual(hashes);
    expect(t.routes).toHaveLength(20);
    expect(existsSync(second)).toBe(false);
  });

  it("repairs an offline route and a suspended account on re-run, and resets passwords only on request", async () => {
    const { db, t } = fakeDb();
    await seedTestDrivers(db, base(join(dir, "a.txt")));
    t.routes[0]!.status = "inactive";
    t.users[1]!.account_status = "suspended";
    const result = await seedTestDrivers(db, base(join(dir, "b.txt")));
    expect(result).toMatchObject({ created: 0, updated: 2, routesCreated: 1 });
    expect(t.routes.filter((r) => r.status === "active")).toHaveLength(20);
    expect(t.users[1]!.account_status).toBe("active");

    const before = t.users.map((u) => u.password_hash);
    const reset = await seedTestDrivers(db, base(join(dir, "c.txt"), { resetPasswords: true }));
    expect(reset.passwordsWritten).toBe(20);
    expect(t.users.every((u, i) => u.password_hash !== before[i])).toBe(true);
  });

  it("records the consents of the current release when one is effective", async () => {
    consent.ready = true;
    const { db, t } = fakeDb();
    const result = await seedTestDrivers(db, base(join(dir, "c.txt")));
    expect(result).toMatchObject({ consentRelease: "recorded", consentsRecorded: 40 });
    expect(t.consents.filter((c) => c.source === "test_driver_seed")).toHaveLength(40);
    expect((await seedTestDrivers(db, base(join(dir, "d.txt")))).consentsRecorded).toBe(0);
  });

  it("refuses to overwrite a credentials file unless forced, and needs a file to write", async () => {
    const { db, t } = fakeDb();
    const file = join(dir, "creds.txt");
    writeFileSync(file, "keep");
    await expect(seedTestDrivers(db, base(file))).rejects.toThrow("credentials_file_exists");
    expect(t.users).toHaveLength(0);
    expect(readFileSync(file, "utf8")).toBe("keep");
    await expect(seedTestDrivers(db, base(file, { credentialsFile: undefined }))).rejects.toThrow("credentials_file_required");
    await seedTestDrivers(db, base(file, { force: true }));
    expect(readLines(file)).toHaveLength(20);
  });

  it("refuses an address that belongs to an account this script did not create", async () => {
    const { db, t } = fakeDb();
    t.users.push({ id: "real", email: "driver3@darb.ps", role: "driver", name: "Real" });
    await expect(seedTestDrivers(db, base(join(dir, "x.txt")))).rejects.toThrow("email_in_use_by_another_account");
    expect(t.users).toHaveLength(1);
  });

  it("dry run writes nothing, not even a file", async () => {
    const { db, t } = fakeDb();
    const file = join(dir, "dry.txt");
    const result = await seedTestDrivers(db, base(file, { dryRun: true }));
    expect(result).toMatchObject({ dryRun: true, created: 20, routesCreated: 20, passwordsWritten: 0 });
    expect(Object.values(t).every((rows) => rows.length === 0)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });
});

describe("removeTestDrivers", () => {
  it("removes only accounts created by the script", async () => {
    const { db, t } = fakeDb();
    await seedTestDrivers(db, base(join(dir, "a.txt")));
    t.users.push({ id: "other", email: "someone@example.com", role: "driver" });
    // A real account on a test-looking address, without the audit marker:
    t.users.push({ id: "lookalike", email: "driver21@darb.ps", role: "driver" });
    const dry = await removeTestDrivers(db, { dryRun: true });
    expect(dry).toMatchObject({ matched: 20, removed: 0 });
    expect(t.users).toHaveLength(22);
    const result = await removeTestDrivers(db, { dryRun: false });
    expect(result).toMatchObject({ matched: 20, removed: 20, suspended: 0 });
    expect(t.users.map((u) => u.id).sort()).toEqual(["lookalike", "other"]);
    expect(t.audits.some((a) => a.metadata.operation === "test_driver_seed_removed")).toBe(true);
  });

  it("does not remove a real account that merely uses a test address", async () => {
    const { db, t } = fakeDb();
    t.users.push({ id: "real", email: "driver3@darb.ps", role: "driver" });
    const result = await removeTestDrivers(db, { dryRun: false });
    expect(result).toMatchObject({ matched: 0, removed: 0, skippedNotOwned: 1 });
    expect(t.users).toHaveLength(1);
  });

  it("suspends a driver that cannot be deleted", async () => {
    const { db, t } = fakeDb({ failUserDelete: true });
    await seedTestDrivers(db, base(join(dir, "a.txt")));
    const result = await removeTestDrivers(db, { dryRun: false });
    expect(result).toMatchObject({ removed: 0, suspended: 20 });
    expect(t.users.every((u) => u.account_status === "suspended")).toBe(true);
    expect(t.routes.every((r) => r.status === "inactive")).toBe(true);
  });
});

describe("confirmation flag", () => {
  it("refuses to run without --confirm-test-accounts", () => {
    expect(() => requireTestAccountConfirmation(new Set(["dry-run"]))).toThrow("confirm_test_accounts_flag_required");
    expect(() => requireTestAccountConfirmation(new Set(["confirm-test-accounts"]))).not.toThrow();
  });
});

describe("cli arguments", () => {
  it("reads --credentials-file as a value and the safety flags as flags", () => {
    const { flags, values } = parseCliArgs(["--confirm-test-accounts", "--credentials-file", "/tmp/x", "--dry-run"]);
    expect(values.get("credentials-file")).toBe("/tmp/x");
    expect(flags.has("confirm-test-accounts")).toBe(true);
    expect(flags.has("dry-run")).toBe(true);
  });
});
