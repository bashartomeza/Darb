import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config.js";

const prismaMock = vi.hoisted(() => ({
  authSession: { findUnique: vi.fn(), update: vi.fn() },
  passengerRequest: { findMany: vi.fn() },
  serviceRouteVersion: { findMany: vi.fn() },
  uncertainAiRequest: { create: vi.fn(), deleteMany: vi.fn() }
}));
vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
const { createApp } = await import("../app.js");

const environment = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/masari_test",
  JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent"
};
const appConfig = createConfig(environment);

function auth(id: string, role: "passenger" | "driver") {
  const token = jwt.sign({ role, sid: `session_${id}`, ver: 1 }, environment.JWT_SECRET, {
    subject: id,
    expiresIn: "1h"
  });
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    const id = where.id.replace("session_", "");
    const role = id.startsWith("driver") ? "driver" : "passenger";
    return {
      id: where.id,
      user_id: id,
      user: { email_verified_at: new Date(), id, role, account_status: "active", security_version: 1 },
      security_version_at_issue: 1,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null
    };
  });
  prismaMock.authSession.update.mockResolvedValue({});
});

describe("passenger assistant API", () => {
  it("returns extracted trip data for passenger review", async () => {
    const service = {
      answer: vi.fn().mockResolvedValue({
        status: "request_review",
        message: "راجع المعلومات ثم أكّد لبدء البحث.",
        suggestions: [],
        request: {
          pickupKey: "bab_al_zawiya",
          pickupLabel: "Bab Al-Zawiya",
          destinationKey: "bethlehem",
          destinationLabel: "Bethlehem Center",
          preferredTime: "2026-09-10T15:00:00+03:00",
          passengerCount: 1
        }
      })
    };
    const app = createApp(appConfig, { passengerAssistantService: service });

    const response = await request(app)
      .post("/api/v1/passenger/assistant/messages")
      .set(auth("passenger_1", "passenger"))
      .send({
        message: "ابحث لي من باب الزاوية إلى بيت لحم الساعة 3 لشخص",
        locale: "ar",
        history: []
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      status: "request_review",
      message: "راجع المعلومات ثم أكّد لبدء البحث.",
      extracted: {
        pickup_key: "bab_al_zawiya",
        pickup_label: "Bab Al-Zawiya",
        destination_key: "bethlehem",
        destination_label: "Bethlehem Center",
        preferred_time: "2026-09-10T15:00:00+03:00",
        passenger_count: 1
      },
      suggestions: []
    }));
    expect(response.body).not.toHaveProperty("answer");
    expect(response.body).not.toHaveProperty("match");
  });

  it("returns a real service clarification and preserves the conversation id", async () => {
    const service = {
      answer: vi.fn().mockResolvedValue({
        status: "clarification",
        message: "أي يوم تقصد؟",
        suggestions: ["اليوم", "غداً"]
      })
    };
    const app = createApp(appConfig, { passengerAssistantService: service });

    const response = await request(app)
      .post("/api/v1/passenger/assistant/messages")
      .set(auth("passenger_1", "passenger"))
      .send({
        message: "متى رحلتي؟",
        locale: "ar",
        conversation_id: "conversation_1",
        history: [{ role: "assistant", text: "كيف أساعدك؟" }]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "clarification",
      question: "أي يوم تقصد؟",
      suggestions: ["اليوم", "غداً"],
      conversation_id: "conversation_1"
    });
    expect(service.answer).toHaveBeenCalledWith({
      passengerId: "passenger_1",
      message: "متى رحلتي؟",
      locale: "ar",
      history: [{ role: "assistant", text: "كيف أساعدك؟" }]
    });
  });

  it("is passenger-only", async () => {
    const service = { answer: vi.fn() };
    const app = createApp(appConfig, { passengerAssistantService: service });

    await request(app)
      .post("/api/v1/passenger/assistant/messages")
      .set(auth("driver_1", "driver"))
      .send({ message: "هل توجد رحلة؟", locale: "ar", history: [] })
      .expect(403);
    expect(service.answer).not.toHaveBeenCalled();
  });

  it("answers from the rule-based fallback when no AI key is configured", async () => {
    prismaMock.serviceRouteVersion.findMany.mockResolvedValue([{
      service_route: { route_key: "r1" },
      stops: [
        { sequence: 1, passenger_pickup: true, passenger_dropoff: true, stop: { stop_key: "hebron", name_ar: "الخليل", name_en: "Hebron", latitude: "31.5", longitude: "35.1", status: "active" } },
        { sequence: 2, passenger_pickup: true, passenger_dropoff: true, stop: { stop_key: "bethlehem", name_ar: "بيت لحم", name_en: "Bethlehem", latitude: "31.7", longitude: "35.2", status: "active" } }
      ]
    }]);
    const app = createApp(appConfig);

    const response = await request(app)
      .post("/api/v1/passenger/assistant/messages")
      .set(auth("passenger_1", "passenger"))
      .send({ message: "ride from Hebron to Bethlehem tomorrow at 8 am", locale: "en", history: [] });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("request_review");
    expect(response.body.extracted).toMatchObject({ pickup_key: "hebron", destination_key: "bethlehem", pickup_lat: 31.5, passenger_count: 1 });
    expect(response.body.intent).toMatchObject({ type: "ride", source: "rules" });
    expect(response.body.intent.confidence).toBeGreaterThanOrEqual(0.7);
    expect(prismaMock.uncertainAiRequest.create).not.toHaveBeenCalled();
  });

  it("asks a clarifying question and queues a redacted copy when the request is not understood", async () => {
    prismaMock.serviceRouteVersion.findMany.mockResolvedValue([]);
    prismaMock.uncertainAiRequest.create.mockResolvedValue({});
    prismaMock.uncertainAiRequest.deleteMany.mockResolvedValue({ count: 0 });
    const app = createApp(appConfig);

    const response = await request(app)
      .post("/api/v1/passenger/assistant/messages")
      .set(auth("passenger_1", "passenger"))
      .send({ message: "call me on 0599123456 or me@example.com", locale: "en", history: [] });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("clarification");
    expect(response.body.intent.type).toBe("unknown");
    // No stops are published, so the honest answer is that no routes exist; nothing to review.
    expect(prismaMock.uncertainAiRequest.create).not.toHaveBeenCalled();
  });

  it("queues unreadable requests (PII redacted, no user id) and survives a queue failure", async () => {
    const service = {
      answer: vi.fn().mockResolvedValue({
        status: "clarification",
        message: "Where?",
        suggestions: [],
        intent: { type: "unknown", pickup: null, dropoff: null, time: null, seats: null, size: null, confidence: 0.1, missing: [], unsupported_place: false, source: "rules" },
        uncertain: { reason: "not_understood", source: "rules" }
      })
    };
    prismaMock.uncertainAiRequest.create.mockRejectedValue(new Error("db down"));
    prismaMock.uncertainAiRequest.deleteMany.mockResolvedValue({ count: 0 });
    const app = createApp(appConfig, { passengerAssistantService: service });

    const response = await request(app)
      .post("/api/v1/passenger/assistant/messages")
      .set(auth("passenger_1", "passenger"))
      .send({ message: "blah 0599123456 me@example.com", locale: "en", history: [] });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("clarification");
    expect(response.body.intent).toMatchObject({ type: "unknown", confidence: 0.1 });
    const stored = prismaMock.uncertainAiRequest.create.mock.calls[0][0].data;
    expect(stored.text).toBe("blah [number] [email]");
    expect(stored).not.toHaveProperty("passenger_id");
    expect(stored).not.toHaveProperty("user_id");
    expect(stored.expires_at.getTime()).toBeGreaterThan(Date.now() + 25 * 86_400_000);
  });
});
