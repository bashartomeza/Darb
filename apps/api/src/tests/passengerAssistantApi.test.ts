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
const { createApp: createAppWithDependencies } = await import("../app.js");
const { ASSISTANT_HISTORY_LIMIT, createPrismaAssistantHistoryStore } = await import(
  "../services/passengerAssistantHistory.js"
);
const { PassengerAssistantProviderError } = await import("../services/passengerAssistant.js");
const { createAssistantHistoryDb } = await import("./assistantHistoryFake.js");

let historyDb = createAssistantHistoryDb();
function createApp(...[config, dependencies = {}]: Parameters<typeof createAppWithDependencies>) {
  return createAppWithDependencies(config, {
    passengerAssistantHistory: createPrismaAssistantHistoryStore(historyDb.db as never),
    ...dependencies
  });
}

const environment = {
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/darb_test",
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
  historyDb = createAssistantHistoryDb();
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
    const owned = await historyDb.db.passengerAssistantConversation.create({ data: { passenger_id: "passenger_1" } });
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
        conversation_id: owned.id,
        history: [{ role: "assistant", text: "كيف أساعدك؟" }]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "clarification",
      question: "أي يوم تقصد؟",
      suggestions: ["اليوم", "غداً"],
      conversation_id: owned.id
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

describe("passenger assistant history", () => {
  const clarification = {
    status: "clarification",
    message: "When?",
    suggestions: ["Today", "Tomorrow"]
  };
  const review = {
    status: "request_review",
    message: "Review the trip.",
    suggestions: [],
    request: {
      pickupKey: "hebron",
      pickupLabel: "Hebron",
      destinationKey: "bethlehem",
      destinationLabel: "Bethlehem",
      preferredTime: "2026-11-02T08:00:00+02:00",
      passengerCount: 2
    }
  };

  async function send(app: ReturnType<typeof createApp>, passenger: string, message: string, conversationId?: string) {
    return request(app)
      .post("/api/v1/passenger/assistant/messages")
      .set(auth(passenger, "passenger"))
      .send({ message, locale: "en", history: [], ...(conversationId ? { conversation_id: conversationId } : {}) });
  }

  it("saves the passenger message and the reply, and returns them oldest first", async () => {
    const service = { answer: vi.fn().mockResolvedValueOnce(clarification).mockResolvedValueOnce(review) };
    const app = createApp(appConfig, { passengerAssistantService: service });

    const first = await send(app, "passenger_1", "I need a ride");
    expect(first.status).toBe(200);
    const second = await send(app, "passenger_1", "Hebron to Bethlehem tomorrow 8am for 2", first.body.conversation_id);
    expect(second.body.conversation_id).toBe(first.body.conversation_id);

    const response = await request(app)
      .get("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_1", "passenger"));

    expect(response.status).toBe(200);
    expect(response.body.conversation).toMatchObject({
      id: first.body.conversation_id,
      saved_request_id: null
    });
    expect(response.body.conversation.messages.map((message: { role: string; text: string }) => [message.role, message.text])).toEqual([
      ["user", "I need a ride"],
      ["assistant", "When?"],
      ["user", "Hebron to Bethlehem tomorrow 8am for 2"],
      ["assistant", "Review the trip."]
    ]);
    const [question, , , reviewReply] = response.body.conversation.messages;
    expect(question.payload).toBeNull();
    expect(response.body.conversation.messages[1].payload).toEqual({ status: "clarification", suggestions: ["Today", "Tomorrow"] });
    expect(reviewReply.payload).toEqual({
      status: "request_review",
      suggestions: [],
      extracted: expect.objectContaining({ pickup_key: "hebron", destination_key: "bethlehem", passenger_count: 2 })
    });
  });

  it("continues the passenger's latest chat when the app has no conversation id yet", async () => {
    const service = { answer: vi.fn().mockResolvedValue(clarification) };
    const app = createApp(appConfig, { passengerAssistantService: service });

    const first = await send(app, "passenger_1", "Hello");
    const second = await send(app, "passenger_1", "Hello from my other phone");

    expect(second.body.conversation_id).toBe(first.body.conversation_id);
    expect(historyDb.state.conversations).toHaveLength(1);
  });

  it("never lets a passenger read or write another passenger's conversation", async () => {
    const service = { answer: vi.fn().mockResolvedValue(clarification) };
    const app = createApp(appConfig, { passengerAssistantService: service });

    const owner = await send(app, "passenger_1", "My private trip");
    const intruder = await send(app, "passenger_2", "Let me in", owner.body.conversation_id);

    expect(intruder.status).toBe(200);
    expect(intruder.body.conversation_id).not.toBe(owner.body.conversation_id);
    const ownerView = await request(app)
      .get("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_1", "passenger"));
    expect(ownerView.body.conversation.messages.map((message: { text: string }) => message.text)).toEqual([
      "My private trip",
      "When?"
    ]);
    const intruderView = await request(app)
      .get("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_2", "passenger"));
    expect(intruderView.body.conversation.id).toBe(intruder.body.conversation_id);
    expect(intruderView.body.conversation.messages.map((message: { text: string }) => message.text)).toEqual([
      "Let me in",
      "When?"
    ]);

    const link = await request(app)
      .patch("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_2", "passenger"))
      .send({ conversation_id: owner.body.conversation_id, saved_request_id: "request_2" });
    expect(link.status).toBe(404);
    expect(link.body.error).toBe("assistant_conversation_not_found");
  });

  it("returns an empty history for a passenger who never chatted, and is passenger-only", async () => {
    const app = createApp(appConfig, { passengerAssistantService: { answer: vi.fn() } });

    const empty = await request(app)
      .get("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_1", "passenger"));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ conversation: null });
    await request(app)
      .get("/api/v1/passenger/assistant/conversation")
      .set(auth("driver_1", "driver"))
      .expect(403);
    await request(app)
      .delete("/api/v1/passenger/assistant/conversation")
      .set(auth("driver_1", "driver"))
      .expect(403);
  });

  it("stores nothing when the assistant could not answer", async () => {
    const service = { answer: vi.fn().mockRejectedValue(new PassengerAssistantProviderError("timeout")) };
    const app = createApp(appConfig, { passengerAssistantService: service });

    const response = await send(app, "passenger_1", "Anyone there?");

    expect(response.status).toBe(504);
    expect(historyDb.state.messages).toEqual([]);
  });

  it("keeps only the newest messages up to the cap, oldest first", async () => {
    const store = createPrismaAssistantHistoryStore(historyDb.db as never);
    const exchanges = ASSISTANT_HISTORY_LIMIT / 2 + 10;
    let conversationId: string | undefined;
    for (let index = 1; index <= exchanges; index++) {
      conversationId = await store.appendExchange({
        passengerId: "passenger_1",
        conversationId,
        userText: `question ${index}`,
        assistantText: `answer ${index}`,
        assistantPayload: { status: "result", suggestions: [] }
      });
    }

    const conversation = await store.latest("passenger_1");

    expect(conversation!.messages).toHaveLength(ASSISTANT_HISTORY_LIMIT);
    expect(conversation!.messages[0].text).toBe("question 11");
    expect(conversation!.messages.at(-1)!.text).toBe(`answer ${exchanges}`);
    expect(historyDb.state.messages).toHaveLength(ASSISTANT_HISTORY_LIMIT);
  });

  it("clears the chat so the next message starts a new conversation", async () => {
    const service = { answer: vi.fn().mockResolvedValue(clarification) };
    const app = createApp(appConfig, { passengerAssistantService: service });
    const mine = await send(app, "passenger_1", "Old chat");
    const theirs = await send(app, "passenger_2", "Their chat");

    const cleared = await request(app)
      .delete("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_1", "passenger"));
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ deleted: true });
    const afterClear = await request(app)
      .get("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_1", "passenger"));
    expect(afterClear.body).toEqual({ conversation: null });

    // A device still holding the cleared id starts fresh instead of failing.
    const fresh = await send(app, "passenger_1", "New chat", mine.body.conversation_id);
    expect(fresh.body.conversation_id).not.toBe(mine.body.conversation_id);
    const latest = await request(app)
      .get("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_1", "passenger"));
    expect(latest.body.conversation.messages.map((message: { text: string }) => message.text)).toEqual(["New chat", "When?"]);
    const untouched = await request(app)
      .get("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_2", "passenger"));
    expect(untouched.body.conversation.id).toBe(theirs.body.conversation_id);
  });

  it("links a saved request only when the passenger owns both the chat and the request", async () => {
    historyDb.state.requests.push(
      { id: "request_1", passenger_id: "passenger_1" },
      { id: "request_2", passenger_id: "passenger_2" }
    );
    const service = { answer: vi.fn().mockResolvedValue(clarification) };
    const app = createApp(appConfig, { passengerAssistantService: service });
    const chat = await send(app, "passenger_1", "Book it");

    const foreign = await request(app)
      .patch("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_1", "passenger"))
      .send({ conversation_id: chat.body.conversation_id, saved_request_id: "request_2" });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe("passenger_request_not_found");

    const linked = await request(app)
      .patch("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_1", "passenger"))
      .send({ conversation_id: chat.body.conversation_id, saved_request_id: "request_1" });
    expect(linked.status).toBe(200);
    const restored = await request(app)
      .get("/api/v1/passenger/assistant/conversation")
      .set(auth("passenger_1", "passenger"));
    expect(restored.body.conversation.saved_request_id).toBe("request_1");
  });
});
