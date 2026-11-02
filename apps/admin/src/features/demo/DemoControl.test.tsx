import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleContext";
import { DemoControl } from "./DemoControl";

function render(resetAvailable: boolean, locale: "ar" | "en" = "en") {
  return renderToStaticMarkup(
    <LocaleProvider
      storage={{ getItem: () => locale, setItem: () => undefined }}
      documentRef={{ documentElement: { lang: "", dir: "" } }}
    >
      <DemoControl
        resetKey=""
        onResetKeyChange={vi.fn()}
        steps={[]}
        canAct
        resetAvailable={resetAvailable}
        busy={null}
        onReset={vi.fn()}
        onRefresh={vi.fn()}
        onRunFullDemo={vi.fn()}
      />
    </LocaleProvider>
  );
}

describe("DemoControl reset safety", () => {
  it("disables destructive controls and shows an honest unavailable state", () => {
    const markup = render(false);
    expect(markup).toContain("Demo reset is unavailable");
    expect((markup.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps authorized reset controls available on a server-approved database", () => {
    const markup = render(true);
    expect(markup).not.toContain("Demo reset is unavailable");
  });

  it("retains the Arabic unavailable state", () => {
    expect(render(false, "ar")).toContain("إعادة ضبط العرض غير متاحة");
  });
});
