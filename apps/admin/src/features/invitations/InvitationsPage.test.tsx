import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleContext";
import { translations, type Locale } from "../../i18n/translations";
import { InvitationsPage, classifyInvitationError } from "./InvitationsPage";
import { normalizeContactEmail, normalizeInvitationPhone } from "./validation";

const api = { adminInvitations: vi.fn().mockResolvedValue({ invitations: [] }) } as unknown as ApiClient;

function render(locale: Locale, children: ReactNode) {
  return renderToStaticMarkup(
    <LocaleProvider storage={{ getItem: () => locale, setItem: () => undefined }} documentRef={{ documentElement: { lang: "", dir: "" } }}>
      {children}
    </LocaleProvider>
  );
}

describe("invitation validation", () => {
  it("accepts international phones and normalises separators and Arabic digits", () => {
    expect(normalizeInvitationPhone("+970 59 123 4567")).toBe("+970591234567");
    expect(normalizeInvitationPhone("+٩٧٠٥٩١٢٣٤٥٦٧")).toBe("+970591234567");
  });

  it("rejects local, malformed and oversized phones", () => {
    for (const bad of ["0591234567", "+0591234567", "+97", "+970abc1234567", "++970591234567", "+970 5\u00001234567", "+" + "1".repeat(40)]) {
      expect(normalizeInvitationPhone(bad)).toBeNull();
    }
  });

  it("canonicalises valid emails and rejects invalid ones", () => {
    expect(normalizeContactEmail("  Person@Example.COM ")).toBe("person@example.com");
    for (const bad of ["", "no-at", "a@b", "a b@c.com", "a@@c.com", "a@c..com"]) expect(normalizeContactEmail(bad)).toBeNull();
  });
});

describe("classifyInvitationError", () => {
  it("treats the API 404 as the feature being disabled", () => {
    expect(classifyInvitationError(Object.assign(new Error("not_found"), { status: 404 }))).toBe("disabled");
    expect(classifyInvitationError(new Error("invalid_phone"))).toBe("invalid_phone");
    expect(classifyInvitationError(Object.assign(new Error("x"), { status: 429 }))).toBe("rate_limited");
    expect(classifyInvitationError(Object.assign(new Error("invitation_email_in_use"), { status: 409 }))).toBe("email_in_use");
    expect(classifyInvitationError(Object.assign(new Error("invitation_not_revocable"), { status: 409 }))).toBe("not_revocable");
    expect(classifyInvitationError(new Error("boom"))).toBe("failed");
  });
});

describe("InvitationsPage", () => {
  it("renders the create form in both locales", () => {
    const en = render("en", <InvitationsPage api={api} token="t" />);
    expect(en).toContain("Create invitation");
    expect(en).toContain("Contact email");
    const ar = render("ar", <InvitationsPage api={api} token="t" />);
    expect(ar).toContain("إنشاء دعوة");
  });

  it("shows an honest disabled state and no form when invitations are off", () => {
    const html = render("en", <InvitationsPage api={api} token="t" initialDisabled />);
    expect(html).toContain("Invitations are disabled");
    expect(html).not.toContain("<form");
  });

  it("shows the one-time code with a copy button and a send-it warning", () => {
    const html = render("en", <InvitationsPage api={api} token="t" initialCode="ABCD-EFGH" />);
    expect(html).toContain("ABCD-EFGH");
    expect(html).toContain("Copy code");
    expect(html).toContain("shown only once");
    expect(render("en", <InvitationsPage api={api} token="t" />)).not.toContain("ABCD-EFGH");
  });
});

describe("invitation translations", () => {
  it("keeps identical invitation keys in Arabic and English", () => {
    const pick = (locale: Locale) => Object.keys(translations[locale]).filter((key) => /nvitation/.test(key)).sort();
    expect(pick("ar")).toEqual(pick("en"));
    expect(pick("en").length).toBeGreaterThan(30);
  });
});
