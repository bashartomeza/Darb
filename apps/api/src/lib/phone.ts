import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode
} from "libphonenumber-js/max";

export const PHONE_INPUT_MAX_LENGTH = 32;

export class PhoneNormalizationError extends Error {
  constructor() {
    super("Phone number is invalid");
    this.name = "PhoneNormalizationError";
  }
}

function latinDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

export function normalizePhoneToE164(
  input: string,
  options: { region?: string } = {}
) {
  if (input.length > PHONE_INPUT_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new PhoneNormalizationError();
  }
  let value = latinDigits(input.trim());
  if (!value || /[^0-9+()\- ]/.test(value)) throw new PhoneNormalizationError();
  const explicitInternational = value.startsWith("+");
  value = value.replace(/[()\- ]/g, "");
  if ((value.match(/\+/g) ?? []).length > 1 || (value.includes("+") && !value.startsWith("+"))) {
    throw new PhoneNormalizationError();
  }

  const region = options.region?.trim().toUpperCase();
  if (!explicitInternational && !region) throw new PhoneNormalizationError();
  if (region && (!/^[A-Z]{2}$/.test(region) || !isSupportedCountry(region))) {
    throw new PhoneNormalizationError();
  }

  try {
    const phone = parsePhoneNumberFromString(value, {
      ...(region ? { defaultCountry: region as CountryCode } : {}),
      extract: false
    });
    if (!phone?.isValid() || phone.number.length > 16) throw new PhoneNormalizationError();
    return phone.number;
  } catch (error) {
    if (error instanceof PhoneNormalizationError) throw error;
    throw new PhoneNormalizationError();
  }
}

export function phoneLast4(phoneE164: string) {
  return phoneE164.slice(-4);
}

export function maskPhone(phoneE164: string) {
  try {
    const phone = parsePhoneNumberFromString(phoneE164, { extract: false });
    if (!phone?.isValid()) throw new PhoneNormalizationError();
    return `+${phone.countryCallingCode} ••• •• ${phoneLast4(phone.number)}`;
  } catch {
    throw new PhoneNormalizationError();
  }
}

export function analyzePhoneNormalization(rows: readonly { id: string; phone: string }[]) {
  const owners = new Map<string, string>();
  let valid = 0;
  let invalid = 0;
  let collisions = 0;
  for (const row of rows) {
    try {
      const canonical = normalizePhoneToE164(row.phone);
      valid += 1;
      const owner = owners.get(canonical);
      if (owner && owner !== row.id) collisions += 1;
      else owners.set(canonical, row.id);
    } catch {
      invalid += 1;
    }
  }
  return { total: rows.length, valid, invalid, collisions };
}
