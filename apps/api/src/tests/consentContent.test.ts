import { describe, expect, it } from "vitest";
import {
  CONSENT_CONTENT_MAX_BYTES,
  CONSENT_DOCUMENT_TYPES,
  CONSENT_LOCALES,
  canonicalConsentBundle,
  canonicalConsentContent,
  consentContentDigest,
  consentDigestMatches,
  defaultConsentMinCharacters,
  CONSENT_CONTENT_MIN_CHARACTERS_LIVE
} from "../lib/consentContent.js";

function bundle() {
  return CONSENT_DOCUMENT_TYPES.flatMap((type) =>
    CONSENT_LOCALES.map((locale) => ({ type, locale, content: `TEST ONLY - NOT LEGAL CONTENT - ${type}/${locale}` }))
  );
}

describe("consent content integrity", () => {
  it("canonicalizes NFC and LF before calculating a server-side SHA-256 digest", () => {
    const content = canonicalConsentContent("Cafe\u0301\r\nline two");
    expect(content).toBe("Café\nline two");
    expect(consentContentDigest(content)).toMatch(/^[a-f0-9]{64}$/);
    expect(consentDigestMatches(content, consentContentDigest(content))).toBe(true);
    expect(consentDigestMatches(`${content}!`, consentContentDigest(content))).toBe(false);
  });

  it("requires every type and locale exactly once", () => {
    expect(canonicalConsentBundle(bundle())).toHaveLength(6);
    expect(() => canonicalConsentBundle(bundle().slice(0, 5))).toThrow("consent_release_incomplete");
    const duplicate = bundle();
    duplicate[5] = { ...duplicate[0] };
    expect(() => canonicalConsentBundle(duplicate)).toThrow("consent_release_duplicate_document");
  });

  it("rejects empty, unsafe-control, and oversized content", () => {
    expect(() => canonicalConsentContent("   \n")).toThrow("consent_content_invalid");
    expect(() => canonicalConsentContent("legal\u0000text")).toThrow("consent_content_invalid");
    expect(() => canonicalConsentContent("x".repeat(CONSENT_CONTENT_MAX_BYTES + 1))).toThrow("consent_content_invalid");
  });

  it("enforces a minimum length only in staging and production", () => {
    expect(defaultConsentMinCharacters("production")).toBe(CONSENT_CONTENT_MIN_CHARACTERS_LIVE);
    expect(defaultConsentMinCharacters("staging")).toBe(CONSENT_CONTENT_MIN_CHARACTERS_LIVE);
    expect(defaultConsentMinCharacters("test")).toBe(0);
    expect(defaultConsentMinCharacters("demo")).toBe(0);
    expect(() => canonicalConsentContent("1", CONSENT_CONTENT_MIN_CHARACTERS_LIVE)).toThrow("consent_content_too_short");
    expect(() => canonicalConsentBundle(bundle(), CONSENT_CONTENT_MIN_CHARACTERS_LIVE)).toThrow("consent_content_too_short");
    const long = bundle().map((document) => ({ ...document, content: "x".repeat(CONSENT_CONTENT_MIN_CHARACTERS_LIVE) }));
    expect(canonicalConsentBundle(long, CONSENT_CONTENT_MIN_CHARACTERS_LIVE)).toHaveLength(6);
  });
});

describe("consent release service minimum length", () => {
  it("rejects placeholder content before touching the database when the minimum applies", async () => {
    const { ConsentReleaseService } = await import("../services/consentReleases.js");
    const db = { $transaction: () => { throw new Error("database must not be reached"); } };
    const service = new ConsentReleaseService(db as never, CONSENT_CONTENT_MIN_CHARACTERS_LIVE);
    const documents = bundle().map((document) => ({ ...document, content: "1" }));
    await expect(service.create({ version: "v1", intendedEffectiveAt: new Date(), documents }, "admin_1"))
      .rejects.toMatchObject({ statusCode: 400, message: "consent_content_too_short" });
    await expect(service.updateDraft("v1", 1, { intendedEffectiveAt: new Date(), documents }, "admin_1"))
      .rejects.toMatchObject({ statusCode: 400, message: "consent_content_too_short" });
  });
});
