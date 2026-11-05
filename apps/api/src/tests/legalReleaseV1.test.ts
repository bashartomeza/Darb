import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({ prisma: {} }));

const { consentReleaseDraftSchema } = await import("../modules/adminConsents.js");
const { canonicalConsentBundle, CONSENT_CONTENT_MIN_CHARACTERS_LIVE } = await import("../lib/consentContent.js");

const repoRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const script = resolve(repoRoot, "scripts/legal/print-release-json.mjs");

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

describe("legal release v1 helper output", () => {
  const result = run(["--version", "1.0.0", "--effective", "2026-11-10T09:00:00+02:00"]);

  it("prints JSON that the admin consent-release API schema accepts", () => {
    expect(result.status).toBe(0);
    const parsed = consentReleaseDraftSchema.parse(JSON.parse(result.stdout));
    expect(parsed.documents).toHaveLength(6);
    expect(parsed.version).toBe("1.0.0");
  });

  it("produces six documents that pass the production minimum length and carry no draft banner", () => {
    const body = JSON.parse(result.stdout) as { documents: { type: "terms" | "privacy" | "adult_self_attestation"; locale: "ar" | "en"; content: string }[] };
    expect(canonicalConsentBundle(body.documents, CONSENT_CONTENT_MIN_CHARACTERS_LIVE)).toHaveLength(6);
    for (const document of body.documents) {
      expect(document.content.startsWith("> ")).toBe(false);
      expect(document.content.trim()).not.toBe("1");
      expect(document.content.length).toBeGreaterThan(CONSENT_CONTENT_MIN_CHARACTERS_LIVE);
    }
  });

  it("warns about owner placeholders and fails under --strict", () => {
    expect(result.stderr).toContain("placeholder");
    expect(run(["--version", "1.0.0", "--effective", "2026-11-10T09:00:00+02:00", "--strict"]).status).toBe(2);
  });

  it("rejects a bad version or a time without an offset", () => {
    expect(run(["--version", "bad version", "--effective", "2026-11-10T09:00:00+02:00"]).status).toBe(1);
    expect(run(["--version", "1.0.0", "--effective", "2026-11-10T09:00:00"]).status).toBe(1);
  });

  it("keeps the placeholder text 1 out of the release files", () => {
    for (const file of ["terms", "privacy", "adult"]) {
      for (const locale of ["ar", "en"]) {
        expect(readFileSync(resolve(repoRoot, `docs/legal/release-v1/${file}.${locale}.md`), "utf8").trim().length).toBeGreaterThan(200);
      }
    }
  });
});
