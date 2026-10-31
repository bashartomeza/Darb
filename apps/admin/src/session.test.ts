import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api";
import { translations } from "./i18n/translations";
import {
  ADMIN_TOKEN_KEY,
  clearAdminSession,
  createAdminSessionExpiryHandler,
  isAdminSessionEndError
} from "./session";

function storage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
}

function apiError(code: string, status: number) {
  return Object.assign(new Error(code), { status });
}

describe("admin access-token expiry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("logout clears current sessionStorage and legacy localStorage tokens", () => {
    const session = storage({ [ADMIN_TOKEN_KEY]: "session-token" });
    const legacy = storage({ [ADMIN_TOKEN_KEY]: "legacy-token" });
    clearAdminSession(session, legacy);
    expect(session.getItem(ADMIN_TOKEN_KEY)).toBeNull();
    expect(legacy.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it("handles concurrent terminal responses once and clears both stores", async () => {
    const session = storage({ [ADMIN_TOKEN_KEY]: "access-value" });
    const legacy = storage({ [ADMIN_TOKEN_KEY]: "legacy-token" });
    const expired = vi.fn();
    const handler = createAdminSessionExpiryHandler({ sessionStore: session, legacyStore: legacy, onExpired: expired });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response('{"error":"access_token_expired"}', {
      status: 401,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("https://api.masari.invalid", { onSessionEnded: handler.handle });

    const results = await Promise.allSettled([
      api.me("access-value"),
      api.dashboard("access-value")
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(session.getItem(ADMIN_TOKEN_KEY)).toBeNull();
    expect(legacy.getItem(ADMIN_TOKEN_KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/auth/refresh"))).toBe(true);
  });

  it("normal forbidden and login credential errors do not end the session", () => {
    expect(isAdminSessionEndError(apiError("forbidden", 403))).toBe(false);
    expect(isAdminSessionEndError(apiError("invalid_credentials", 401))).toBe(false);
    expect(isAdminSessionEndError(apiError("session_revoked", 401))).toBe(true);
    expect(isAdminSessionEndError(apiError("account_unavailable", 403))).toBe(true);
  });

  it("keeps the overview API behind the current Admin bearer session", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      counts: { users: 0, drivers: 0, routes: 0, passenger_requests: 0, merchant_orders: 0, parcels: 0, active_drivers: 0, pending_driver_approvals: 0, open_incidents: 0 }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("https://api.masari.invalid");

    await api.dashboard("admin-access-token");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.masari.invalid/api/v1/admin/dashboard");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer admin-access-token");
  });

  it("keeps driver review data behind the current Admin bearer session", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"drivers":[]}', {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("https://api.masari.invalid");

    await api.drivers("admin-access-token");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.masari.invalid/api/v1/admin/drivers");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer admin-access-token");
  });

  it("ends an unavailable account but ignores a stale response after reauthentication", () => {
    const session = storage({ [ADMIN_TOKEN_KEY]: "old-access" });
    const legacy = storage({ [ADMIN_TOKEN_KEY]: "legacy-token" });
    const ended = vi.fn();
    const handler = createAdminSessionExpiryHandler({
      sessionStore: session,
      legacyStore: legacy,
      onExpired: ended
    });

    expect(handler.handle(apiError("account_unavailable", 403), "old-access")).toBe(true);
    expect(ended).toHaveBeenCalledOnce();
    session.setItem(ADMIN_TOKEN_KEY, "new-access");
    handler.reset();

    expect(handler.handle(apiError("session_revoked", 401), "old-access")).toBe(false);
    expect(session.getItem(ADMIN_TOKEN_KEY)).toBe("new-access");
    expect(ended).toHaveBeenCalledOnce();
  });

  it("uses the approved Arabic and English expiry messages", () => {
    expect(translations.ar.sessionExpired).toBe("انتهت جلستك، يرجى تسجيل الدخول مرة أخرى");
    expect(translations.en.sessionExpired).toBe("Your session has expired. Please sign in again.");
  });
});
