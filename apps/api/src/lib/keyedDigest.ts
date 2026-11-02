import { createHmac, timingSafeEqual } from "node:crypto";

export type VersionedKey = { secret: string; version: number };

export function keyedDigest(context: string, value: string, key: VersionedKey) {
  return createHmac("sha256", key.secret).update(`${context}:v${key.version}\0${value}`, "utf8").digest("hex");
}

export function keyedDigestMatches(expectedHex: string, context: string, value: string, key: VersionedKey) {
  return hexDigestMatches(expectedHex, keyedDigest(context, value, key));
}

export function hexDigestMatches(expectedHex: string, actualHex: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedHex) || !/^[a-f0-9]{64}$/.test(actualHex)) return false;
  const actual = Buffer.from(actualHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return timingSafeEqual(actual, expected);
}

export function invitationCodeDigest(code: string, key: VersionedKey) {
  return keyedDigest("darb:invitation-code", code, key);
}

export function phoneDigest(phoneE164: string, key: VersionedKey) {
  return keyedDigest("darb:phone", phoneE164, key);
}

export function otpCodeDigest(challengeId: string, code: string, key: VersionedKey) {
  return keyedDigest(`darb:otp:${challengeId}`, code, key);
}

export function onboardingSessionDigest(token: string, key: VersionedKey) {
  return keyedDigest("darb:onboarding-session", token, key);
}

export function idempotencyKeyDigest(scope: string, value: string, key: VersionedKey) {
  return keyedDigest(`darb:idempotency:${scope}`, value, key);
}

export function idempotencyPayloadDigest(operation: string, canonicalPayload: string, key: VersionedKey) {
  return keyedDigest(`onboarding-idempotency-payload:${operation}`, canonicalPayload, key);
}

export function registrationGrantDigest(grant: string, key: VersionedKey) {
  return keyedDigest("darb:registration-grant", grant, key);
}

export function abuseSubjectDigest(bucket: string, value: string, key: VersionedKey) {
  return keyedDigest(`darb:abuse:${bucket}`, value, key);
}
