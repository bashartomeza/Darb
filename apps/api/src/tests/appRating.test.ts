import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  appRating: { findUnique: vi.fn(), upsert: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");

const user = {
  id: "user_1",
  name: "Demo Passenger",
  phone: null,
  email: "passenger@example.com",
  email_verified_at: new Date(),
  role: "passenger" as const,
  account_status: "active",
  security_version: 1,
  profile_state: "complete",
  demo_account: false
};

const bearer = () => ({
  Authorization: `Bearer ${signAuthToken({ id: user.id, role: "passenger", sessionId: "session_1", securityVersion: 1 })}`
});
const savedAt = new Date("2026-11-03T10:00:00.000Z");

describe("app rating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.authSession.findUnique.mockResolvedValue({
      id: "session_1",
      user_id: user.id,
      user,
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null
    });
    prismaMock.authSession.update.mockResolvedValue({});
    prismaMock.appRating.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({ ...create, created_at: savedAt, updated_at: savedAt }));
  });

  it("returns null before the user has rated", async () => {
    prismaMock.appRating.findUnique.mockResolvedValue(null);
    const response = await request(createApp()).get("/api/v1/me/app-rating").set(bearer()).expect(200);

    expect(response.body).toEqual({ rating: null });
    expect(prismaMock.appRating.findUnique).toHaveBeenCalledWith({ where: { user_id: "user_1" } });
  });

  it("returns the saved rating", async () => {
    prismaMock.appRating.findUnique.mockResolvedValue({ user_id: "user_1", stars: 4, feedback: "Works well", created_at: savedAt, updated_at: savedAt });
    const response = await request(createApp()).get("/api/v1/me/app-rating").set(bearer()).expect(200);

    expect(response.body).toEqual({ rating: { stars: 4, feedback: "Works well", updated_at: savedAt.toISOString() } });
  });

  it("saves one rating per user in the database, replacing the previous one", async () => {
    const response = await request(createApp())
      .put("/api/v1/me/app-rating")
      .set(bearer())
      .send({ stars: 5, feedback: "  Great app  " })
      .expect(200);

    expect(prismaMock.appRating.upsert).toHaveBeenCalledWith({
      where: { user_id: "user_1" },
      create: { user_id: "user_1", stars: 5, feedback: "Great app" },
      update: { stars: 5, feedback: "Great app" }
    });
    expect(response.body.rating).toMatchObject({ stars: 5, feedback: "Great app" });
  });

  it("stores an empty note as no note", async () => {
    await request(createApp()).put("/api/v1/me/app-rating").set(bearer()).send({ stars: 3, feedback: "   " }).expect(200);

    expect(prismaMock.appRating.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { stars: 3, feedback: null } }));
  });

  it("refuses stars outside 1-5, long notes and other fields", async () => {
    for (const body of [{}, { stars: 0 }, { stars: 6 }, { stars: 2.5 }, { stars: 4, feedback: "x".repeat(501) }, { stars: 4, user_id: "other" }]) {
      await request(createApp()).put("/api/v1/me/app-rating").set(bearer()).send(body).expect(400);
    }
    expect(prismaMock.appRating.upsert).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    await request(createApp()).get("/api/v1/me/app-rating").expect(401);
    await request(createApp()).put("/api/v1/me/app-rating").send({ stars: 4 }).expect(401);
    expect(prismaMock.appRating.upsert).not.toHaveBeenCalled();
  });
});
