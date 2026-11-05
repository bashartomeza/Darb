import { translations, type Locale, type TranslationKey } from "./translations";

export const LOCALE_STORAGE_KEY = "darb_locale";
export const DEFAULT_LOCALE: Locale = "ar";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;
export type DocumentLike = { documentElement: { lang: string; dir: string } };

export function isLocale(value: unknown): value is Locale {
  return value === "ar" || value === "en";
}

export function getInitialLocale(storage: Pick<StorageLike, "getItem"> | undefined): Locale {
  const saved = storage?.getItem(LOCALE_STORAGE_KEY);
  return isLocale(saved) ? saved : DEFAULT_LOCALE;
}

export function persistLocale(storage: Pick<StorageLike, "setItem"> | undefined, locale: Locale) {
  storage?.setItem(LOCALE_STORAGE_KEY, locale);
}

export function applyDocumentLocale(documentRef: DocumentLike | undefined, locale: Locale) {
  if (!documentRef) return;
  documentRef.documentElement.lang = locale;
  documentRef.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
}

export function translate(locale: Locale, key: TranslationKey, values: Record<string, string | number> = {}) {
  const text: string = translations[locale][key] ?? translations.en[key] ?? key;
  return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), text);
}

export function translateUnsafe(locale: Locale, key: string, values: Record<string, string | number> = {}) {
  if (key in translations.en) return translate(locale, key as TranslationKey, values);
  return `[missing:${key}]`;
}

export function statusLabel(locale: Locale, status: string) {
  const key = `status_${status}`;
  return key in translations.en ? translate(locale, key as TranslationKey) : status;
}

/** The S / M / L parcel size codes in words; an unknown code is shown as sent. */
export function parcelSizeLabel(locale: Locale, size: string) {
  const key = `parcelSize_${size}`;
  return key in translations.en ? translate(locale, key as TranslationKey) : size;
}

export function roleLabel(locale: Locale, role: string) {
  const key = `role_${role}`;
  return key in translations.en ? translate(locale, key as TranslationKey) : role;
}

export function sourceLabel(locale: Locale, source: string) {
  const key = `source_${source}`;
  return key in translations.en ? translate(locale, key as TranslationKey) : source;
}

export function localeCode(locale: Locale) {
  return locale === "ar" ? "ar-PS" : "en-US";
}

export function formatNumber(locale: Locale, value: number | string) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat(localeCode(locale), { maximumFractionDigits: 4 }).format(numeric);
}

export function formatDateTime(locale: Locale, value: string | Date | undefined) {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(localeCode(locale), { dateStyle: "medium", timeStyle: "short" }).format(date);
}
