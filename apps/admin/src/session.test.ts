import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_SESSION_HEADER, createApiClient } from "./api";
import { translations } from "./i18n/translations";
import {
  ADMIN_TOKEN_KEY,
  createAdminSessionExpiryHandler,
  isAdminSessionEndError,
  newAdminSessionHandle,
  purgeStoredAdminTokens
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

describe("admin cookie session expiry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("purges bearer tokens older builds left in sessionStorage and localStorage", () => {
    const session = storage({ [ADMIN_TOKEN_KEY]: "session-token" });
    const legacy = storage({ [ADMIN_TOKEN_KEY]: "legacy-token" });
    purgeStoredAdminTokens(session, legacy);
    expect(session.getItem(ADMIN_TOKEN_KEY)).toBeNull();
    expect(legacy.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it("issues a distinct in-memory handle for every sign-in", () => {
    const first = newAdminSessionHandle();
    const second = newAdminSessionHandle();
    expect(first).not.toBe(second);
    expect(first).not.toMatch(/^ey/);
  });

  it("handles concurrent terminal responses once and never tries a browser refresh", async () => {
    const current = "handle-1";
    const expired = vi.fn();
    const handler = createAdminSessionExpiryHandler({ currentSession: () => current, onExpired: expired });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response('{"error":"session_expired"}', {
      status: 401,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("https://api.darb.invalid", { onSessionEnded: handler.handle });

    const results = await Promise.allSettled([
      api.me(current),
      api.dashboard(current)
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/auth/refresh"))).toBe(true);
  });

  it("normal forbidden and login credential errors do not end the session", () => {
    expect(isAdminSessionEndError(apiError("forbidden", 403))).toBe(false);
    expect(isAdminSessionEndError(apiError("invalid_credentials", 401))).toBe(false);
    expect(isAdminSessionEndError(apiError("csrf_rejected", 403))).toBe(false);
    expect(isAdminSessionEndError(apiError("session_revoked", 401))).toBe(true);
    expect(isAdminSessionEndError(apiError("session_expired", 401))).toBe(true);
    expect(isAdminSessionEndError(apiError("account_unavailable", 403))).toBe(true);
  });

  it("authenticates the overview with the session cookie, never an Authorization header", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      counts: { users: 0, drivers: 0, routes: 0, passenger_requests: 0, merchant_orders: 0, parcels: 0, active_drivers: 0, pending_driver_approvals: 0, open_incidents: 0 }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient("https://api.darb.invalid");

    await api.dashboard("handle-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.darb.invalid/api/v1/admin/dashboard");
    expect(init?.credentials).toBe("include");
    const headers = init?.headers as Record<string, string>;
    expect(headers[ADMIN_SESSION_HEADER]).toBe("1");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain("handle-1");
  });

  it("downloads files with the session cookie and reports an ended session", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"error":"session_expired"}', {
      status: 401,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const ended = vi.fn();
    const handler = createAdminSessionExpiryHandler({ currentSession: () => "handle-1", onExpired: ended });
    const api = createApiClient("https://api.darb.invalid", { onSessionEnded: handler.handle });

    await expect(api.reportExport("handle-1", "trips", {})).rejects.toThrow("session_expired");

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe("include");
    expect((init?.headers as Record<string, string>)[ADMIN_SESSION_HEADER]).toBe("1");
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(ended).toHaveBeenCalledOnce();
  });

  it("ends an unavailable account but ignores a stale response after reauthentication", () => {
    let current = "old-handle";
    const ended = vi.fn();
    const handler = createAdminSessionExpiryHandler({ currentSession: () => current, onExpired: ended });

    expect(handler.handle(apiError("account_unavailable", 403), "old-handle")).toBe(true);
    expect(ended).toHaveBeenCalledOnce();
    current = "new-handle";
    handler.reset();

    expect(handler.handle(apiError("session_revoked", 401), "old-handle")).toBe(false);
    expect(ended).toHaveBeenCalledOnce();
  });

  it("uses the approved Arabic and English expiry messages", () => {
    expect(translations.ar.sessionExpired).toBe("انتهت جلستك، يرجى تسجيل الدخول مرة أخرى");
    expect(translations.en.sessionExpired).toBe("Your session has expired. Please sign in again.");
  });
});
