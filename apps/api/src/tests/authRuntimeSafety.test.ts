import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ url: "", databaseWrite: vi.fn(async () => { throw new Error("unexpected_database_access"); }) }));
vi.mock("../config.js", () => ({ config: { get databaseUrl() { return fixture.url; }, isLocal: true } }));
vi.mock("../lib/prisma.js", () => ({ prisma: { user: { create: fixture.databaseWrite }, $disconnect: vi.fn(async () => {}) } }));

describe("disposable runtime guard", () => {
  let originalExitCode: typeof process.exitCode;
  beforeEach(() => { originalExitCode = process.exitCode; vi.resetModules(); fixture.databaseWrite.mockClear(); });
  afterEach(() => { process.exitCode = originalExitCode; });
  it.each([
    "mysql://fixture:fixture@127.0.0.1/darb_auth_rehearsal_guard",
    "mysql://fixture:fixture@127.0.0.1:3306/darb_auth_rehearsal_guard",
    "mysql://fixture:fixture@127.0.0.1:0/darb_auth_rehearsal_guard"
  ])("rejects unsafe port before database access: %s", async (url) => {
    fixture.url = url;
    await expect(import("../scripts/authRuntimeRehearsal.js")).rejects.toThrow("disposable_local_database_required");
    expect(fixture.databaseWrite).not.toHaveBeenCalled();
  });
});
