import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleContext";
import { translate } from "../../i18n/locale";
import { translations, type Locale } from "../../i18n/translations";
import { PARCEL_STATE_LABEL, PARCEL_STATE_TONE, PassengerParcelsPanel } from "./PassengerParcelsPanel";

function render(locale: Locale) {
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  return renderToStaticMarkup(
    <LocaleProvider storage={storage} documentRef={documentRef}>
      <PassengerParcelsPanel api={{ passengerParcels: async () => ({ parcels: [] }) }} token="t" />
    </LocaleProvider>
  );
}

describe("passenger parcels panel", () => {
  it("has an English and Arabic label and a tone for every tracking state", () => {
    for (const state of Object.keys(PARCEL_STATE_LABEL) as Array<keyof typeof PARCEL_STATE_LABEL>) {
      expect(PARCEL_STATE_TONE[state]).toBeTruthy();
      for (const locale of ["en", "ar"] as const) {
        expect(translations[locale][PARCEL_STATE_LABEL[state]]).toBeTruthy();
      }
    }
  });

  it("states in both languages that receiver details are never shown", () => {
    for (const locale of ["en", "ar"] as const) {
      expect(render(locale)).toContain(translate(locale, "passengerParcelsScopeNote"));
    }
  });
});
