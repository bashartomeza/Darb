import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Isolated from the database and real auth: only the assistant router is mounted.
vi.mock("../lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request & { user?: unknown }, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "passenger_1", role: "passenger", sessionId: "session_passenger_1", securityVersion: 1 };
    next();
  },
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
}));

const { createConfig } = await import("../config.js");
const { HttpError } = await import("../middleware/error.js");
const { createPassengerAssistantRouter } = await import("../modules/passengerAssistant.js");
const {
  AiServicesError,
  createAiServicesClient,
  createAiServicesClientFromEnv,
  uiDirectivesSchema
} = await import("../services/aiServicesClient.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(
  readFileSync(path.resolve(here, "../../ai_services/contracts/ui_directives.v1.json"), "utf8")
) as Record<"emergency" | "logistics" | "standard", Record<string, unknown>>;

const appConfig = createConfig({
  APP_ENV: "local",
  DATABASE_URL: "mysql://test:test@localhost:3306/masari_test",
  JWT_SECRET: "test-only-jwt-secret-with-at-least-thirty-two-characters",
  CORS_ORIGINS: "http://localhost:5173",
  LOG_LEVEL: "silent"
});

const SECRET = "internal-shared-secret-0123456789";
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(40)]);

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    status: "OK",
    transcript: "بدي سيرفيس من بيت لحم للخليل",
    dispatch: { pickup_location: "بيت لحم" },
    routing: { routing_target: "HUMAN_DISPATCHER_QUEUE_INTERFACE", needs_review: true },
    frontend_ai_ui_directives: contract.standard,
    ...overrides
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("shared UI-directives contract (Python == Node == Flutter fixture)", () => {
  it.each(["emergency", "logistics", "standard"] as const)("accepts the %s fixture", (name) => {
    expect(uiDirectivesSchema.safeParse(contract[name]).success).toBe(true);
  });

  it("pins the emergency colour, haptics and tel: buttons", () => {
    const emergency = uiDirectivesSchema.parse(contract.emergency);
    expect(emergency.theme.primary_color_hex).toBe("#DC2626");
    expect(emergency.haptics.vibrate).toBe(true);
    expect(emergency.emergency_actions.every((a) => a.dial_uri.startsWith("tel:"))).toBe(true);
  });

  it("rejects hostile or malformed directives", () => {
    const base = structuredClone(contract.emergency) as any;
    const withAction = (dial_uri: string) => ({ ...base, emergency_actions: [{ ...base.emergency_actions[0], dial_uri }] });
    expect(uiDirectivesSchema.safeParse(withAction("https://evil.example")).success).toBe(false);
    expect(uiDirectivesSchema.safeParse(withAction("javascript:alert(1)")).success).toBe(false);
    expect(uiDirectivesSchema.safeParse({ ...base, theme: { ...base.theme, primary_color_hex: "red" } }).success).toBe(false);
    expect(uiDirectivesSchema.safeParse({ ...base, injected: true }).success).toBe(false);
    expect(uiDirectivesSchema.safeParse({ ...base, schema_version: 2 }).success).toBe(false);
  });
});

