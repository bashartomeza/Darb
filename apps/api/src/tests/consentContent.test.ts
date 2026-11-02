import { describe, expect, it } from "vitest";
import {
  CONSENT_CONTENT_MAX_BYTES,
  CONSENT_DOCUMENT_TYPES,
  CONSENT_LOCALES,
  canonicalConsentBundle,
  canonicalConsentContent,
  consentContentDigest,
  consentDigestMatches
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
});
