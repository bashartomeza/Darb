import request from "supertest";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  authSession: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  refreshToken: { create: vi.fn(), updateMany: vi.fn() },
  pushDevice: { updateMany: vi.fn() },
  externalIdentity: { findUnique: vi.fn() },
  auditEvent: { create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { config, createConfig } = await import("../config.js");
const { signAdminCookieToken, signAuthToken } = await import("../middleware/auth.js");

const ADMIN_ORIGIN = "http://localhost:5173";
const COOKIE = "darb_admin_session";
const IDLE_MS = config.adminSession.idleTimeoutSeconds * 1_000;
const ABSOLUTE_MS = config.adminSession.absoluteTimeoutSeconds * 1_000;

const admin = {
  id: "admin_1",
  name: "Admin",
  phone: null,
  email: "admin@example.com",
  email_verified_at: new Date(),
  role: "admin" as const,
  account_status: "active",
  security_version: 1,
  demo_account: false,
  profile_state: "complete"
};

function liveSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session_admin",
    user_id: admin.id,
    client_type: "admin",
    device_name: null,
    created_at: new Date(Date.now() - 60 * 60_000),
    last_used_at: new Date(Date.now() - 60_000),
    expires_at: new Date(Date.now() + 5 * 60_000),
    revoked_at: null,
    security_version_at_issue: 1,
    user: admin,
    ...overrides
  };
}

function cookieToken() {
  return signAdminCookieToken({ id: admin.id, role: "admin", sessionId: "session_admin", securityVersion: 1 });
}

function adminCookie(value = cookieToken()) {
  return `${COOKIE}=${value}`;
}

function setCookieHeaders(response: { headers: Record<string, unknown> }) {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? (value as string[]) : value ? [String(value)] : [];
}

function sessionCookie(response: { headers: Record<string, unknown> }) {
  return setCookieHeaders(response).find((header) => header.startsWith(`${COOKIE}=`) || header.startsWith(`__Secure-${COOKIE}=`));
}

function lastSlidingExpiry() {
  const call = prismaMock.authSession.update.mock.calls.at(-1)?.[0] as { data: { expires_at?: Date } } | undefined;
  return call?.data.expires_at;
}

function adminLogin(app = createApp(), origin = ADMIN_ORIGIN) {
  return request(app)
    .post("/api/v1/auth/admin/login")
    .set("Origin", origin)
    .set("X-Darb-Admin-Session", "1")
    .send({ email: admin.email, password: "secret" });
}