describe("ai_services client", () => {
  it("sends the shared secret and parses a verified analysis", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, okBody()));
    const client = createAiServicesClient({ baseUrl: "http://ai:8765/", sharedSecret: SECRET, fetchImpl });
    const result = await client.analyzeText("بدي سيرفيس");
    expect(result.kind).toBe("ok");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://ai:8765/v1/analyze");
    expect(init.headers["X-Internal-Secret"]).toBe(SECRET);
  });

  it("maps 422 to blocked, 503 to unavailable, 401 to upstream, garbage to invalid_response", async () => {
    const make = (response: Response) =>
      createAiServicesClient({ baseUrl: "http://ai", sharedSecret: SECRET, fetchImpl: vi.fn().mockResolvedValue(response) });
    expect(await make(jsonResponse(422, { status: "SECURITY_VIOLATION_BLOCKED" })).analyzeText("2+2")).toMatchObject({
      kind: "blocked",
      reason: "security_violation"
    });
    await expect(make(jsonResponse(503, {})).analyzeText("x")).rejects.toMatchObject({ category: "unavailable" });
    await expect(make(jsonResponse(401, {})).analyzeText("x")).rejects.toMatchObject({ category: "upstream" });
    await expect(make(jsonResponse(200, { status: "OK" })).analyzeText("x")).rejects.toMatchObject({ category: "invalid_response" });
    await expect(make(jsonResponse(400, {})).analyzeVoice(WAV, "audio/wav")).rejects.toMatchObject({ category: "invalid_audio" });
  });

  it("times out and reports network failures without leaking details", async () => {
    const slow = vi.fn((_u: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const client = createAiServicesClient({ baseUrl: "http://ai", sharedSecret: SECRET, timeoutMs: 20, fetchImpl: slow as any });
    await expect(client.analyzeText("x")).rejects.toBeInstanceOf(AiServicesError);
    await expect(client.analyzeText("x")).rejects.toMatchObject({ category: "timeout" });
    const down = createAiServicesClient({ baseUrl: "http://ai", sharedSecret: SECRET, fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5")) });
    await expect(down.analyzeText("x")).rejects.toMatchObject({ category: "unavailable", message: "ai_services_unavailable" });
  });

  it("is disabled (null) unless URL and a long secret are configured", () => {
    expect(createAiServicesClientFromEnv({})).toBeNull();
    expect(createAiServicesClientFromEnv({ AI_SERVICES_URL: "http://ai", AI_SERVICES_SHARED_SECRET: "short" })).toBeNull();
    expect(createAiServicesClientFromEnv({ AI_SERVICES_URL: "ftp://ai", AI_SERVICES_SHARED_SECRET: SECRET })).toBeNull();
    expect(createAiServicesClientFromEnv({ AI_SERVICES_URL: "http://ai", AI_SERVICES_SHARED_SECRET: SECRET })).not.toBeNull();
  });
});

describe("POST /passenger/assistant/voice", () => {
  const service = { answer: vi.fn() };
  const recorder = { record: vi.fn() };

  function appWith(client: ReturnType<typeof createAiServicesClient> | null) {
    const app = express();
    app.use(express.json());
    app.use(createPassengerAssistantRouter(appConfig, service as any, recorder, client as any));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const status = error instanceof HttpError ? error.statusCode : 500;
      res.status(status).json({ error: (error as Error).message });
    });
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service.answer.mockResolvedValue({
      status: "clarification",
      message: "من وين بدك تطلع؟",
      suggestions: ["بيت لحم"],
      intent: undefined
    });
  });

  it("audio -> Whisper analysis -> existing assistant, merged with UI directives", async () => {
    const analyzeVoice = vi.fn().mockResolvedValue({
      kind: "ok",
      transcript: "بدي سيرفيس من بيت لحم للخليل",
      dispatch: {},
      routing: { routing_target: "HUMAN_DISPATCHER_QUEUE_INTERFACE", needs_review: true },
      uiDirectives: uiDirectivesSchema.parse(contract.emergency)
    });
    const res = await request(appWith({ analyzeText: vi.fn(), analyzeVoice }))
      .post("/passenger/assistant/voice")
      .set("Content-Type", "audio/wav")
      .send(WAV);

    expect(res.status).toBe(200);
    expect(analyzeVoice).toHaveBeenCalledWith(expect.any(Buffer), "audio/wav");
    expect(service.answer).toHaveBeenCalledWith(expect.objectContaining({ message: "بدي سيرفيس من بيت لحم للخليل", locale: "ar", passengerId: "passenger_1" }));
    expect(res.body).toMatchObject({
      status: "clarification",
      transcript: "بدي سيرفيس من بيت لحم للخليل",
      ai_routing: { routing_target: "HUMAN_DISPATCHER_QUEUE_INTERFACE", needs_review: true },
      frontend_ai_ui_directives: { mode: "emergency", theme: { primary_color_hex: "#DC2626" } }
    });
  });

  it("returns 503 when ai_services is not configured and never calls the assistant", async () => {
    const res = await request(appWith(null)).post("/passenger/assistant/voice").set("Content-Type", "audio/wav").send(WAV);
    expect(res.status).toBe(503);
    expect(service.answer).not.toHaveBeenCalled();
  });

  it("rejects non-audio bodies with 415 before any upstream call", async () => {
    const analyzeVoice = vi.fn();
    const res = await request(appWith({ analyzeText: vi.fn(), analyzeVoice }))
      .post("/passenger/assistant/voice")
      .set("Content-Type", "application/json")
      .send({ hi: 1 });
    expect(res.status).toBe(415);
    expect(analyzeVoice).not.toHaveBeenCalled();
  });

  it("maps a firewall-blocked transcript to 422 and an outage to 503/504", async () => {
    const blocked = { analyzeText: vi.fn(), analyzeVoice: vi.fn().mockResolvedValue({ kind: "blocked", reason: "security_violation" }) };
    expect((await request(appWith(blocked)).post("/passenger/assistant/voice").set("Content-Type", "audio/mpeg").send(WAV)).status).toBe(422);
    const slow = { analyzeText: vi.fn(), analyzeVoice: vi.fn().mockRejectedValue(new AiServicesError("timeout")) };
    expect((await request(appWith(slow)).post("/passenger/assistant/voice").set("Content-Type", "audio/wav").send(WAV)).status).toBe(504);
    const down = { analyzeText: vi.fn(), analyzeVoice: vi.fn().mockRejectedValue(new AiServicesError("unavailable")) };
    expect((await request(appWith(down)).post("/passenger/assistant/voice").set("Content-Type", "audio/wav").send(WAV)).status).toBe(503);
    expect(service.answer).not.toHaveBeenCalled();
  });

  it("keeps the text endpoint body identical after the shared-builder refactor", async () => {
    service.answer.mockResolvedValue({ status: "result", message: "جواب", suggestions: [] });
    const res = await request(appWith(null)).post("/passenger/assistant/messages").send({ message: "مرحبا", conversation_id: "c1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "result", answer: "جواب", suggestions: [], conversation_id: "c1" });

    service.answer.mockResolvedValue({
      status: "request_review",
      message: "راجع المعلومات ثم أكّد لبدء البحث.",
      suggestions: [],
      request: { pickupKey: "bab_al_zawiya", pickupLabel: "Bab Al-Zawiya", destinationKey: "bethlehem", destinationLabel: "Bethlehem Center", preferredTime: "2026-09-10T15:00:00+03:00", passengerCount: 1 }
    });
    const review = await request(appWith(null)).post("/passenger/assistant/messages").send({ message: "x", conversation_id: "c3" });
    expect(review.body).toEqual({
      status: "request_review",
      message: "راجع المعلومات ثم أكّد لبدء البحث.",
      extracted: { pickup_key: "bab_al_zawiya", pickup_label: "Bab Al-Zawiya", destination_key: "bethlehem", destination_label: "Bethlehem Center", preferred_time: "2026-09-10T15:00:00+03:00", passenger_count: 1 },
      suggestions: [],
      conversation_id: "c3"
    });

    service.answer.mockResolvedValue({ status: "clarification", message: "من وين؟", suggestions: ["أ"] });
    const clar = await request(appWith(null)).post("/passenger/assistant/messages").send({ message: "x", conversation_id: "c2" });
    expect(clar.body).toEqual({ status: "clarification", question: "من وين؟", suggestions: ["أ"], conversation_id: "c2" });
  });
});
