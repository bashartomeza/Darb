import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  user: { findUnique: vi.fn(), update: vi.fn() },
  authSession: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
  },
  refreshToken: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
  },
  auditEvent: { create: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");
const { createRefreshToken, parseRefreshToken } = await import("../lib/refreshTokens.js");

const user = {
  email_verified_at: new Date(),
  id: "user_1",
  name: "Passenger",
  phone: "+970590000001",
  role: "passenger" as const,
  account_status: "active",
  security_version: 1,
  demo_account: false
};

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "session_1",
    user_id: user.id,
    client_type: "mobile",
    device_name: "Android emulator",
    created_at: new Date("2026-07-17T09:00:00.000Z"),
    last_used_at: new Date("2026-07-17T09:00:00.000Z"),
    expires_at: new Date(Date.now() + 86_400_000),
    revoked_at: null,
    revoke_reason: null,
    security_version_at_issue: 1,
    user,
    ...overrides
  };
}

function accessToken() {
  return signAuthToken({ id: user.id, role: user.role, sessionId: "session_1", securityVersion: 1 });
}

function authorization() {
  return { Authorization: `Bearer ${accessToken()}` };
}

function storedRefresh(material = createRefreshToken("passenger"), overrides: Record<string, unknown> = {}) {
  return {
    id: material.id,
    session_id: "session_1",
    token_hash: material.tokenHash,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86_400_000),
    used_at: null,
    revoked_at: null,
    replaced_by_id: null,
    session: session(),
    ...overrides
  };
}

