import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleContext";
import { translate } from "../../i18n/locale";
import type { Locale } from "../../i18n/translations";
import { SuccessMetricsPanel } from "./SuccessMetricsPanel";

const KEYS = [
  "matching_time", "ai_understanding", "status_continuity", "batch_efficiency", "driver_utilization",
  "user_satisfaction", "driver_verification", "pickup_clarity", "route_deviation"
] as const;

function render(locale: Locale) {
  const storage = { getItem: () => locale, setItem: () => undefined };
  const documentRef = { documentElement: { lang: "", dir: "" } };
  const api = {
    successMetrics: async () => {
      throw new Error("not called during static render");
    },
    successMetricsExport: async () => new Blob()
  };
  return renderToStaticMarkup(
    <LocaleProvider storage={storage} documentRef={documentRef}>
      <SuccessMetricsPanel api={api} token="t" />
    </LocaleProvider>
  );
}

describe("success metrics panel", () => {
  it("renders the controls and privacy note in both languages", () => {
    for (const locale of ["en", "ar"] as const) {
      const markup = render(locale);
      expect(markup).toContain(translate(locale, "successMetricsTitle"));
      expect(markup).toContain(translate(locale, "successMetricsExport"));
      expect(markup).toContain(translate(locale, "successMetricsPrivacy"));
    }
  });

  it("translates every metric name and target in both languages", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const key of KEYS) {
        expect(translate(locale, `sm_${key}` as never)).not.toBe(`sm_${key}`);
        expect(translate(locale, `sm_${key}_target` as never)).not.toBe(`sm_${key}_target`);
      }
    }
  });
});
