import { describe, expect, it } from "vitest";
import { assertMonitoringIntegrationTarget } from "../scripts/adminMatchingMonitoringIntegrationSafety.js";

describe("monitoring integration disposable target guard", () => {
  it.each([
    [undefined, "mysql://localhost/card7_ci", "card7_ci"],
    ["production", "mysql://localhost/card7_ci", "card7_ci"],
    ["staging", "mysql://localhost/card7_ci", "card7_ci"],
    ["test", undefined, "card7_ci"],
    ["test", "not a url", "card7_ci"],
    ["test", "postgres://localhost/card7_ci", "card7_ci"],
    ["test", "mysql://localhost/darb", "darb"],
    ["test", "mysql://localhost/Darb", "Darb"],
    ["test", "mysql://localhost/darb_dev", "darb_dev"],
    ["test", "mysql://localhost/card7_ci", "other_ci"],
    ["test", "mysql://localhost/card7_ci", undefined],
    ["test", "mysql://localhost/card7_ci", "CARD7_CI"],
    ["test", "mysql://localhost/card7_ci/other", "card7_ci/other"],
    ["test", "mysql://localhost/card-7_ci", "card-7_ci"],
    ["test", "mysql://localhost/%ZZ_ci", "%ZZ_ci"],
    ["test", "mysql://localhost/%2Fcard7_ci", "/card7_ci"],
    ["test", "mysql://localhost/", ""],
  ])("rejects unsafe target %s %s", (environment, url, allowed) => {
    expect(() => assertMonitoringIntegrationTarget(environment, url, allowed)).toThrow();
  });

  it.each([
    ["test", "mysql://localhost/card7_ci", "card7_ci"],
    ["demo", "mysql://localhost/darb_ci", "other_ci, darb_ci"],
    ["test", "mysql://localhost/card7%5Fci", "card7_ci"],
  ])("accepts explicitly allowed disposable target %s %s", (environment, url, allowed) => {
    expect(() => assertMonitoringIntegrationTarget(environment, url, allowed)).not.toThrow();
  });

  it("never echoes URL credentials or malformed input in errors", () => {
    for (const url of ["mysql://secret-user:secret-password@localhost/darb", "secret-password malformed"]) {
      let thrown: unknown;
      try {
        assertMonitoringIntegrationTarget("test", url, "card7_ci");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).not.toContain("secret");
      expect(String(thrown)).not.toContain(url);
    }
  });
});
