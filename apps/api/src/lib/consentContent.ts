import { createHash, timingSafeEqual } from "node:crypto";

export const CONSENT_DOCUMENT_TYPES = ["terms", "privacy", "adult_self_attestation"] as const;
export const CONSENT_LOCALES = ["ar", "en"] as const;
export const CONSENT_RELEASE_DOCUMENT_COUNT = CONSENT_DOCUMENT_TYPES.length * CONSENT_LOCALES.length;
export const CONSENT_CONTENT_MAX_BYTES = 32_000;
export const CONSENT_CONTENT_MAX_CHARACTERS = 30_000;
// Real legal text is never this short. Enforced outside local/test/demo so a placeholder such as "1"
// can never be published as consent content.
export const CONSENT_CONTENT_MIN_CHARACTERS_LIVE = 200;

export function defaultConsentMinCharacters(appEnv = process.env.APP_ENV) {
  return appEnv === "production" || appEnv === "staging" ? CONSENT_CONTENT_MIN_CHARACTERS_LIVE : 0;
}

export type ConsentDocumentTypeValue = (typeof CONSENT_DOCUMENT_TYPES)[number];
export type ConsentLocaleValue = (typeof CONSENT_LOCALES)[number];

export type ConsentContentInput = {
  type: ConsentDocumentTypeValue;
  locale: ConsentLocaleValue;
  content: string;
};

export function consentIdentity(type: ConsentDocumentTypeValue, locale: ConsentLocaleValue) {
  return `${type}:${locale}`;
}

export function canonicalConsentContent(value: string, minCharacters = 0) {
  const canonical = value.normalize("NFC").replace(/\r\n?/g, "\n");
  const bytes = Buffer.byteLength(canonical, "utf8");
  if (
    canonical.trim().length === 0 ||
    canonical.length > CONSENT_CONTENT_MAX_CHARACTERS ||
    bytes > CONSENT_CONTENT_MAX_BYTES ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(canonical)
  ) {
    throw new Error("consent_content_invalid");
  }
  if (canonical.trim().length < minCharacters) throw new Error("consent_content_too_short");
  return canonical;
}

export function consentContentDigest(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function consentDigestMatches(content: string, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  const actual = Buffer.from(consentContentDigest(content), "hex");
  const stored = Buffer.from(expected, "hex");
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}

export function canonicalConsentBundle(documents: ConsentContentInput[], minCharacters = 0) {
  if (documents.length !== CONSENT_RELEASE_DOCUMENT_COUNT) throw new Error("consent_release_incomplete");
  const identities = new Set<string>();
  const canonical = documents.map((document) => {
    const identity = consentIdentity(document.type, document.locale);
    if (identities.has(identity)) throw new Error("consent_release_duplicate_document");
    identities.add(identity);
    const content = canonicalConsentContent(document.content, minCharacters);
    return { ...document, content, digest: consentContentDigest(content) };
  });
  for (const type of CONSENT_DOCUMENT_TYPES) {
    for (const locale of CONSENT_LOCALES) {
      if (!identities.has(consentIdentity(type, locale))) throw new Error("consent_release_incomplete");
    }
  }
  return canonical;
}
