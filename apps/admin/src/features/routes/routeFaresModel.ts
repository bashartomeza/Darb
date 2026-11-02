import type { RouteFareCurrent, RouteFareItem } from "../../api";

export const FARE_ITEMS: RouteFareItem[] = ["passenger_seat", "parcel_s", "parcel_m", "parcel_l"];
/** Mirrors the API cap: 100,000.00 ILS in agorot. */
export const MAX_FARE_MINOR = 10_000_000;

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

function latinDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= EXTENDED_ARABIC_INDIC_ZERO ? code - EXTENDED_ARABIC_INDIC_ZERO : code - ARABIC_INDIC_ZERO);
  });
}

export type ParsedFare = { kind: "empty" } | { kind: "invalid" } | { kind: "amount"; minor: number };

/**
 * Parses what an admin types ("12", "12.5", "12,50", Arabic-Indic digits) into
 * integer agorot. Never rounds: more than two decimals is rejected so no
 * typo silently becomes a different price.
 */
export function parseFareInput(raw: string): ParsedFare {
  const text = latinDigits(raw)
    .replace(/[٫،]/g, ".")
    .replace(/٬/g, "")
    .trim();
  if (text === "") return { kind: "empty" };
  const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(text);
  if (!match) return { kind: "invalid" };
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (minor < 1 || minor > MAX_FARE_MINOR) return { kind: "invalid" };
  return { kind: "amount", minor };
}

/** Editable text for an existing amount: plain Latin digits, always two decimals. */
export function minorToInput(minor: number | null): string {
  if (minor === null) return "";
  return `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

/**
 * Display money in ILS. Arabic uses Latin digits here so what an admin reads
 * matches what they type; the passenger app localises digits separately.
 */
export function formatMoney(minor: number, locale: "ar" | "en"): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : "en", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number((minor / 100).toFixed(2)));
}

export type FareDrafts = Record<RouteFareItem, string>;

export function draftsFromCurrent(current: Record<RouteFareItem, RouteFareCurrent> | undefined): FareDrafts {
  return Object.fromEntries(FARE_ITEMS.map((item) => [item, minorToInput(current?.[item]?.amount_minor ?? null)])) as FareDrafts;
}

export type FareDiff =
  | { ok: true; changes: Array<{ item: RouteFareItem; amount_minor: number | null }> }
  | { ok: false; invalid: RouteFareItem[] };

/** Only items whose parsed value differs from the current fare are sent. */
export function diffFares(drafts: FareDrafts, current: Record<RouteFareItem, RouteFareCurrent> | undefined): FareDiff {
  const invalid: RouteFareItem[] = [];
  const changes: Array<{ item: RouteFareItem; amount_minor: number | null }> = [];
  for (const item of FARE_ITEMS) {
    const parsed = parseFareInput(drafts[item]);
    if (parsed.kind === "invalid") {
      invalid.push(item);
      continue;
    }
    const before = current?.[item]?.amount_minor ?? null;
    const after = parsed.kind === "empty" ? null : parsed.minor;
    if (before !== after) changes.push({ item, amount_minor: after });
  }
  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, changes };
}
