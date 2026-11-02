import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import { translate } from "../../i18n/locale";
import { reasonKey, UncertainAiRequests, UNCERTAIN_AI_RETENTION_DAYS } from "./UncertainAiRequests";

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
  uncertainAiRequests: async () => {
    throw new Error("not called during static render");
  },
  resolveUncertainAiRequest: async () => {
    throw new Error("not called during static render");
  }
};

describe("uncertain AI requests panel", () => {
  it("states the privacy and retention note in both languages", () => {
    for (const locale of ["en", "ar"] as const) {
      const markup = withLocale(locale, <UncertainAiRequests api={api} token="t" />);
      expect(markup).toContain(translate(locale, "uncertainAiTitle"));
      expect(markup).toContain(translate(locale, "uncertainAiNote", { days: 0 }).slice(0, 40));
      expect(UNCERTAIN_AI_RETENTION_DAYS).toBe(30);
    }
  });

  it("does not show an empty queue message before data arrives", () => {
    const markup = withLocale("en", <UncertainAiRequests api={api} token="t" />);
    expect(markup).not.toContain(translate("en", "uncertainAiEmpty"));
  });

  it("maps every server reason to a label and falls back for unknown ones", () => {
    expect(reasonKey("not_understood")).toBe("uncertainAiReasonNotUnderstood");
    expect(reasonKey("unsupported_place")).toBe("uncertainAiReasonUnsupportedPlace");
    expect(reasonKey("something_new")).toBe("uncertainAiReasonOther");
  });
});
