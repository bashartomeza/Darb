import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import { translate } from "../../i18n/locale";
import { IncidentsPanel, nextActions } from "./IncidentsPanel";

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
  incidents: async () => {
    throw new Error("not called during static render");
  },
  updateIncident: async () => {
    throw new Error("not called during static render");
  }
};

describe("incidents panel", () => {
  it("offers only forward moves, and none once resolved", () => {
    expect(nextActions("open")).toEqual(["reviewing", "resolved"]);
    expect(nextActions("reviewing")).toEqual(["resolved"]);
    expect(nextActions("resolved")).toEqual([]);
  });

  it("states in both languages that this is not an emergency channel", () => {
    for (const locale of ["en", "ar"] as const) {
      const markup = withLocale(locale, <IncidentsPanel api={api} token="t" />);
      expect(markup).toContain(translate(locale, "incidentsScopeNote"));
      expect(markup).toContain(translate(locale, "incidentStatusReviewing"));
    }
  });

  it("does not show an empty-queue message before data arrives", () => {
    const markup = withLocale("en", <IncidentsPanel api={api} token="t" />);
    expect(markup).not.toContain(translate("en", "incidentsEmpty"));
  });
});
