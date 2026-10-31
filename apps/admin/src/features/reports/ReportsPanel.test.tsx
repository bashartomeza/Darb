import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import { translate } from "../../i18n/locale";
import { ReportsPanel, toRange } from "./ReportsPanel";

function withLocale(locale: Locale, children: ReactNode) {
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  return renderToStaticMarkup(
    <LocaleProvider storage={storage} documentRef={documentRef}>
      {children}
    </LocaleProvider>
  );
}

const api = {
  reportSummary: async () => {
    throw new Error("not called during static render");
  },
  reportExport: async () => new Blob()
};

describe("reports panel", () => {
  it("turns date inputs into inclusive UTC day boundaries", () => {
    expect(toRange("2026-10-01", "2026-10-31")).toEqual({
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-31T23:59:59.999Z"
    });
    expect(toRange("", "")).toEqual({ from: undefined, to: undefined });
  });

  it("offers the range filter and every export in both languages", () => {
    for (const locale of ["en", "ar"] as const) {
      const markup = withLocale(locale, <ReportsPanel api={api} token="t" />);
      expect(markup).toContain(translate(locale, "reportsFrom"));
      expect(markup).toContain(translate(locale, "reportsTo"));
      expect(markup).toContain(translate(locale, "reportsExportRequests"));
      expect(markup).toContain(translate(locale, "reportsExportOrders"));
      expect(markup).toContain(translate(locale, "reportsExportTrips"));
    }
  });

  it("does not invent figures before the summary has loaded", () => {
    const markup = withLocale("en", <ReportsPanel api={api} token="t" />);
    expect(markup).not.toContain("Passenger requests");
    expect(markup).not.toContain("No records in this period.");
  });
});
