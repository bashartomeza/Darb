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
const noStore: TokenStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
function recordingStore(initial: string | null = null) {
  let value = initial; const writes: string[] = [];
  return { writes, current: () => value, store: { getItem: () => value, setItem: (_key: string, next: string) => { writes.push(next); value = next; }, removeItem: () => { value = null; } } satisfies TokenStorage };
}
const signedInBody = { user: { id: "admin", role: "admin", name: "Admin", phone: "+12025550123" }, counts: {}, drivers: [], routes: [], requests: [], orders: [], trips: [], demo_reset_available: false };
async function render(locale: "ar" | "en", google = false, sessionStore: TokenStorage = noStore, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>, legacyStore: TokenStorage = noStore) {
  vi.stubGlobal("fetch", fetchImpl ? vi.fn(fetchImpl) : vi.fn().mockResolvedValue(new Response(JSON.stringify({ google_admin_login_available: google, google_admin_client_id: google ? "admin-web" : null }))));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<LocaleProvider storage={{ getItem: () => locale, setItem: () => {} }}><App config={{ appEnv: "test", apiBaseUrl: "http://api.test", demoFeaturesEnabled: false, routeManagementEnabled: false }} sessionStore={sessionStore} legacyStore={legacyStore} /></LocaleProvider>); });
}
const signedIn = () => host.querySelector(".btn--signout") !== null;
const onSignInScreen = () => host.querySelector('input[type="email"]') !== null;
describe("Admin login", () => {
  it("resumes a live cookie session on reload without storing any token", async () => {
    const session = recordingStore();
    await render("en", false, session.store, (url) => Promise.resolve(new Response(JSON.stringify(url.endsWith("/auth/capabilities") ? { google_admin_login_available: false, google_admin_client_id: null } : signedInBody))));
    expect(signedIn()).toBe(true);
    const meCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/me"));
    expect(meCall?.[1]).toEqual(expect.objectContaining({ credentials: "include", headers: expect.objectContaining({ "X-Darb-Admin-Session": "1" }) }));
    expect(session.writes).toEqual([]);
  });
  it("shows the sign-in screen without an expiry notice when there is no cookie session", async () => {
    await render("en", false, noStore, (url) => Promise.resolve(url.endsWith("/me")
      ? new Response(JSON.stringify({ error: "missing_token" }), { status: 401 })
      : new Response(JSON.stringify({ google_admin_login_available: false, google_admin_client_id: null }))));
    expect(onSignInScreen()).toBe(true);
    expect(host.textContent).not.toContain("expired");
  });
  it("purges bearer tokens that older console builds stored", async () => {
    const session = recordingStore("old-session-token"); const legacy = recordingStore("old-local-token");
    await render("en", false, session.store, undefined, legacy.store);
    expect(session.current()).toBeNull(); expect(legacy.current()).toBeNull();
  });
  it("enables email retry when the new session expires during login capability loading", async () => {
    const session = recordingStore();
    await render("en", false, session.store);
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith("/auth/admin/login") ? { user: { id: "admin", role: "admin", name: "Admin" } } : { error: "session_expired" }), { status: url.endsWith("/auth/admin/login") ? 200 : 401 }))));
    await act(async () => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(signedIn()).toBe(false);
    expect(host.textContent).toContain("Your session has expired");
    const submit = host.querySelector<HTMLButtonElement>("form > button.btn--primary");
    expect(submit).not.toBeNull(); expect(submit?.disabled).toBe(false);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(signedInBody)))));
    await act(async () => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(signedIn()).toBe(true);
    expect(session.writes).toEqual([]);
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
    await render("en", true);
    let resolveGoogle!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveGoogle = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.endsWith("/auth/admin/google")) return pending;
      return Promise.resolve(new Response(JSON.stringify({ ...signedInBody, user: { ...signedInBody.user, name: "Email Admin" } })));
    }));
    act(() => credentialCallback({ credential: "google-proof" }));
    await act(async () => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(signedIn()).toBe(true);
    const logout = host.querySelector<HTMLButtonElement>(".btn--signout"); expect(logout).not.toBeNull();
    await act(async () => logout?.click());
    expect(signedIn()).toBe(false);
    await act(async () => resolveGoogle(new Response(JSON.stringify({ user: { id: "old", role: "admin", name: "Old Admin" } }))));
    expect(signedIn()).toBe(false); expect(onSignInScreen()).toBe(true);
  });
  it.each(["succeeds", "fails", "never answers"])("sign-out revokes the server session and signs out locally when logout %s", async (outcome) => {
    const session = recordingStore();
    await render("en", false, session.store);
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/auth/logout")) {
        if (outcome === "never answers") return new Promise<Response>(() => {});
        if (outcome === "fails") return Promise.reject(new TypeError("Failed to fetch"));
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      }
      return Promise.resolve(new Response(JSON.stringify(signedInBody)));
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(signedIn()).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>(".btn--signout")?.click());
    const logoutCalls = fetchMock.mock.calls.filter(([url]) => url.endsWith("/auth/logout"));
    expect(logoutCalls).toHaveLength(1);
    // The cookie identifies the session; the request carries no bearer token.
    expect(logoutCalls[0]).toEqual(["http://api.test/api/v1/auth/logout", expect.objectContaining({ method: "POST", credentials: "include", headers: expect.objectContaining({ "X-Darb-Admin-Session": "1" }) })]);
    expect((logoutCalls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty("Authorization");
    expect(session.writes).toEqual([]);
    expect(onSignInScreen()).toBe(true);
    expect(host.textContent).not.toContain("expired");
  });
  it.each(["newer email attempt", "unmount"])("discards a deferred Google success after %s", async (superseding) => {
    let credentialCallback!: (value: { credential: string }) => void;
    vi.stubGlobal("google", { accounts: { id: { initialize: (options: { callback: typeof credentialCallback }) => { credentialCallback = options.callback; }, renderButton: () => {}, cancel: () => {} } } });
    const session = recordingStore();
    await render("en", true, session.store);
    let resolveGoogle!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveGoogle = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/auth/admin/google") ? pending : Promise.resolve(new Response(JSON.stringify({ error: "invalid_credentials" }), { status: 401 }))));
    act(() => credentialCallback({ credential: "google-proof" }));
    if (superseding === "unmount") act(() => root.unmount());
    else await act(async () => host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => resolveGoogle(new Response(JSON.stringify({ user: { id: "old", role: "admin", name: "Old Admin" } }))));
    expect(session.writes).toEqual([]);
    if (superseding === "newer email attempt") {
      expect(signedIn()).toBe(false);
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
