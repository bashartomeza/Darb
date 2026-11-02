// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { LocaleProvider } from "./i18n/LocaleContext";
import type { TokenStorage } from "./session";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); vi.unstubAllGlobals(); });
async function render(locale: "ar" | "en", google = false, sessionStore: TokenStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ google_admin_login_available: google, google_admin_client_id: google ? "admin-web" : null }))));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<LocaleProvider storage={{ getItem: () => locale, setItem: () => {} }}><App config={{ appEnv: "test", apiBaseUrl: "http://api.test", demoFeaturesEnabled: false, routeManagementEnabled: false }} sessionStore={sessionStore} legacyStore={{ getItem: () => null, setItem: () => {}, removeItem: () => {} }} /></LocaleProvider>); });
}
describe("Admin login", () => {
  it("enables email retry when the new session expires during login capability loading", async () => {
    let stored: string | null = null;
    await render("en", false, { getItem: () => stored, setItem: (_key, token) => { stored = token; }, removeItem: () => { stored = null; } });
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith("/auth/admin/login") ? { token: "expired-session", user: { id: "admin", role: "admin", name: "Admin" } } : { error: "access_token_expired" }), { status: url.endsWith("/auth/admin/login") ? 200 : 401 }))));
    await act(async () => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(stored).toBeNull();
    const submit = host.querySelector<HTMLButtonElement>("form > button.btn--primary");
    expect(submit).not.toBeNull(); expect(submit?.disabled).toBe(false);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ token: "retry-session", user: { id: "admin", role: "admin", name: "Admin", phone: "+12025550123" }, counts: {}, drivers: [], routes: [], requests: [], orders: [], trips: [], demo_reset_available: false })))));
    await act(async () => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(stored).toBe("retry-session");
  });
  it.each([200, 401])("does not announce a stale email outcome (%s) during a newer Google attempt", async (status) => {
    let credentialCallback!: (value: { credential: string }) => void;
    vi.stubGlobal("google", { accounts: { id: { initialize: (options: { callback: typeof credentialCallback }) => { credentialCallback = options.callback; }, renderButton: () => {}, cancel: () => {} } } });
    await render("en", true);
    let resolveEmail!: (response: Response) => void;
    const pendingEmail = new Promise<Response>((resolve) => { resolveEmail = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/auth/admin/login") ? pendingEmail : new Promise<Response>(() => {})));
    act(() => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    act(() => credentialCallback({ credential: "google-proof" }));
    await act(async () => resolveEmail(new Response(JSON.stringify(status === 200 ? { token: "old-email", user: { id: "admin", role: "admin" } } : { error: "invalid_credentials" }), { status })));
    expect(host.textContent).not.toContain("Admin logged in.");
    expect(host.textContent).not.toContain("Check your credentials");
  });
  it("keeps logout effective when an older Google exchange finishes after email login", async () => {
    let credentialCallback!: (value: { credential: string }) => void;
    vi.stubGlobal("google", { accounts: { id: { initialize: (options: { callback: typeof credentialCallback }) => { credentialCallback = options.callback; }, renderButton: () => {}, cancel: () => {} } } });
    let stored: string | null = null;
    await render("en", true, { getItem: () => stored, setItem: (_key, token) => { stored = token; }, removeItem: () => { stored = null; } });
    let resolveGoogle!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveGoogle = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.endsWith("/auth/admin/google")) return pending;
      return Promise.resolve(new Response(JSON.stringify({ token: "email-session", user: { id: "admin", role: "admin", name: "Email Admin", phone: "+12025550123" }, counts: {}, drivers: [], routes: [], requests: [], orders: [], trips: [], demo_reset_available: false })));
    }));
    act(() => credentialCallback({ credential: "google-proof" }));
    await act(async () => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(stored).toBe("email-session");
    const logout = host.querySelector<HTMLButtonElement>(".btn--signout"); expect(logout).not.toBeNull();
    await act(async () => logout?.click());
    expect(stored).toBeNull();
    await act(async () => resolveGoogle(new Response(JSON.stringify({ token: "stale-google-session", user: { id: "old", role: "admin", name: "Old Admin" } }))));
    expect(stored).toBeNull(); expect(host.querySelector('input[type="email"]')).not.toBeNull();
  });
  it.each(["newer email attempt", "unmount"])("discards a deferred Google success after %s", async (superseding) => {
    let credentialCallback!: (value: { credential: string }) => void;
    vi.stubGlobal("google", { accounts: { id: { initialize: (options: { callback: typeof credentialCallback }) => { credentialCallback = options.callback; }, renderButton: () => {}, cancel: () => {} } } });
    const saved: string[] = [];
    await render("en", true, { getItem: () => null, setItem: (_key, token) => saved.push(token), removeItem: () => {} });
    let resolveGoogle!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveGoogle = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/auth/admin/google") ? pending : Promise.resolve(new Response(JSON.stringify({ error: "invalid_credentials" }), { status: 401 }))));
    act(() => credentialCallback({ credential: "google-proof" }));
    if (superseding === "unmount") act(() => root.unmount());
    else await act(async () => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => resolveGoogle(new Response(JSON.stringify({ token: "stale-google-session", user: { id: "old", role: "admin", name: "Old Admin" } }))));
    expect(saved).toEqual([]);
    if (superseding === "newer email attempt") {
      expect(host.querySelector('section[aria-label="Google"]')?.getAttribute("aria-busy")).toBe("false");
      const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry");
      expect(retry).toBeDefined(); act(() => retry?.click());
      expect(host.querySelector('[data-google-sign-in]')?.hasAttribute("hidden")).toBe(false);
    }
  });
  it.each(["ar", "en"] as const)("offers accessible email login in %s with direction preserved", async (locale) => {
    await render(locale);
    expect(host.querySelector('main')?.getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");
    const email = host.querySelector('input[type="email"]');
    expect(email).not.toBeNull(); expect(email?.getAttribute("autocomplete")).toBe("username");
    expect(email?.closest("label")?.textContent).toBe(locale === "ar" ? "البريد الإلكتروني للمسؤول" : "Admin email");
    expect(host.querySelector('input[type="tel"]')).toBeNull();
    expect(host.querySelector('[data-google-sign-in]')).toBeNull();
  });
  it("renders Google only with capability and passes the exact Admin audience to the SDK", async () => {
    const initialize = vi.fn(); const renderButton = vi.fn((element: HTMLElement) => { const b = document.createElement("button"); b.textContent = "Sign in with Google"; element.append(b); });
    vi.stubGlobal("google", { accounts: { id: { initialize, renderButton, cancel: vi.fn() } } });
    await render("en", true);
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: "admin-web", auto_select: false }));
    expect(host.querySelector('[data-google-sign-in]')?.textContent).toContain("Sign in with Google");
  });
  it("allows cancellation during SDK loading without starting a session", async () => {
    await render("en", true);
    const cancel = [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    expect(cancel).toBeDefined();
    act(() => cancel?.click());
    expect(host.textContent).toContain("Google sign-in cancelled");
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry");
    expect(retry).toBeDefined();
    act(() => retry?.click());
    expect(host.textContent).toContain("Loading Google sign-in");
  });
  it("announces provider load failure without removing email login", async () => {
    await render("en", true);
    const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    act(() => script?.dispatchEvent(new Event("error")));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Google sign-in is unavailable");
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
  });
});
