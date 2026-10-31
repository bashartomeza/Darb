import { z } from "zod";

/** Canonical form of an email address used for one-time-code delivery and abuse counters. */
export const contactEmailSchema = z.string().trim().toLowerCase().email().max(191);

/** `a***@example.com`: enough for an operator to recognise the address, never the whole mailbox. */
export function maskEmail(email: string | null | undefined) {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Key for ABUSE COUNTERS only (never stored or used for delivery): plus-tags are dropped and, for Gmail,
 * dots are dropped too, so alias spellings of one inbox share a single bucket.
 */
export function normalizeEmailForAbuse(email: string) {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return value;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}
