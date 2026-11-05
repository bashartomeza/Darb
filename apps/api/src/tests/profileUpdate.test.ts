import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  user: { update: vi.fn() }
}));

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

const { createApp } = await import("../app.js");
const { signAuthToken } = await import("../middleware/auth.js");

const user = {
  id: "user_1",
  name: "Demo Passenger",
  phone: "+970590000001",
  email: "passenger@example.com",
  email_verified_at: new Date(),
  contact_phone: null as string | null,
  city: null as string | null,
  role: "passenger" as const,
  account_status: "active",
  security_version: 1,
  profile_state: "complete",
  demo_account: false
};

const bearer = () => ({
  Authorization: `Bearer ${signAuthToken({ id: user.id, role: "passenger", sessionId: "session_1", securityVersion: 1 })}`
});

describe("PATCH /me", () => {
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
    prismaMock.user.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...user, ...data }));
  });

  it("updates only the fields sent, scoped to the signed-in user", async () => {
    const response = await request(createApp())
      .patch("/api/v1/me")
      .set(bearer())
      .send({ name: "  Sara Ali  ", city: "Hebron" })
      .expect(200);

    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "user_1" }, data: { name: "Sara Ali", city: "Hebron" } });
    expect(response.body.user).toMatchObject({ id: "user_1", name: "Sara Ali", city: "Hebron" });
  });

  it("clears the city and the contact phone when sent empty or null", async () => {
    await request(createApp()).patch("/api/v1/me").set(bearer()).send({ city: "", contact_phone: null }).expect(200);

    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "user_1" }, data: { city: null, contact_phone: null } });
  });

  it("returns the unverified contact phone alongside the verified one", async () => {
    const response = await request(createApp()).patch("/api/v1/me").set(bearer()).send({ contact_phone: "+970591111111" }).expect(200);

    expect(response.body.user).toMatchObject({ phone: "+970590000001", contact_phone: "+970591111111" });
  });

  it("refuses a contact phone with control characters inside it", async () => {
    for (const contact_phone of ["+97059\n1111111", "+970591111\u0000111", "+97059\t1111111", "+970591111111\u007f1"]) {
      await request(createApp()).patch("/api/v1/me").set(bearer()).send({ contact_phone }).expect(400);
    }
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses identity and privilege fields, empty bodies and blank names", async () => {
    for (const body of [{ role: "admin" }, { phone: "+970599999999" }, { email: "x@example.com" }, {}, { name: "   " }]) {
      await request(createApp()).patch("/api/v1/me").set(bearer()).send(body).expect(400);
    }
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    await request(createApp()).patch("/api/v1/me").send({ name: "Sara" }).expect(401);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
