import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  passengerRequest: { create: vi.fn() },
  user: { findUnique: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");
const { isProfileCompletionSafePath } = await import("../middleware/profileState.js");

const appConfig = createConfig({
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/masari_test",
  JWT_SECRET: "profile-state-test-secret-with-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent"
});

const phoneRequiredUser = {
  id: "phone_required_user",
  role: "passenger",
  account_status: "active",
  security_version: 1,
  profile_state: "phone_required"
};

function authorization(
  role: "passenger" | "driver" | "merchant",
  options: { accountStatus?: "active" | "suspended"; revokedAt?: Date | null } = {}
) {
  const sessionId = `session_${role}`;
  prismaMock.authSession.findUnique.mockResolvedValue({
    id: sessionId,
    user_id: phoneRequiredUser.id,
    user: { ...phoneRequiredUser, role, account_status: options.accountStatus ?? "active" },
    security_version_at_issue: 1,
    expires_at: new Date(Date.now() + 60_000),
    revoked_at: options.revokedAt ?? null
  });
  return `Bearer ${signAuthToken({
    id: phoneRequiredUser.id,
    role,
    sessionId,
    securityVersion: 1
  })}`;
}

describe("complete profile gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.update.mockResolvedValue({});
  });

  it.each([
    ["passenger", "post", "/api/v1/passenger/requests", {
      pickup_label: "Hebron", pickup_lat: 31.5326, pickup_lng: 35.0998,
      destination_label: "Bethlehem", destination_lat: 31.7054, destination_lng: 35.2024,
      preferred_time: "2026-09-15T10:00:00.000Z", passenger_count: 1
    }],
    ["driver", "get", "/api/v1/driver/routes", undefined],
    ["driver", "get", "/api/v1/driver/availabilities", undefined],
    ["driver", "get", "/api/v1/driver/canonical-match-offers", undefined],
    ["merchant", "get", "/api/v1/merchant/orders", undefined],
    ["merchant", "post", "/api/v1/merchant/orders/order_1/batch", undefined],
    ["merchant", "get", "/api/v1/merchant/route-orders", undefined],
    ["passenger", "get", "/api/v1/trips", undefined],
    ["passenger", "get", "/api/v1/passenger/route-requests", undefined],
    ["passenger", "get", "/api/v1/matches", undefined]
  ] as const)("blocks a phone-required %s at %s", async (role, method, path, body) => {
    let response = request(createApp(appConfig))[method](path).set("Authorization", authorization(role));
    if (body) response = response.send(body);

    const result = await response.expect(403);

    expect(result.body.error).toBe("profile_incomplete");
  });

  it("keeps capabilities available while the profile is incomplete", async () => {
    const result = await request(createApp(appConfig))
      .get("/api/v1/capabilities")
      .set("Authorization", authorization("passenger"))
      .expect(200);

    expect(result.body).toHaveProperty("maps_available");
  });

  it("keeps the actual me endpoint available while the profile is incomplete", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...phoneRequiredUser,
      name: "Phone Required",
      phone: null,
      email: "phone-required@example.test",
      email_verified_at: null,
      phone_verified_at: null,
      google_sub: null,
      password_hash: null,
      demo_account: false,
      created_at: new Date()
    });

    await request(createApp(appConfig))
      .get("/api/v1/me")
      .set("Authorization", authorization("passenger"))
      .expect(200);
  });

  it("preserves account-status authority over the profile gate", async () => {
    const result = await request(createApp(appConfig))
      .get("/api/v1/trips")
      .set("Authorization", authorization("passenger", { accountStatus: "suspended" }))
      .expect(403);

    expect(result.body.error).toBe("account_unavailable");
  });

  it.each([
    "/api/v1/me",
    "/api/v1/ME/",
    "/api/v1/auth",
    "/api/v1/AUTH/sessions/",
    "/api/v1/capabilities/",
    "/api/v1/ONBOARDING/CONSENTS/",
    "/api/v1/profile/phone/start-verification",
    "/api/v1/PROFILE/PHONE/CONFIRM-VERIFICATION/"
  ])("recognizes an Express-equivalent completion-safe path: %s", (originalUrl) => {
    expect(isProfileCompletionSafePath({ originalUrl } as never)).toBe(true);
  });

  it.each([
    "/api/v1/profile/phone/start-verification/unexpected",
    "/api/v1/profile/phone/confirm-verification/unexpected",
    "/api/v1/profile/telephone/start-verification",
    "/api/v1/phone-verification"
  ])("does not broaden phone completion exceptions: %s", (originalUrl) => {
    expect(isProfileCompletionSafePath({ originalUrl } as never)).toBe(false);
  });

  it("does not invoke an operational handler for an incomplete profile", async () => {
    await request(createApp(appConfig))
      .post("/api/v1/passenger/requests")
      .set("Authorization", authorization("passenger"))
      .send({
        pickup_label: "Hebron", pickup_lat: 31.5326, pickup_lng: 35.0998,
        destination_label: "Bethlehem", destination_lat: 31.7054, destination_lng: 35.2024,
        preferred_time: "2026-09-15T10:00:00.000Z", passenger_count: 1
      })
      .expect(403);

    expect(prismaMock.passengerRequest.create).not.toHaveBeenCalled();
  });
});
