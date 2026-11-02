import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
const { createApp } = await import("../app.js");

const secret = "test-only-jwt-secret-with-at-least-thirty-two-characters";
function token(id: string, role: "driver" | "passenger" = "driver") {
  return jwt.sign({ role, sid: `session_${id}`, ver: 1 }, secret, {
    subject: id,
    expiresIn: "1h",
  });
}
function auth(id: string, role: "driver" | "passenger" = "driver") {
  return { Authorization: `Bearer ${token(id, role)}` };
}

describe("legacy driver online-state API", () => {
  const service = { setState: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        const id = where.id.replace("session_", "");
        const role = id.startsWith("passenger") ? "passenger" : "driver";
        return {
          id: where.id,
          user_id: id,
          user: { email_verified_at: new Date(), id, role, account_status: "active", security_version: 1 },
          security_version_at_issue: 1,
          expires_at: new Date(Date.now() + 60_000),
          revoked_at: null,
        };
      },
    );
    prismaMock.authSession.update.mockResolvedValue({});
    service.setState.mockResolvedValue({
      online: true,
      routeId: "route_1",
      replayed: false,
      changed: true,
    });
  });

  it("requires an authenticated driver and a valid idempotency key", async () => {
    const app = createApp(undefined, {
      legacyDriverOnlineStateService: service as never,
    });
    await request(app)
      .put("/api/v1/driver/online-state")
      .send({ online: true })
      .expect(401);
    await request(app)
      .put("/api/v1/driver/online-state")
      .set(auth("passenger_1", "passenger"))
      .send({ online: true })
      .expect(403);
    await request(app)
      .put("/api/v1/driver/online-state")
      .set(auth("driver_1"))
      .send({ online: true })
      .expect(400);
    expect(service.setState).not.toHaveBeenCalled();
  });

  it("forwards the explicit desired state, owner, route revision and stable key", async () => {
    const app = createApp(undefined, {
      legacyDriverOnlineStateService: service as never,
    });
    const response = await request(app)
      .put("/api/v1/driver/online-state")
      .set(auth("driver_1"))
      .set("Idempotency-Key", "stable-online-key")
      .send({ online: false, expected_route_id: "route_1" })
      .expect(200);
    expect(service.setState).toHaveBeenCalledWith(
      { online: false, expectedRouteId: "route_1" },
      expect.objectContaining({
        id: "driver_1",
        idempotencyKey: "stable-online-key",
      }),
    );
    expect(response.body).toEqual(
      expect.objectContaining({
        online: true,
        route_id: "route_1",
        replayed: false,
      }),
    );
  });

  it("strictly rejects toggle-shaped or malformed payloads", async () => {
    const app = createApp(undefined, {
      legacyDriverOnlineStateService: service as never,
    });
    for (const body of [
      {},
      { toggle: true },
      { online: "true" },
      { online: true, extra: true },
    ]) {
      await request(app)
        .put("/api/v1/driver/online-state")
        .set(auth("driver_1"))
        .set("Idempotency-Key", "stable-online-key")
        .send(body)
        .expect(400);
    }
    expect(service.setState).not.toHaveBeenCalled();
  });

  it("fails before mutation for suspended or revoked sessions", async () => {
    const app = createApp(undefined, {
      legacyDriverOnlineStateService: service as never,
    });
    prismaMock.authSession.findUnique.mockResolvedValueOnce({
      id: "session_driver_1",
      user_id: "driver_1",
      user: {
        id: "driver_1",
        role: "driver",
        account_status: "suspended",
        security_version: 1,
      },
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    });
    await request(app)
      .put("/api/v1/driver/online-state")
      .set(auth("driver_1"))
      .set("Idempotency-Key", "stable-online-key")
      .send({ online: true })
      .expect(403);
    prismaMock.authSession.findUnique.mockResolvedValueOnce({
      id: "session_driver_1",
      user_id: "driver_1",
      user: {
        id: "driver_1",
        role: "driver",
        account_status: "active",
        security_version: 1,
      },
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: new Date(),
    });
    await request(app)
      .put("/api/v1/driver/online-state")
      .set(auth("driver_1"))
      .set("Idempotency-Key", "stable-online-key")
      .send({ online: true })
      .expect(401);
    expect(service.setState).not.toHaveBeenCalled();
  });
});
