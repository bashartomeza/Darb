import { describe, expect, it } from "vitest";
import { requireDisposableIntegrationDatabase } from "../scripts/disposableDatabase.js";

const url = (name: string) => `mysql://user:pass@127.0.0.1:3306/${name}`;

describe("requireDisposableIntegrationDatabase", () => {
  it("accepts an allow-listed *_ci database", () => {
    expect(requireDisposableIntegrationDatabase(
      { DATABASE_URL: url("darb_ci"), DEMO_RESET_ALLOWED_DATABASES: "other_ci, darb_ci" },
      "Test"
    )).toBe("darb_ci");
  });

  it.each([
    ["the permanent database", url("darb"), "darb"],
    ["the demo database", url("darb_demo"), "darb_demo"],
    ["a *_ci database that is not allow-listed", url("darb_ci"), "other_ci"],
    ["no allow-list", url("darb_ci"), undefined],
    ["a missing DATABASE_URL", undefined, "darb_ci"],
    ["a malformed DATABASE_URL", "not a url", "darb_ci"]
  ])("refuses %s", (_label, DATABASE_URL, DEMO_RESET_ALLOWED_DATABASES) => {
    expect(() => requireDisposableIntegrationDatabase({ DATABASE_URL, DEMO_RESET_ALLOWED_DATABASES }, "Onboarding integration"))
      .toThrow(/Onboarding integration refuses this database/);
  });
});
