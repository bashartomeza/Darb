import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  applyDocumentLocale,
  getInitialLocale,
  parcelSizeLabel,
  persistLocale,
  statusLabel,
  translate,
  translateUnsafe
} from "./locale";
import { translations } from "./translations";

function storage(initial?: string) {
  const store = new Map<string, string>();
  if (initial) store.set(LOCALE_STORAGE_KEY, initial);
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value))
  };
}

describe("admin localization", () => {
  it("defaults to Arabic when no saved locale exists", () => {
    expect(getInitialLocale(storage())).toBe(DEFAULT_LOCALE);
  });

  it("restores saved English locale", () => {
    expect(getInitialLocale(storage("en"))).toBe("en");
  });

  it("updates document language and direction", () => {
    const documentRef = { documentElement: { lang: "", dir: "" } };
    applyDocumentLocale(documentRef, "ar");
    expect(documentRef.documentElement).toEqual({ lang: "ar", dir: "rtl" });

    applyDocumentLocale(documentRef, "en");
    expect(documentRef.documentElement).toEqual({ lang: "en", dir: "ltr" });
  });

  it("persists selected language", () => {
    const target = storage();
    persistLocale(target, "en");
    expect(target.setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, "en");
  });

  it("returns Arabic and English translations", () => {
    expect(translate("ar", "signIn")).toBe("تسجيل الدخول");
    expect(translate("en", "signIn")).toBe("Sign in");
  });

  it("fails safely for unknown keys during development", () => {
    expect(translateUnsafe("ar", "missing.key")).toBe("[missing:missing.key]");
  });

  it("translates status labels without changing API values", () => {
    const apiValue = "pickup_started";
    expect(statusLabel("ar", apiValue)).toBe("بدأ التوجه للالتقاط");
    expect(statusLabel("en", apiValue)).toBe("Pickup started");
    expect(apiValue).toBe("pickup_started");
    expect(statusLabel("ar", "submitted")).toBe("مقدم");
    expect(statusLabel("en", "submitted")).toBe("Submitted");
    expect(statusLabel("en", "failed")).toBe("Failed");
    expect(statusLabel("ar", "failed")).toBe("فشل");
  });

  it("has every key in both Arabic and English", () => {
    const arabic = Object.keys(translations.ar).sort();
    const english = Object.keys(translations.en).sort();
    expect(arabic.filter((key) => !english.includes(key))).toEqual([]);
    expect(english.filter((key) => !arabic.includes(key))).toEqual([]);
  });

  it("names parcel sizes in words and keeps an unknown code as sent", () => {
    expect(parcelSizeLabel("en", "M")).toBe("Medium");
    expect(parcelSizeLabel("ar", "L")).toBe("كبير");
    expect(parcelSizeLabel("en", "XL")).toBe("XL");
  });

  it("presents the console as a production admin tool, not a demo", () => {
    for (const locale of ["ar", "en"] as const) {
      const sign = [translate(locale, "appName"), translate(locale, "loginHeading"), translate(locale, "loginDescription")].join(" ");
      expect(sign).not.toMatch(/judge|demo|seeded|الحكام|التجريبي|عرض واحد/i);
    }
    expect(translate("en", "appName")).toBe("Darb Admin Console");
    expect(translate("en", "matchingDescription")).not.toMatch(/run corridor-based matching/i);
    const everything = JSON.stringify(translations);
    expect(everything).not.toMatch(/M7B|milestone/i);
  });
});
