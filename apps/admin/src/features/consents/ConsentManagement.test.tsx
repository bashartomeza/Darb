import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, ConsentRelease, ConsentReleaseDraft } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import type { Locale } from "../../i18n/translations";
import { ConsentManagement } from "./ConsentManagement";

const api = {
  consentReleases: vi.fn().mockResolvedValue({ releases: [] }),
  currentConsentRelease: vi.fn().mockResolvedValue({ ready: false, ambiguous: false, release: null })
} as unknown as ApiClient;

const release: ConsentRelease = {
  id: "release_1",
  version: "release-1",
  status: "approved",
  revision: 2,
  intended_effective_at: "2026-08-22T12:00:00.000Z",
  legal_approved_at: "2026-08-21T12:00:00.000Z",
  legal_approved_by: "admin_1",
  activated_at: null,
  activated_by: null,
  retired_at: null,
  retired_by: null,
  retirement_reason: null,
  created_by: "admin_1",
  created_at: "2026-08-21T10:00:00.000Z",
  updated_at: "2026-08-21T12:00:00.000Z",
  documents: (["terms", "privacy", "adult_self_attestation"] as const).flatMap((type) =>
    (["ar", "en"] as const).map((locale) => ({
      id: `${type}_${locale}`,
      type,
      locale,
      version: "release-1",
      content: `TEST ONLY - NOT LEGAL CONTENT - ${type}/${locale}`,
      content_digest: "a".repeat(64),
      effective_at: "2026-08-22T12:00:00.000Z",
      retired_at: null,
      legal_approved_at: "2026-08-21T12:00:00.000Z",
      legal_approved_by: "admin_1"
    }))
  )
};

const draft: ConsentReleaseDraft = {
  version: "",
  intended_effective_at: "",
  documents: (["terms", "privacy", "adult_self_attestation"] as const).flatMap((type) =>
    (["ar", "en"] as const).map((locale) => ({ type, locale, content: "" }))
  )
};

function withLocale(locale: Locale, children: ReactNode) {
  return renderToStaticMarkup(
    <LocaleProvider storage={{ getItem: () => locale, setItem: () => undefined }} documentRef={{ documentElement: { lang: "", dir: "" } }}>
      {children}
    </LocaleProvider>
  );
}

function textOf(markup: string) {
  return markup.replace(/<[^>]*>/g, " ");
}

describe("Consent Management", () => {
  it("honestly reports that onboarding is not ready when no release exists", () => {
    const markup = textOf(withLocale("en", <ConsentManagement api={api} token="token" />));
    expect(markup).toContain("NOT READY for onboarding");
    expect(markup).toContain("Approved and effective legal content has not been supplied yet.");
    expect(markup).not.toContain("TEST ONLY");
  });

  it("shows authoritative release state, approval metadata and review-only content", () => {
    const markup = textOf(withLocale("en", <ConsentManagement api={api} token="token" initialReleases={[release]} />));
    expect(markup).toContain("Approved — awaiting activation");
    expect(markup).toContain("admin_1");
    expect(markup).toContain("SHA-256 digest");
    expect(markup).toContain("Activate release");
    expect(markup).not.toContain("Retire release");
  });

  it("renders six empty plain-text fields with Arabic RTL and English LTR", () => {
    const markup = withLocale("en", <ConsentManagement api={api} token="token" initialDraft={draft} />);
    expect((markup.match(/<textarea/g) ?? [])).toHaveLength(6);
    expect((markup.match(/dir="rtl"/g) ?? [])).toHaveLength(3);
    expect((markup.match(/dir="ltr"/g) ?? [])).toHaveLength(3);
    expect(markup).not.toContain("placeholder=");
    expect(markup).not.toContain("content_digest");
  });

  it("preserves equivalent consent workflow semantics in Arabic", () => {
    const markup = textOf(withLocale("ar", <ConsentManagement api={api} token="token" initialReleases={[release]} />));
    expect(markup).toContain("إدارة الموافقات القانونية");
    expect(markup).toContain("معتمد — بانتظار التفعيل");
    expect(markup).toContain("تفعيل الإصدار");
  });
});