describe("Admin console cookie session", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.user.findUnique.mockResolvedValue({ ...admin, password_hash: await bcrypt.hash("secret", 4) });
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.authSession.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "session_admin", revoked_at: null, ...data })
    );
    prismaMock.authSession.findUnique.mockResolvedValue(liveSession());
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.authSession.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
  });

  describe("sign-in", () => {
    it("sets an HttpOnly, SameSite=Strict, API-scoped cookie and returns no token to JavaScript", async () => {
      const before = Date.now();
      const response = await adminLogin().expect(200);

      const cookie = sessionCookie(response);
      expect(cookie).toBeDefined();
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).toContain("Path=/api/v1");
      expect(cookie).toContain(`Max-Age=${config.adminSession.absoluteTimeoutSeconds}`);
      // Local and test runs are plain http, so the cookie cannot be Secure there.
      expect(cookie).not.toContain("Secure");
      expect(response.body.token).toBeUndefined();
      expect(response.body.access_token).toBeUndefined();
      expect(response.body.refresh_token).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(cookie!.split(";")[0].split("=")[1]);
      expect(response.body.user).toMatchObject({ id: admin.id, role: "admin" });

      const created = prismaMock.authSession.create.mock.calls[0][0].data;
      expect(created.client_type).toBe("admin");
      const idleEnd = (created.expires_at as Date).getTime();
      expect(idleEnd).toBeGreaterThanOrEqual(before + IDLE_MS);
      expect(idleEnd).toBeLessThanOrEqual(Date.now() + IDLE_MS);
    });

    it("marks the cookie Secure with the __Secure- prefix in HTTPS deployments", async () => {
      const app = createApp({ ...config, adminSession: { ...config.adminSession, cookieSecure: true } });
      const response = await adminLogin(app).expect(200);
      const cookie = setCookieHeaders(response).find((header) => header.startsWith(`__Secure-${COOKIE}=`));
      expect(cookie).toBeDefined();
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
    });

    it("signs Admin Google sign-in into the same cookie session", async () => {
      const app = createApp(
        { ...config, googleAuth: { ...config.googleAuth, adminClientIds: ["admin-web"] } },
        { googleVerifier: async () => ({ sub: "subject", email: admin.email, emailVerified: true }) }
      );
      prismaMock.externalIdentity.findUnique.mockResolvedValue({ user: admin });
      const response = await request(app)
        .post("/api/v1/auth/admin/google")
        .set("Origin", ADMIN_ORIGIN)
        .set("X-Darb-Admin-Session", "1")
        .send({ id_token: "credential" })
        .expect(200);
      expect(sessionCookie(response)).toContain("HttpOnly");
      expect(response.body.token).toBeUndefined();
      expect(response.body.access_token).toBeUndefined();
    });

    it("refuses a cookie sign-in started by another site before checking credentials", async () => {
      const response = await adminLogin(createApp(), "https://evil.example").expect(403);
      expect(response.body.error).toBe("csrf_rejected");
      expect(sessionCookie(response)).toBeUndefined();
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.authSession.create).not.toHaveBeenCalled();
    });

    it("keeps the Bearer sign-in for operator tooling that does not ask for a cookie", async () => {
      const response = await request(createApp())
        .post("/api/v1/auth/admin/login")
        .send({ email: admin.email, password: "secret" })
        .expect(200);
      expect(response.body.access_token).toEqual(expect.any(String));
      expect(response.body.refresh_token).toBeUndefined();
      expect(sessionCookie(response)).toBeUndefined();
    });
  });

  describe("sliding expiry", () => {
    it("authenticates a cookie request and extends the session by the idle timeout", async () => {
      prismaMock.user.findUnique.mockResolvedValue(admin);
      const before = Date.now();
      const response = await request(createApp())
        .get("/api/v1/me")
        .set("Cookie", adminCookie())
        .set("X-Darb-Admin-Session", "1")
        .expect(200);
      expect(response.body.user.role).toBe("admin");
      const extended = lastSlidingExpiry();
      expect(extended).toBeInstanceOf(Date);
      expect(extended!.getTime()).toBeGreaterThanOrEqual(before + IDLE_MS);
      expect(extended!.getTime()).toBeLessThanOrEqual(Date.now() + IDLE_MS);
    });

    it("never extends past the absolute limit counted from sign-in", async () => {
      const createdAt = new Date(Date.now() - ABSOLUTE_MS + 10 * 60_000);
      prismaMock.authSession.findUnique.mockResolvedValue(liveSession({ created_at: createdAt }));
      prismaMock.user.findUnique.mockResolvedValue(admin);
      await request(createApp()).get("/api/v1/me").set("Cookie", adminCookie()).set("X-Darb-Admin-Session", "1").expect(200);
      expect(lastSlidingExpiry()?.getTime()).toBe(createdAt.getTime() + ABSOLUTE_MS);
    });

    it("ends an idle session and clears the cookie", async () => {
      prismaMock.authSession.findUnique.mockResolvedValue(liveSession({ expires_at: new Date(Date.now() - 1_000) }));
      const response = await request(createApp())
        .get("/api/v1/me")
        .set("Cookie", adminCookie())
        .set("X-Darb-Admin-Session", "1")
        .expect(401);
      expect(response.body.error).toBe("session_expired");
      expect(sessionCookie(response)).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(prismaMock.authSession.update).not.toHaveBeenCalled();
    });

    it("ends a session at the absolute limit even while it is in use", async () => {
      prismaMock.authSession.findUnique.mockResolvedValue(
        liveSession({ created_at: new Date(Date.now() - ABSOLUTE_MS - 1_000), expires_at: new Date(Date.now() + 60_000) })
      );
      const response = await request(createApp())
        .get("/api/v1/me")
        .set("Cookie", adminCookie())
        .set("X-Darb-Admin-Session", "1")
        .expect(401);
      expect(response.body.error).toBe("session_expired");
      expect(prismaMock.authSession.update).not.toHaveBeenCalled();
    });

    it("ends a revoked session", async () => {
      prismaMock.authSession.findUnique.mockResolvedValue(liveSession({ revoked_at: new Date() }));
      const response = await request(createApp()).get("/api/v1/me").set("Cookie", adminCookie()).set("X-Darb-Admin-Session", "1").expect(401);
      expect(response.body.error).toBe("session_revoked");
    });
  });

  describe("CSRF defence", () => {
    it("refuses a cookie request without the Admin console header", async () => {
      const response = await request(createApp())
        .post("/api/v1/auth/logout")
        .set("Origin", ADMIN_ORIGIN)
        .set("Cookie", adminCookie())
        .expect(403);
      expect(response.body.error).toBe("csrf_rejected");
      expect(prismaMock.authSession.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.authSession.updateMany).not.toHaveBeenCalled();
    });

    it("refuses a cross-site state change even when the header is present", async () => {
      const response = await request(createApp())
        .patch("/api/v1/me")
        .set("Origin", "https://evil.example")
        .set("Cookie", adminCookie())
        .set("X-Darb-Admin-Session", "1")
        .send({ name: "Taken over" })
        .expect(403);
      expect(response.body.error).toBe("csrf_rejected");
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("refuses a state change that names no origin at all", async () => {
      const response = await request(createApp())
        .patch("/api/v1/me")
        .set("Cookie", adminCookie())
        .set("X-Darb-Admin-Session", "1")
        .send({ name: "Taken over" })
        .expect(403);
      expect(response.body.error).toBe("csrf_rejected");
    });

    it("refuses a production state change from a loopback origin outside the allowlist", async () => {
      const production = createConfig({
        APP_ENV: "production",
        DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
        JWT_SECRET: config.jwtSecret,
        REFRESH_TOKEN_PEPPER: "admin-cookie-refresh-pepper-with-thirty-two-characters",
        CORS_ORIGINS: "https://admin.darb.example",
        APP_RELEASE: "admin-cookie-test",
        TRUST_PROXY: "none"
      });
      const response = await request(createApp(production))
        .post("/api/v1/auth/admin/login")
        .set("Origin", "http://localhost:5173")
        .set("X-Darb-Admin-Session", "1")
        .send({ email: admin.email, password: "secret" })
        .expect(403);
      expect(response.body.error).toBe("csrf_rejected");
    });

    it("accepts a state change from the Admin origin, falling back to Referer", async () => {
      prismaMock.user.update.mockResolvedValue({ ...admin, name: "Renamed" });
      await request(createApp())
        .patch("/api/v1/me")
        .set("Referer", `${ADMIN_ORIGIN}/#users`)
        .set("Cookie", adminCookie())
        .set("X-Darb-Admin-Session", "1")
        .send({ name: "Renamed" })
        .expect(200);
      expect(prismaMock.user.update).toHaveBeenCalledOnce();
    });
  });

  describe("logout", () => {
    it("revokes the server session and clears the cookie", async () => {
      const response = await request(createApp())
        .post("/api/v1/auth/logout")
        .set("Origin", ADMIN_ORIGIN)
        .set("Cookie", adminCookie())
        .set("X-Darb-Admin-Session", "1")
        .expect(200);
      expect(prismaMock.authSession.updateMany).toHaveBeenCalledWith({
        where: { id: "session_admin", revoked_at: null },
        data: { revoked_at: expect.any(Date), revoke_reason: "logout" }
      });
      const cleared = sessionCookie(response);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(cleared).toContain("Path=/api/v1");
    });
  });

  describe("credential separation", () => {
    it("refuses the cookie value presented as a Bearer token", async () => {
      const response = await request(createApp())
        .get("/api/v1/me")
        .set("Authorization", `Bearer ${cookieToken()}`)
        .expect(401);
      expect(response.body.error).toBe("invalid_token");
    });

    it("refuses a Bearer access token planted in the cookie", async () => {
      const bearer = signAuthToken({ id: admin.id, role: "admin", sessionId: "session_admin", securityVersion: 1 });
      const response = await request(createApp())
        .get("/api/v1/me")
        .set("Cookie", adminCookie(bearer))
        .set("X-Darb-Admin-Session", "1")
        .expect(401);
      expect(response.body.error).toBe("invalid_token");
    });

    it("leaves mobile Bearer authentication unchanged: no CSRF header, no sliding expiry", async () => {
      const passenger = { ...admin, id: "passenger_1", role: "passenger" as const };
      prismaMock.authSession.findUnique.mockResolvedValue(liveSession({ user_id: passenger.id, user: passenger, client_type: "mobile" }));
      prismaMock.user.findUnique.mockResolvedValue(passenger);
      const token = signAuthToken({ id: passenger.id, role: "passenger", sessionId: "session_admin", securityVersion: 1 });
      await request(createApp()).get("/api/v1/me").set("Authorization", `Bearer ${token}`).expect(200);
      await request(createApp())
        .patch("/api/v1/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Mobile" })
        .expect((response) => expect(response.status).not.toBe(403));
      for (const [call] of prismaMock.authSession.update.mock.calls) {
        expect(call.data).toEqual({ last_used_at: expect.any(Date) });
      }
    });
  });

  describe("CORS", () => {
    it("lets the Admin origin send credentials, the session header and DELETE", async () => {
      const response = await request(createApp())
        .options("/api/v1/auth/sessions/session_admin")
        .set("Origin", ADMIN_ORIGIN)
        .set("Access-Control-Request-Method", "DELETE")
        .set("Access-Control-Request-Headers", "x-darb-admin-session")
        .expect(204);
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
      expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
      expect(response.headers["access-control-allow-headers"].toLowerCase()).toContain("x-darb-admin-session");
    });

    it("gives other origins no credentialed access", async () => {
      const response = await request(createApp())
        .options("/api/v1/me")
        .set("Origin", "https://evil.example")
        .set("Access-Control-Request-Method", "GET")
        .expect(204);
      expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});
