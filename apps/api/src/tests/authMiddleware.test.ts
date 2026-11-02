import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { authenticateAuthToken, signAuthToken } = await import("../middleware/auth.js");

const user = {
  email_verified_at: new Date(),
  id: "user_1",
  role: "passenger" as const,
  account_status: "active",
  security_version: 1
};

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "session_1",
    user_id: user.id,
    user,
    security_version_at_issue: 1,
    expires_at: new Date(Date.now() + 60_000),
    revoked_at: null,
    ...overrides
  };
}

function token(overrides: Partial<{ id: string; role: typeof user.role; sessionId: string; securityVersion: number }> = {}) {
  return signAuthToken({
    id: overrides.id ?? user.id,
    role: overrides.role ?? user.role,
    sessionId: overrides.sessionId ?? "session_1",
    securityVersion: overrides.securityVersion ?? 1
  });
}

describe("server-managed authentication middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockResolvedValue(session());
    prismaMock.authSession.update.mockResolvedValue({});
  });

  it("accepts an active user with a valid live session", async () => {
    await expect(authenticateAuthToken(token())).resolves.toEqual({
      emailVerified: true,
      id: user.id,
      role: user.role,
      sessionId: "session_1",
      securityVersion: 1,
      profileState: "complete"
    });
    expect(prismaMock.authSession.update).toHaveBeenCalledOnce();
  });

  it("rejects a revoked session immediately", async () => {
    prismaMock.authSession.findUnique.mockResolvedValue(session({ revoked_at: new Date() }));
    await expect(authenticateAuthToken(token())).rejects.toMatchObject({ statusCode: 401, message: "session_revoked" });
  });

  for (const accountStatus of ["pending", "suspended", "disabled"] as const) {
    it(`rejects a ${accountStatus} account immediately`, async () => {
      prismaMock.authSession.findUnique.mockResolvedValue(
        session({ user: { ...user, account_status: accountStatus } })
      );
      await expect(authenticateAuthToken(token())).rejects.toMatchObject({
        statusCode: 403,
        message: "account_unavailable"
      });
    });
  }

  it("rejects a security-version mismatch", async () => {
    prismaMock.authSession.findUnique.mockResolvedValue(
      session({ user: { ...user, security_version: 2 }, security_version_at_issue: 2 })
    );
    await expect(authenticateAuthToken(token())).rejects.toMatchObject({ statusCode: 401, message: "invalid_session" });
  });

  it("rejects an expired session", async () => {
    prismaMock.authSession.findUnique.mockResolvedValue(session({ expires_at: new Date(Date.now() - 1) }));
    await expect(authenticateAuthToken(token())).rejects.toMatchObject({ statusCode: 401, message: "session_expired" });
  });

  it("rejects user and session ownership mismatches", async () => {
    prismaMock.authSession.findUnique.mockResolvedValue(session({ user_id: "other_user" }));
    await expect(authenticateAuthToken(token())).rejects.toMatchObject({ statusCode: 401, message: "invalid_session" });
  });

  it("rejects a validly signed token that uses an unsupported HMAC algorithm", async () => {
    const unsupported = jwt.sign(
      { role: user.role, sid: "session_1", ver: 1 },
      process.env.JWT_SECRET!,
      { algorithm: "HS512", subject: user.id, expiresIn: "1h" }
    );

    await expect(authenticateAuthToken(unsupported)).rejects.toMatchObject({ statusCode: 401, message: "invalid_token" });
    expect(prismaMock.authSession.findUnique).not.toHaveBeenCalled();
  });

  it("distinguishes an expired access token before session lookup", async () => {
    const expired = jwt.sign(
      { role: user.role, sid: "session_1", ver: 1 },
      process.env.JWT_SECRET!,
      { algorithm: "HS256", subject: user.id, expiresIn: -1 }
    );

    await expect(authenticateAuthToken(expired)).rejects.toMatchObject({
      statusCode: 401,
      message: "access_token_expired"
    });
    expect(prismaMock.authSession.findUnique).not.toHaveBeenCalled();
  });
});