describe("refresh rotation and session APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.authSession.findUnique.mockResolvedValue(session());
    prismaMock.authSession.findMany.mockResolvedValue([session()]);
    prismaMock.authSession.findFirst.mockResolvedValue(session());
    prismaMock.authSession.update.mockResolvedValue(session());
    prismaMock.authSession.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.refreshToken.update.mockResolvedValue({});
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUnique.mockResolvedValue(user);
    prismaMock.user.update.mockResolvedValue(user);
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit_1" });
  });

  it("rotates a valid refresh token once and lets the replacement rotate", async () => {
    const initial = createRefreshToken("passenger");
    prismaMock.refreshToken.findUnique.mockResolvedValue(storedRefresh(initial));

    const first = await request(createApp())
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: initial.rawToken })
      .expect(200);

    expect(first.body).toEqual(
      expect.objectContaining({
        token: expect.any(String),
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        session: expect.objectContaining({ id: "session_1" })
      })
    );
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: initial.id, used_at: null }) })
    );
    const firstCreated = prismaMock.refreshToken.create.mock.calls[0][0].data;
    expect(JSON.stringify(first.body)).not.toContain(firstCreated.token_hash);

    const replacement = parseRefreshToken(first.body.refresh_token)!;
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      storedRefresh(
        {
          id: replacement.id,
          roleAtIssue: replacement.roleAtIssue,
          rawToken: replacement.rawToken,
          tokenHash: firstCreated.token_hash
        },
        { id: replacement.id, token_hash: firstCreated.token_hash }
      )
    );
    await request(createApp())
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: first.body.refresh_token })
      .expect(200);
  });

  it("creates both replacement credentials before the refresh transaction callback resolves", async () => {
    const initial = createRefreshToken("passenger");
    prismaMock.refreshToken.findUnique.mockResolvedValue(storedRefresh(initial));
    prismaMock.$transaction.mockImplementationOnce(async (callback: (tx: typeof prismaMock) => unknown) => {
      const result = await callback(prismaMock);
      expect(result).toEqual(
        expect.objectContaining({
          kind: "success",
          token: expect.any(String),
          refreshToken: expect.any(String)
        })
      );
      return result;
    });

    await request(createApp())
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: initial.rawToken })
      .expect(200);
  });

  it("detects reuse and revokes the affected session without exposing token internals", async () => {
    const material = createRefreshToken("passenger");
    prismaMock.refreshToken.findUnique.mockResolvedValue(storedRefresh(material, { used_at: new Date() }));

    const response = await request(createApp())
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: material.rawToken })
      .expect(401);

    expect(response.body).toEqual(
      expect.objectContaining({ error: "refresh_token_reused", request_id: expect.any(String) })
    );
    expect(JSON.stringify(response.body)).not.toContain(material.id);
    expect(prismaMock.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revoke_reason: "refresh_token_reuse" }) })
    );
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ session_id: "session_1" }) })
    );
  });

  it("rejects expired and revoked refresh tokens", async () => {
    const material = createRefreshToken("passenger");
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      storedRefresh(material, { expires_at: new Date(Date.now() - 1) })
    );
    await request(createApp()).post("/api/v1/auth/refresh").send({ refresh_token: material.rawToken }).expect(401);

    prismaMock.refreshToken.findUnique.mockResolvedValue(storedRefresh(material, { revoked_at: new Date() }));
    await request(createApp()).post("/api/v1/auth/refresh").send({ refresh_token: material.rawToken }).expect(401);
  });

  it("blocks refresh when the account is suspended", async () => {
    const material = createRefreshToken("passenger");
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      storedRefresh(material, { session: session({ user: { ...user, account_status: "suspended" } }) })
    );
    const response = await request(createApp())
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: material.rawToken })
      .expect(403);
    expect(response.body.error).toBe("account_unavailable");
  });

  it("revokes a mobile session instead of elevating a role-changed refresh credential", async () => {
    const material = createRefreshToken("passenger");
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      storedRefresh(material, {
        session: session({ user: { ...user, role: "admin" } })
      })
    );

    const response = await request(createApp())
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: material.rawToken })
      .expect(401);

    expect(response.body.error).toBe("invalid_session");
    expect(prismaMock.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revoke_reason: "refresh_role_or_client_changed" }) })
    );
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it("caps replacement lifetime at the absolute session expiry", async () => {
    const material = createRefreshToken("passenger");
    const sessionExpiry = new Date(Date.now() + 60_000);
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      storedRefresh(material, { session: session({ expires_at: sessionExpiry }) })
    );

    const response = await request(createApp())
      .post("/api/v1/auth/refresh")
      .send({ refresh_token: material.rawToken })
      .expect(200);

    const created = prismaMock.refreshToken.create.mock.calls[0][0].data;
    expect(created.expires_at.getTime()).toBe(sessionExpiry.getTime());
    expect(response.body.refresh_token_expires_in).toBeGreaterThan(0);
    expect(response.body.refresh_token_expires_in).toBeLessThanOrEqual(60);
  });

  it("lists only the authenticated user's safe session summaries", async () => {
    const response = await request(createApp()).get("/api/v1/auth/sessions").set(authorization()).expect(200);
    expect(prismaMock.authSession.findMany).toHaveBeenCalledWith({
      where: { user_id: user.id },
      orderBy: { created_at: "desc" }
    });
    expect(response.body.sessions[0]).toEqual({
      id: "session_1",
      client_type: "mobile",
      device_name: "Android emulator",
      created_at: expect.any(String),
      last_used_at: expect.any(String),
      expires_at: expect.any(String),
      is_current: true,
      revoked: false
    });
    for (const forbidden of ["token_hash", "refresh_token", "revoke_reason", "security_version_at_issue", "user_id"]) {
      expect(JSON.stringify(response.body)).not.toContain(forbidden);
    }
  });

  it("revokes an owned session and hides unrelated session IDs", async () => {
    await request(createApp()).delete("/api/v1/auth/sessions/session_1").set(authorization()).expect(200);
    expect(prismaMock.authSession.findFirst).toHaveBeenCalledWith({
      where: { id: "session_1", user_id: user.id }
    });
    expect(prismaMock.authSession.updateMany).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockResolvedValue(session());
    prismaMock.authSession.update.mockResolvedValue(session());
    prismaMock.authSession.findFirst.mockResolvedValue(null);
    await request(createApp()).delete("/api/v1/auth/sessions/other_session").set(authorization()).expect(404);
    expect(prismaMock.authSession.updateMany).not.toHaveBeenCalled();
  });

  it("logs out the current session and repeated logout stays safe", async () => {
    await request(createApp()).post("/api/v1/auth/logout").set(authorization()).expect(200);
    prismaMock.authSession.findUnique.mockResolvedValue(session({ revoked_at: new Date() }));
    await request(createApp()).post("/api/v1/auth/logout").set(authorization()).expect(200);
    expect(prismaMock.authSession.updateMany).toHaveBeenCalledTimes(2);
  });

  it("logs out all sessions, increments security version, and invalidates the access token", async () => {
    await request(createApp()).post("/api/v1/auth/logout-all").set(authorization()).expect(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { security_version: { increment: 1 } }
    });

    prismaMock.authSession.findUnique.mockResolvedValue(
      session({ user: { ...user, security_version: 2 }, security_version_at_issue: 1 })
    );
    await request(createApp()).get("/api/v1/me").set(authorization()).expect(401);
  });
});
