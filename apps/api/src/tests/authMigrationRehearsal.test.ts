import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const { runAuthMigrationRehearsal } = await import(
  new URL("../../../../scripts/auth-migration-rehearsal.mjs", import.meta.url).href
);

describe("auth migration rehearsal", () => {
  it("does not report an in-memory fixture as a successful runtime rehearsal", () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../scripts/auth-migration-rehearsal.mjs", import.meta.url))], {
      env: { ...process.env, DATABASE_URL: "mysql://local:local@127.0.0.1:13316/darb_auth_rehearsal_fixture" }, encoding: "utf8"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("runtime_rehearsal_required");
  });
  it("rejects a non-disposable rehearsal database", async () => {
    await expect(runAuthMigrationRehearsal({ database: "darb" }))
      .rejects.toThrow("disposable_database_required");
  });

  it("backfills google_sub without dropping it", async () => {
    const report = await runAuthMigrationRehearsal({
      database: "darb_auth_rehearsal_task_2",
      legacyUsers: [{ id: "legacy-user", google_sub: "legacy-sub" }]
    });

    expect(report.externalIdentities).toContainEqual(
      expect.objectContaining({
        user_id: "legacy-user",
        provider: "google",
        provider_subject: "legacy-sub"
      })
    );
    expect(report.legacyGoogleSubColumnPresent).toBe(true);
  });

  it("aborts the fixture rehearsal when legacy Google subjects conflict", async () => {
    await expect(
      runAuthMigrationRehearsal({
        database: "darb_auth_rehearsal_task_2",
        legacyUsers: [
          { id: "legacy-user-1", google_sub: "duplicate-sub" },
          { id: "legacy-user-2", google_sub: "duplicate-sub" }
        ]
      })
    ).rejects.toThrow("external_identity_duplicate_google_subject");
  });

  it("aborts the fixture rehearsal when a Google identity already conflicts", async () => {
    await expect(
      runAuthMigrationRehearsal({
        database: "darb_auth_rehearsal_task_2",
        legacyUsers: [{ id: "legacy-user", google_sub: "legacy-sub" }],
        existingExternalIdentities: [
          { user_id: "other-user", provider: "google", provider_subject: "legacy-sub" }
        ]
      })
    ).rejects.toThrow("external_identity_google_subject_conflict");
  });

  it("aborts the fixture rehearsal when a user already has another Google subject", async () => {
    await expect(
      runAuthMigrationRehearsal({
        database: "darb_auth_rehearsal_task_2",
        legacyUsers: [{ id: "legacy-user", google_sub: "legacy-sub" }],
        existingExternalIdentities: [
          { user_id: "legacy-user", provider: "google", provider_subject: "different-sub" }
        ]
      })
    ).rejects.toThrow("external_identity_google_user_conflict");
  });
});
