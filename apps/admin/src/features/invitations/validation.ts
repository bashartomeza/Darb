/** Client-side mirrors of the API rules (apps/api/src/lib/phone.ts, contactEmail.ts). The API stays authoritative. */
export const PHONE_INPUT_MAX_LENGTH = 32;
export const EMAIL_MAX_LENGTH = 191;

function latinDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

/**
 * Accepts only explicit international numbers (leading "+"): the form has no region field.
 * Returns the E.164 candidate, or null when the input could never normalise.
 */
export function normalizeInvitationPhone(input: string): string | null {
  if (input.length > PHONE_INPUT_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(input)) return null;
  const value = latinDigits(input.trim());
  if (!value.startsWith("+") || /[^0-9+()\- ]/.test(value)) return null;
  const compact = value.replace(/[()\- ]/g, "");
  if ((compact.match(/\+/g) ?? []).length !== 1) return null;
  if (!/^\+[1-9][0-9]{6,14}$/.test(compact)) return null;
  return compact;
}

export function normalizeContactEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (value.length > EMAIL_MAX_LENGTH) return null;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) ? value : null;
}
