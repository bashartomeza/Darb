import { z } from "zod";

/**
 * The one password rule for every role and every path that sets a password:
 * passenger sign-up, set/change, reset, driver and shop-owner onboarding, and
 * the admin bootstrap CLI. Login never applies it, so existing passwords keep
 * working whatever their shape.
 *
 * - at least 8 characters (Unicode code points),
 * - at least one letter (any script: Arabic and Latin both count),
 * - at least one digit (0-9 or Arabic-Indic ٠-٩),
 * - at most 72 UTF-8 bytes (bcrypt ignores anything after that).
 *
 * apps/mobile/lib/core/validation/password_rule.dart mirrors this rule.
 */
export const PASSWORD_MIN_CHARACTERS = 8;
export const PASSWORD_MAX_UTF8_BYTES = 72;
/** The stable error code every password-setting route answers with when the rule is not met. */
export const INVALID_PASSWORD = "invalid_password";

const letter = /\p{L}/u;
const digit = /[0-9٠-٩]/u;

export function isValidNewPassword(value: string) {
  return [...value].length >= PASSWORD_MIN_CHARACTERS &&
    Buffer.byteLength(value, "utf8") <= PASSWORD_MAX_UTF8_BYTES &&
    letter.test(value) &&
    digit.test(value);
}

/** Zod form of the rule; the error middleware answers its failure with `invalid_password`. */
export const newPassword = z.string().refine(isValidNewPassword, { params: { error_code: INVALID_PASSWORD } });

/** True when a validation issue is the password rule's own refinement (see newPassword). */
export function isPasswordRuleIssue(issue: { code: string; params?: unknown }) {
  return issue.code === "custom" &&
    typeof issue.params === "object" && issue.params !== null &&
    (issue.params as { error_code?: unknown }).error_code === INVALID_PASSWORD;
}
