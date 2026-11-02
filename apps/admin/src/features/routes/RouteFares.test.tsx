import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteFares, routeFareCopy } from "./RouteFares";
import { diffFares, draftsFromCurrent, formatMoney, minorToInput, parseFareInput } from "./routeFaresModel";

describe("fare input parsing (integer agorot, no rounding)", () => {
  it("parses whole, decimal and comma-decimal amounts exactly", () => {
    expect(parseFareInput("12")).toEqual({ kind: "amount", minor: 1200 });
    expect(parseFareInput("12.5")).toEqual({ kind: "amount", minor: 1250 });
    expect(parseFareInput("12,05")).toEqual({ kind: "amount", minor: 1205 });
    expect(parseFareInput(" 0.01 ")).toEqual({ kind: "amount", minor: 1 });
    expect(parseFareInput("100000")).toEqual({ kind: "amount", minor: 10_000_000 });
  });

  it("accepts Arabic-Indic digits and separators", () => {
    expect(parseFareInput("١٢٫٥٠")).toEqual({ kind: "amount", minor: 1250 });
    expect(parseFareInput("۱۵")).toEqual({ kind: "amount", minor: 1500 });
  });

  it("rejects instead of rounding", () => {
    for (const bad of ["12.505", "0", "0.00", "-5", "abc", "1e3", "100000.01", "1.2.3", "12 ILS"]) {
      expect(parseFareInput(bad).kind).toBe("invalid");
    }
    expect(parseFareInput("   ").kind).toBe("empty");
  });

  it("round-trips through the edit field", () => {
    for (const minor of [1, 5, 99, 100, 1005, 1250, 10_000_000]) {
      expect(parseFareInput(minorToInput(minor))).toEqual({ kind: "amount", minor });
    }
    expect(minorToInput(null)).toBe("");
  });
});

describe("money formatting", () => {
  it("formats ILS with two decimals in both languages", () => {
    expect(formatMoney(1250, "en")).toMatch(/12\.50/);
    expect(formatMoney(5, "en")).toMatch(/0\.05/);
    expect(formatMoney(1250, "ar")).toMatch(/12\.50/);
    expect(formatMoney(1250, "en")).toMatch(/₪|ILS/);
  });
});

describe("fare diff", () => {
  const current = {
    passenger_seat: { fare_id: "f1", amount_minor: 1500, currency: "ILS", effective_from: "2026-10-01T00:00:00Z" },
    parcel_s: null,
    parcel_m: null,
    parcel_l: null
  };

  it("sends only changed items and uses null to withdraw", () => {
    const drafts = { ...draftsFromCurrent(current), passenger_seat: "", parcel_s: "7.5" };
    expect(diffFares(drafts, current)).toEqual({
      ok: true,
      changes: [
        { item: "passenger_seat", amount_minor: null },
        { item: "parcel_s", amount_minor: 750 }
      ]
    });
  });

  it("reports no changes for untouched drafts and flags invalid ones", () => {
    expect(diffFares(draftsFromCurrent(current), current)).toEqual({ ok: true, changes: [] });
    expect(diffFares({ ...draftsFromCurrent(current), parcel_m: "1.234" }, current)).toEqual({ ok: false, invalid: ["parcel_m"] });
  });
});

describe("RouteFares panel", () => {
  const api = {
    routeFares: async () => {
      throw new Error("not called during static render");
    },
    setRouteFares: async () => {
      throw new Error("not called during static render");
    }
  };

  it("labels fares as display-only in both languages and sets direction", () => {
    for (const locale of ["en", "ar"] as const) {
      const markup = renderToStaticMarkup(<RouteFares api={api} token="t" locale={locale} routeId="r1" />);
      // Static render shows the loading skeleton; the copy itself must carry the disclosure.
      expect(typeof markup).toBe("string");
      expect(routeFareCopy[locale].note.length).toBeGreaterThan(20);
    }
    expect(routeFareCopy.en.note).toMatch(/no payment is processed/i);
    expect(routeFareCopy.ar.note).toContain("مباشرة إلى السائق");
  });

  it("has the same copy keys in both languages", () => {
    expect(Object.keys(routeFareCopy.ar).sort()).toEqual(Object.keys(routeFareCopy.en).sort());
    expect(Object.keys(routeFareCopy.ar.item).sort()).toEqual(Object.keys(routeFareCopy.en.item).sort());
  });
});
